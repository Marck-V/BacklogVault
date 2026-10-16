import db from "./db.ts";
import { LIMITS } from "./limits.ts";
import type { CountRow, GameStatus, ListGameRow, ListRow } from "./types.ts";

// One game as it appears in a backup file.
export type BackupGame = Omit<ListGameRow, "id" | "list_id">;

export interface BackupFile {
  app: string;
  format: number;
  exported_at: string;
  lists: Array<{ name: string; games: BackupGame[] }>;
  included_estimates: number[];
}

// A game from an uploaded file after checking: every field is known to be valid. added_at may be missing (null).
export type CleanGame = Omit<BackupGame, "added_at"> & { added_at: string | null };

export interface ValidatedBackup {
  lists: Map<string, Map<number, CleanGame>>;
  skipped: number;
  included: number[];
}

import type { RestoreSummary } from "../../shared/api.ts";
export type { RestoreSummary };

// An uploaded file is untrusted, so fields arrive as unknown and are checked one by one.
type Unchecked = Record<string, unknown>;
const isObject = (value: unknown): value is Unchecked => typeof value === "object" && value !== null;
const isPositiveInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0;

// A backup file is the whole library in one JSON document, so it can be put back on another device or after clearing
// the browser. (The CSV export is for spreadsheets: it has no IGDB id, hours, rating or notes, so it cannot restore.)
export const BACKUP_APP = "BacklogVault";
export const BACKUP_FORMAT = 1;
export const MAX_RESTORE_GAMES = 10000;
const MAX_RESTORE_LISTS = 200;
const STATUSES: readonly GameStatus[] = ["Backlog", "Playing", "Completed", "Dropped"];
const RATING_STATUSES: readonly GameStatus[] = ["Completed", "Dropped"];
const isStatus = (value: unknown): value is GameStatus => STATUSES.includes(value as GameStatus);
const DATE_START = /^\d{4}-\d{2}-\d{2}/;

export function buildBackup(userId: number): BackupFile {
  const lists = db.prepare<[number], Pick<ListRow, "id" | "name">>("SELECT id, name FROM lists WHERE user_id = ? ORDER BY name").all(userId);
  const games = db
    .prepare<[number], BackupGame & { list_id: number }>(
      `SELECT lg.list_id, lg.igdb_id, lg.name, lg.cover_url, lg.status, lg.rating, lg.hours_played, lg.notes,
              lg.date_completed, lg.added_at, lg.hidden
       FROM list_games lg JOIN lists l ON l.id = lg.list_id
       WHERE l.user_id = ? ORDER BY lg.added_at ASC, lg.id ASC`
    )
    .all(userId);

  const byList = new Map<number, { name: string; games: BackupGame[] }>(lists.map((list) => [list.id, { name: list.name, games: [] }]));
  for (const { list_id, ...game } of games) byList.get(list_id)?.games.push(game);

  const included = db
    .prepare<[number], { igdb_id: number }>("SELECT igdb_id FROM time_estimate_includes WHERE user_id = ? ORDER BY igdb_id")
    .all(userId);
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    exported_at: new Date().toISOString(),
    lists: [...byList.values()],
    included_estimates: included.map((row) => row.igdb_id),
  };
}

const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;

// Returns a clean game, or null if this entry is unusable (it is then skipped and counted, never trusted).
function cleanGame(game: unknown): CleanGame | null {
  if (!isObject(game)) return null;
  if (!isPositiveInt(game.igdb_id)) return null;
  const name = typeof game.name === "string" ? game.name.trim() : "";
  if (!name || name.length > LIMITS.gameName) return null;
  const status: GameStatus = isStatus(game.status) ? game.status : "Backlog";

  const cover =
    typeof game.cover_url === "string" && game.cover_url.startsWith("https://") && game.cover_url.length <= LIMITS.coverUrl
      ? game.cover_url
      : null;
  const rating =
    RATING_STATUSES.includes(status) && typeof game.rating === "number" && Number.isInteger(game.rating) && game.rating >= 1 && game.rating <= 10
      ? game.rating
      : null;
  const hours =
    typeof game.hours_played === "number" && Number.isFinite(game.hours_played) && game.hours_played >= 0 && game.hours_played <= LIMITS.maxHours
      ? game.hours_played
      : null;
  const notes = isText(game.notes, LIMITS.notes) && game.notes !== "" ? game.notes : null;
  const completed = isText(game.date_completed, 40) && DATE_START.test(game.date_completed) ? game.date_completed : null;
  const added = isText(game.added_at, 40) && DATE_START.test(game.added_at) ? game.added_at : null;

  return {
    igdb_id: game.igdb_id, name, cover_url: cover, status, rating, hours_played: hours, notes, date_completed: completed, added_at: added,
    hidden: game.hidden === true || game.hidden === 1 ? 1 : 0,
  };
}

// Checks a parsed backup. A wrong or oversized file is refused outright; a few bad games inside an otherwise good file
// are skipped and counted. Lists with the same name are merged.
export function validateBackup(body: unknown): ValidatedBackup | { error: string } {
  if (!isObject(body) || body.app !== BACKUP_APP || body.format !== BACKUP_FORMAT || !Array.isArray(body.lists)) {
    return { error: "That doesn't look like a BacklogVault backup file." };
  }
  if (body.lists.length > MAX_RESTORE_LISTS) return { error: "That backup has too many lists." };

  const uploaded: unknown[] = body.lists;
  const gamesOf = (list: unknown): unknown[] | null => (isObject(list) && Array.isArray(list.games) ? list.games : null);
  let total = 0;
  for (const list of uploaded) total += gamesOf(list)?.length ?? 0;
  if (total > MAX_RESTORE_GAMES) return { error: `A backup can hold at most ${MAX_RESTORE_GAMES.toLocaleString("en-US")} games.` };

  const lists = new Map<string, Map<number, CleanGame>>();
  let skipped = 0;
  for (const list of uploaded) {
    const name = isObject(list) && typeof list.name === "string" ? list.name.trim() : "";
    const listGames = gamesOf(list);
    if (!name || name.length > LIMITS.listName || !listGames) {
      skipped += listGames?.length ?? 0;
      continue;
    }
    const games = lists.get(name) ?? new Map<number, CleanGame>();
    for (const raw of listGames) {
      const game = cleanGame(raw);
      if (game) games.set(game.igdb_id, game);
      else skipped += 1;
    }
    lists.set(name, games);
  }

  const included = Array.isArray(body.included_estimates)
    ? (body.included_estimates as unknown[]).filter(isPositiveInt).slice(0, MAX_RESTORE_GAMES)
    : [];
  return { lists, skipped, included };
}

// Puts a validated backup into the user's library without ever overwriting or deleting what is already there: lists
// are matched by name, and a game already in a list is left exactly as it is.
export function restoreBackup(userId: number, { lists, skipped, included }: ValidatedBackup): RestoreSummary {
  const summary: RestoreSummary = {
    lists_created: 0,
    lists_matched: 0,
    games_added: 0,
    games_already_there: 0,
    games_skipped: skipped,
    games_over_limit: 0,
  };

  db.transaction(() => {
    const existing = new Map(
      db.prepare<[number], Pick<ListRow, "id" | "name">>("SELECT id, name FROM lists WHERE user_id = ?").all(userId).map((l) => [l.name, l.id])
    );
    let listCount = existing.size;
    const insertList = db.prepare("INSERT INTO lists (name, user_id) VALUES (?, ?)");
    const countGames = db.prepare<[number], CountRow>("SELECT COUNT(*) AS n FROM list_games WHERE list_id = ?");
    const insertGame = db.prepare(
      `INSERT OR IGNORE INTO list_games
         (list_id, igdb_id, name, cover_url, status, rating, hours_played, notes, date_completed, added_at, hidden)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?)`
    );

    for (const [name, games] of lists) {
      let listId = existing.get(name);
      if (listId === undefined) {
        if (listCount >= LIMITS.listsPerUser) {
          summary.games_over_limit += games.size;
          continue;
        }
        listId = Number(insertList.run(name, userId).lastInsertRowid);
        existing.set(name, listId);
        listCount += 1;
        summary.lists_created += 1;
      } else {
        summary.lists_matched += 1;
      }

      let capacity = LIMITS.gamesPerList - (countGames.get(listId)?.n ?? 0);
      for (const game of games.values()) {
        if (capacity <= 0) {
          summary.games_over_limit += 1;
          continue;
        }
        const result = insertGame.run(
          listId, game.igdb_id, game.name, game.cover_url, game.status, game.rating, game.hours_played, game.notes, game.date_completed, game.added_at, game.hidden
        );
        if (result.changes === 1) {
          summary.games_added += 1;
          capacity -= 1;
        } else {
          summary.games_already_there += 1;
        }
      }
    }

    // "Count this over-limit game anyway" choices, for games that are in the library now.
    const has = db.prepare("SELECT 1 FROM list_games lg JOIN lists l ON l.id = lg.list_id WHERE l.user_id = ? AND lg.igdb_id = ? LIMIT 1");
    const keep = db.prepare("INSERT OR IGNORE INTO time_estimate_includes (user_id, igdb_id) VALUES (?, ?)");
    for (const igdbId of included) if (has.get(userId, igdbId)) keep.run(userId, igdbId);
  })();

  return summary;
}
