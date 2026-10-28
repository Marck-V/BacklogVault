import db from "./db.ts";
import { igdbRequest } from "./igdbClient.ts";
import { fetchRecentlyPlayed } from "./steam.ts";
import { matchOnIgdb, type IgdbMatch } from "./steamImport.ts";
import { SteamError } from "./steam.ts";
import type {
  Breakdown,
  BreakdownCategoryName,
  BreakdownItem,
  CurrentlyPlaying,
  PlayingGame,
} from "../../shared/api.ts";

type CategoryNames = Record<BreakdownCategoryName, string[]>;

const RECENT_FRESH_MS = 10 * 60 * 1000;
// Genres and the like almost never change, so a saved answer is trusted this long before IGDB is asked again.
const METADATA_FRESH_MS = 30 * 24 * 60 * 60 * 1000;
const GENRE_QUERY_SIZE = 500;
const TOP_GENRES = 7;

// Everything below is kept in the database, so a restart loses nothing and Steam or IGDB being down only means the
// last saved answer is shown (marked as old where the page can say so).

// Called when someone disconnects Steam, so nothing about their account lingers.
export function forgetRecentlyPlayed(userId: number): void {
  db.prepare("DELETE FROM steam_recent_games WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM steam_recent_state WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM playtime_snapshots WHERE user_id = ?").run(userId);
}

// Games the user hid in every list they are in. A game hidden in one list but still visible in another is not hidden.
function hiddenEverywhere(userId: number): Set<number> {
  return new Set(
    db
      .prepare<[number], { igdb_id: number }>(
        `SELECT lg.igdb_id FROM list_games lg JOIN lists l ON l.id = lg.list_id
         WHERE l.user_id = ? GROUP BY lg.igdb_id HAVING MIN(lg.hidden) = 1`
      )
      .all(userId)
      .map((r) => r.igdb_id)
  );
}

// What the "currently playing" widget shows. A user who has imported from Steam gets the games they played in the
// last two weeks (set up automatically); anyone else, or anyone whose Steam lookup fails or comes back empty, gets the
// games they marked as Playing by hand.
export async function currentlyPlaying(userId: number, { force = false }: { force?: boolean } = {}): Promise<CurrentlyPlaying> {
  const steamId = db
    .prepare<[number], { steam_id: string }>("SELECT steam_id FROM users WHERE id = ? AND steam_verified = 1")
    .get(userId)?.steam_id;
  const steamLinked = Boolean(steamId);
  const manual = (steamFailed = false): CurrentlyPlaying => ({
    source: "manual",
    steam_linked: steamLinked,
    steam_failed: steamFailed,
    games: db
      .prepare<[number], PlayingGame>(
        `SELECT lg.igdb_id, lg.name, lg.cover_url, MIN(lg.added_at) AS added_at
         FROM list_games lg JOIN lists l ON l.id = lg.list_id
         WHERE l.user_id = ? AND lg.hidden = 0 AND lg.status = 'Playing'
         GROUP BY lg.igdb_id
         ORDER BY added_at DESC`
      )
      .all(userId),
  });

  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey || !steamId) return manual();

  const saved = db
    .prepare<[number], { steam_id: string; fetched_at: string }>("SELECT steam_id, fetched_at FROM steam_recent_state WHERE user_id = ?")
    .get(userId);
  const savedForThisAccount = saved?.steam_id === steamId ? saved : undefined;
  if (!force && savedForThisAccount && Date.now() - Date.parse(savedForThisAccount.fetched_at) < RECENT_FRESH_MS) {
    return steamResult(userId, savedRecent(userId)) ?? manual();
  }

  let games: PlayingGame[];
  try {
    const recent = await fetchRecentlyPlayed(steamId, apiKey);
    const matches = recent.length ? await matchOnIgdb(recent.map((g) => String(g.appid))) : new Map<string, IgdbMatch>();
    const seen = new Set<number>();
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
        minutes_last_two_weeks: game.minutes,
      });
    }
  } catch (err) {
    // Steam or IGDB is down. Log the kind of failure (never the request: Steam's URL carries the key). If a list was
    // saved earlier, show that, marked as old; otherwise fall back to the games marked Playing by hand.
    console.error(err instanceof SteamError ? `Recently played failed: ${err.kind}` : err);
    const old = savedForThisAccount ? steamResult(userId, savedRecent(userId)) : null;
    return old && savedForThisAccount
      ? { ...old, steam_failed: true, stale_since: savedForThisAccount.fetched_at }
      : manual(true);
  }

  saveRecent(userId, steamId, games);
  return steamResult(userId, games) ?? manual();
}

function savedRecent(userId: number): PlayingGame[] {
  return db
    .prepare<[number], { igdb_id: number; name: string; cover_url: string | null; minutes: number }>(
      "SELECT igdb_id, name, cover_url, minutes FROM steam_recent_games WHERE user_id = ? ORDER BY position"
    )
    .all(userId)
    .map((g) => ({
      igdb_id: g.igdb_id,
      name: g.name,
      cover_url: g.cover_url,
      hours_last_two_weeks: Math.round(g.minutes / 6) / 10,
      minutes_last_two_weeks: g.minutes,
    }));
}

function saveRecent(userId: number, steamId: string, games: PlayingGame[]): void {
  db.transaction(() => {
    db.prepare("DELETE FROM steam_recent_games WHERE user_id = ?").run(userId);
    const insert = db.prepare(
      "INSERT INTO steam_recent_games (user_id, igdb_id, name, cover_url, minutes, position) VALUES (?, ?, ?, ?, ?, ?)"
    );
    games.forEach((g, i) => insert.run(userId, g.igdb_id, g.name, g.cover_url, g.minutes_last_two_weeks ?? 0, i));
    db.prepare(
      `INSERT INTO steam_recent_state (user_id, steam_id, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET steam_id = excluded.steam_id, fetched_at = excluded.fetched_at`
    ).run(userId, steamId, new Date().toISOString());
  })();
}

// The Steam list without the games the user hid (applied on every read, so hiding takes effect at once even though the
// Steam answer is saved). Null when nothing is left, so the widget falls back to the games marked Playing by hand.
function steamResult(userId: number, games: PlayingGame[]): CurrentlyPlaying | null {
  const hidden = hiddenEverywhere(userId);
  const shown = games.filter((g) => !hidden.has(g.igdb_id));
  return shown.length ? { source: "steam", steam_linked: true, steam_failed: false, games: shown } : null;
}

const CATEGORIES: BreakdownCategoryName[] = ["genres", "themes", "modes"];
// IGDB's field for each category, so one query can fetch all three.
const IGDB_FIELDS: Record<BreakdownCategoryName, string> = { genres: "genres", themes: "themes", modes: "game_modes" };

export const emptyBreakdown = (): Breakdown => ({
  game_count: 0,
  genres: { items: [], without: 0 },
  themes: { items: [], without: 0 },
  modes: { items: [], without: 0 },
});

const namesOf = (list: unknown): string[] =>
  (Array.isArray(list) ? list : [])
    .map((entry: { name?: unknown } | null) => entry?.name)
    .filter((name): name is string => typeof name === "string" && name !== "");

// Counts the user's library by IGDB genre, theme and game mode (single player, co-op and so on). A game with two
// genres counts once in each. "without" is how many games IGDB lists nothing for. Returns null when IGDB cannot
// answer, so the dashboard can say so instead of showing a wrong chart.
export async function libraryBreakdown(userId: number): Promise<Breakdown | null> {
  const ids = db
    .prepare<[number], { igdb_id: number }>("SELECT DISTINCT lg.igdb_id FROM list_games lg JOIN lists l ON l.id = lg.list_id WHERE l.user_id = ? AND lg.hidden = 0")
    .all(userId)
    .map((r) => r.igdb_id);

  const saved = new Map<number, { names: CategoryNames; fetchedAt: number }>();
  const readSaved = db.prepare<[number], { genres: string; themes: string; modes: string; fetched_at: string }>(
    "SELECT genres, themes, modes, fetched_at FROM game_metadata WHERE igdb_id = ?"
  );
  for (const id of ids) {
    const row = readSaved.get(id);
    if (row) {
      saved.set(id, {
        names: { genres: JSON.parse(row.genres), themes: JSON.parse(row.themes), modes: JSON.parse(row.modes) },
        fetchedAt: Date.parse(row.fetched_at),
      });
    }
  }

  // Games with nothing saved, or whose saved answer is old, are asked for. If IGDB cannot answer, an old answer is still
  // used; only games with nothing saved at all are left out.
  const missing = ids.filter((id) => {
    const entry = saved.get(id);
    return !entry || Date.now() - entry.fetchedAt > METADATA_FRESH_MS;
  });
  try {
    for (let i = 0; i < missing.length; i += GENRE_QUERY_SIZE) {
      const batch = missing.slice(i, i + GENRE_QUERY_SIZE);
      const fields = CATEGORIES.map((c) => `${IGDB_FIELDS[c]}.name`).join(",");
      const rows = await igdbRequest<Array<Record<string, unknown> & { id: number }>>("games", `fields ${fields}; where id = (${batch.join(",")}); limit ${GENRE_QUERY_SIZE};`);
      const found = new Map<number, CategoryNames>(
        rows.map((row) => [
          row.id,
          { genres: namesOf(row[IGDB_FIELDS.genres]), themes: namesOf(row[IGDB_FIELDS.themes]), modes: namesOf(row[IGDB_FIELDS.modes]) },
        ])
      );
      // A game IGDB did not return is saved as having nothing, so it is not asked for again on every visit.
      const now = new Date().toISOString();
      const save = db.prepare(
        `INSERT INTO game_metadata (igdb_id, genres, themes, modes, fetched_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(igdb_id) DO UPDATE SET genres = excluded.genres, themes = excluded.themes, modes = excluded.modes, fetched_at = excluded.fetched_at`
      );
      db.transaction(() => {
        for (const id of batch) {
          const names = found.get(id) ?? { genres: [], themes: [], modes: [] };
          save.run(id, JSON.stringify(names.genres), JSON.stringify(names.themes), JSON.stringify(names.modes), now);
          saved.set(id, { names, fetchedAt: Date.parse(now) });
        }
      })();
    }
  } catch (err) {
    console.error(err);
    // Nothing usable at all: say so instead of drawing an empty chart.
    if (!ids.some((id) => saved.has(id))) return null;
  }

  const known = ids.filter((id) => saved.has(id));
  const result: Breakdown = { ...emptyBreakdown(), game_count: known.length };
  if (known.length < ids.length) result.not_loaded = ids.length - known.length;
  for (const category of CATEGORIES) {
    const counts = new Map<string, number>();
    let without = 0;
    for (const id of known) {
      const names = saved.get(id)?.names[category] ?? [];
      if (names.length === 0) without += 1;
      for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const items: BreakdownItem[] = sorted.slice(0, TOP_GENRES).map(([name, count]) => ({ name, count }));
    const otherCount = sorted.slice(TOP_GENRES).reduce((sum, [, count]) => sum + count, 0);
    if (otherCount > 0) items.push({ name: "Other", count: otherCount });
    result[category] = { items, without };
  }
  return result;
}
