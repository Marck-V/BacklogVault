import db from "./db.js";
import { igdbRequest } from "./igdbClient.js";
import { fetchRecentlyPlayed } from "./steam.js";
import { matchOnIgdb } from "./steamImport.js";

const RECENT_CACHE_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 5000;
const GENRE_QUERY_SIZE = 500;
const TOP_GENRES = 7;

// Small in-memory caches. They only save calls to Steam and IGDB; losing them (a restart) costs nothing.
const recentCache = new Map(); // userId -> { at, steamId, games }
const genreCache = new Map(); // igdb id -> { genres, themes, modes }, each a list of names

function remember(cache, key, value) {
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, value);
}

export function clearDashboardCaches() {
  recentCache.clear();
  genreCache.clear();
}

// What the "currently playing" widget shows. A user who has imported from Steam gets the games they played in the
// last two weeks (set up automatically); anyone else, or anyone whose Steam lookup fails or comes back empty, gets the
// games they marked as Playing by hand.
export async function currentlyPlaying(userId, { force = false } = {}) {
  const steamId = db.prepare("SELECT steam_id FROM users WHERE id = ?").get(userId)?.steam_id;
  const steamLinked = Boolean(steamId);
  const manual = (steamFailed = false) => ({
    source: "manual",
    steam_linked: steamLinked,
    steam_failed: steamFailed,
    games: db
      .prepare(
        `SELECT lg.igdb_id, lg.name, lg.cover_url, MIN(lg.added_at) AS added_at
         FROM list_games lg JOIN lists l ON l.id = lg.list_id
         WHERE l.user_id = ? AND lg.status = 'Playing'
         GROUP BY lg.igdb_id
         ORDER BY added_at DESC`
      )
      .all(userId),
  });

  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey || !steamId) return manual();

  const cached = recentCache.get(userId);
  if (!force && cached && cached.steamId === steamId && Date.now() - cached.at < RECENT_CACHE_MS) {
    return cached.games.length ? { source: "steam", steam_linked: true, steam_failed: false, games: cached.games } : manual();
  }

  let games;
  try {
    const recent = await fetchRecentlyPlayed(steamId, apiKey);
    const matches = recent.length ? await matchOnIgdb(recent.map((g) => String(g.appid))) : new Map();
    const seen = new Set();
    games = [];
    for (const game of recent) {
      const match = matches.get(String(game.appid));
      if (!match || seen.has(match.igdbId)) continue;
      seen.add(match.igdbId);
      games.push({
        igdb_id: match.igdbId,
        name: match.name,
        cover_url: match.coverUrl,
        hours_last_two_weeks: Math.round(game.minutes / 6) / 10,
      });
    }
  } catch (err) {
    // Steam or IGDB is down. Log the kind of failure (never the request: Steam's URL carries the key) and fall back.
    console.error(err.kind ? `Recently played failed: ${err.kind}` : err);
    return manual(true);
  }

  remember(recentCache, userId, { at: Date.now(), steamId, games });
  return games.length ? { source: "steam", steam_linked: true, steam_failed: false, games } : manual();
}

const CATEGORIES = ["genres", "themes", "modes"];
// IGDB's field for each category, so one query can fetch all three.
const IGDB_FIELDS = { genres: "genres", themes: "themes", modes: "game_modes" };

export const emptyBreakdown = () => ({
  game_count: 0,
  genres: { items: [], without: 0 },
  themes: { items: [], without: 0 },
  modes: { items: [], without: 0 },
});

const namesOf = (list) => (list ?? []).map((entry) => entry.name).filter(Boolean);

// Counts the user's library by IGDB genre, theme and game mode (single player, co-op and so on). A game with two
// genres counts once in each. "without" is how many games IGDB lists nothing for. Returns null when IGDB cannot
// answer, so the dashboard can say so instead of showing a wrong chart.
export async function libraryBreakdown(userId) {
  const ids = db
    .prepare("SELECT DISTINCT lg.igdb_id FROM list_games lg JOIN lists l ON l.id = lg.list_id WHERE l.user_id = ?")
    .all(userId)
    .map((r) => r.igdb_id);

  const missing = ids.filter((id) => !genreCache.has(id));
  try {
    for (let i = 0; i < missing.length; i += GENRE_QUERY_SIZE) {
      const batch = missing.slice(i, i + GENRE_QUERY_SIZE);
      const fields = CATEGORIES.map((c) => `${IGDB_FIELDS[c]}.name`).join(",");
      const rows = await igdbRequest("games", `fields ${fields}; where id = (${batch.join(",")}); limit ${GENRE_QUERY_SIZE};`);
      const found = new Map(
        rows.map((row) => [row.id, Object.fromEntries(CATEGORIES.map((c) => [c, namesOf(row[IGDB_FIELDS[c]])]))])
      );
      // A game IGDB did not return is remembered as having nothing, so it is not asked for again on every visit.
      for (const id of batch) remember(genreCache, id, found.get(id) ?? { genres: [], themes: [], modes: [] });
    }
  } catch (err) {
    console.error(err);
    return null;
  }

  const result = { game_count: ids.length };
  for (const category of CATEGORIES) {
    const counts = new Map();
    let without = 0;
    for (const id of ids) {
      const names = genreCache.get(id)?.[category] ?? [];
      if (names.length === 0) without += 1;
      for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const items = sorted.slice(0, TOP_GENRES).map(([name, count]) => ({ name, count }));
    const otherCount = sorted.slice(TOP_GENRES).reduce((sum, [, count]) => sum + count, 0);
    if (otherCount > 0) items.push({ name: "Other", count: otherCount });
    result[category] = { items, without };
  }
  return result;
}
