import db from "./db.ts";
import { igdbRequest } from "./igdbClient.ts";
import { LIMITS } from "./limits.ts";
import { SteamError, type SteamApp } from "./steam.ts";
import type { CountRow, ListRow } from "./types.ts";

export interface IgdbMatch {
  igdbId: number;
  name: string;
  coverUrl: string | null;
}

// One row of IGDB's external_games answer with the game expanded.
interface ExternalGameRow {
  uid?: string;
  game?: { id?: number; name?: string; cover?: { url?: string } };
}

// IGDB's id for Steam in its external_games table. Filtering on it matters: the same uid also appears under other
// stores, so "730" without the filter returns unrelated games.
const STEAM_SOURCE_ID = 1;
const IDS_PER_QUERY = 200;
const UNMATCHED_SAMPLE_SIZE = 20;

export const hoursFromMinutes = (minutes: number): number | null => (minutes > 0 ? Math.round(minutes / 6) / 10 : null);

export const coverUrlFor = (igdbUrl: string | null | undefined): string | null => (igdbUrl ? `https:${igdbUrl.replace("t_thumb", "t_cover_big")}` : null);

// Maps Steam app ids to IGDB games, a batch at a time. The ids are integers from Steam's response, never user text.
export async function matchOnIgdb(appids: string[]): Promise<Map<string, IgdbMatch>> {
  const matches = new Map<string, IgdbMatch>();
  for (let i = 0; i < appids.length; i += IDS_PER_QUERY) {
    const batch = appids.slice(i, i + IDS_PER_QUERY);
    const uids = batch.map((id) => `"${id}"`).join(",");
    let rows: ExternalGameRow[];
    try {
      rows = await igdbRequest<ExternalGameRow[]>(
        "external_games",
        `fields uid,game.name,game.cover.url; where external_game_source = ${STEAM_SOURCE_ID} & uid = (${uids}); limit 500;`
      );
    } catch (err) {
      console.error(err);
      throw new SteamError(
        "igdb_unavailable",
        "We couldn't match your games right now because IGDB isn't responding. Please try again in a minute.",
        502
      );
    }
    for (const row of rows) {
      if (row?.game?.id && row.game.name && typeof row.uid === "string" && !matches.has(row.uid)) {
        matches.set(row.uid, { igdbId: row.game.id, name: row.game.name, coverUrl: coverUrlFor(row.game.cover?.url) });
      }
    }
  }
  return matches;
}

// Adds the games to the list as Backlog with their Steam hours, skipping games already there. Most-played games come
// first, so if the list's size limit cuts the import short, it is the games you care about that make it in.
export async function importOwnedGames({ list, owned }: { list: ListRow; owned: SteamApp[] }) {
  const matches = await matchOnIgdb([...new Set(owned.map((game) => String(game.appid)))]);

  const byIgdbId = new Map<number, IgdbMatch & { minutes: number }>();
  const unmatchedNames: string[] = [];
  for (const game of owned) {
    const match = matches.get(String(game.appid));
    if (!match) {
      unmatchedNames.push(game.name);
      continue;
    }
    const existing = byIgdbId.get(match.igdbId);
    if (existing) existing.minutes += game.minutes; // two Steam apps (say a base game and an edition) for one IGDB game
    else byIgdbId.set(match.igdbId, { ...match, minutes: game.minutes });
  }

  const games = [...byIgdbId.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));

  const exists = db.prepare("SELECT 1 FROM list_games WHERE list_id = ? AND igdb_id = ?");
  const insert = db.prepare(
    "INSERT INTO list_games (list_id, igdb_id, name, cover_url, status, hours_played) VALUES (?, ?, ?, ?, 'Backlog', ?)"
  );
  let capacity =
    LIMITS.gamesPerList - (db.prepare<[number], CountRow>("SELECT COUNT(*) AS n FROM list_games WHERE list_id = ?").get(list.id)?.n ?? 0);
  let imported = 0;
  let alreadyInList = 0;
  let skippedOverCap = 0;

  db.transaction(() => {
    for (const game of games) {
      if (exists.get(list.id, game.igdbId)) {
        alreadyInList += 1;
      } else if (capacity <= 0) {
        skippedOverCap += 1;
      } else {
        insert.run(list.id, game.igdbId, game.name, game.coverUrl, hoursFromMinutes(game.minutes));
        imported += 1;
        capacity -= 1;
      }
    }
  })();

  return {
    owned: owned.length,
    matched: games.length,
    imported,
    alreadyInList,
    skippedOverCap,
    unmatched: unmatchedNames.length,
    unmatchedSample: unmatchedNames.slice(0, UNMATCHED_SAMPLE_SIZE),
  };
}
