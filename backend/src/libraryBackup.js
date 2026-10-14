import db from "./db.js";
import { LIMITS } from "./limits.js";

// A backup file is the whole library in one JSON document, so it can be put back on another device or after clearing
// the browser. (The CSV export is for spreadsheets: it has no IGDB id, hours, rating or notes, so it cannot restore.)
export const BACKUP_APP = "BacklogVault";
export const BACKUP_FORMAT = 1;
export const MAX_RESTORE_GAMES = 10000;
const MAX_RESTORE_LISTS = 200;
const STATUSES = ["Backlog", "Playing", "Completed", "Dropped"];
const RATING_STATUSES = ["Completed", "Dropped"];
const DATE_START = /^\d{4}-\d{2}-\d{2}/;

export function buildBackup(userId) {
  const lists = db.prepare("SELECT id, name FROM lists WHERE user_id = ? ORDER BY name").all(userId);
  const games = db
    .prepare(
      `SELECT lg.list_id, lg.igdb_id, lg.name, lg.cover_url, lg.status, lg.rating, lg.hours_played, lg.notes,
              lg.date_completed, lg.added_at, lg.hidden
       FROM list_games lg JOIN lists l ON l.id = lg.list_id
       WHERE l.user_id = ? ORDER BY lg.added_at ASC, lg.id ASC`
    )
    .all(userId);

  const byList = new Map(lists.map((list) => [list.id, { name: list.name, games: [] }]));
  for (const { list_id, ...game } of games) byList.get(list_id)?.games.push(game);

  const included = db.prepare("SELECT igdb_id FROM time_estimate_includes WHERE user_id = ? ORDER BY igdb_id").all(userId);
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    exported_at: new Date().toISOString(),
    lists: [...byList.values()],
    included_estimates: included.map((row) => row.igdb_id),
  };
}

const isText = (value, max) => typeof value === "string" && value.length <= max;

// Returns a clean game, or null if this entry is unusable (it is then skipped and counted, never trusted).
function cleanGame(game) {
  if (!game || typeof game !== "object") return null;
  if (!Number.isInteger(game.igdb_id) || game.igdb_id <= 0) return null;
  const name = typeof game.name === "string" ? game.name.trim() : "";
  if (!name || name.length > LIMITS.gameName) return null;
  const status = STATUSES.includes(game.status) ? game.status : "Backlog";

  const cover =
    typeof game.cover_url === "string" && game.cover_url.startsWith("https://") && game.cover_url.length <= LIMITS.coverUrl
      ? game.cover_url
      : null;
  const rating =
    RATING_STATUSES.includes(status) && Number.isInteger(game.rating) && game.rating >= 1 && game.rating <= 10 ? game.rating : null;
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
export function validateBackup(body) {
  if (!body || typeof body !== "object" || body.app !== BACKUP_APP || body.format !== BACKUP_FORMAT || !Array.isArray(body.lists)) {
    return { error: "That doesn't look like a BacklogVault backup file." };
  }
  if (body.lists.length > MAX_RESTORE_LISTS) return { error: "That backup has too many lists." };

  let total = 0;
  for (const list of body.lists) total += Array.isArray(list?.games) ? list.games.length : 0;
  if (total > MAX_RESTORE_GAMES) return { error: `A backup can hold at most ${MAX_RESTORE_GAMES.toLocaleString("en-US")} games.` };

  const lists = new Map();
  let skipped = 0;
  for (const list of body.lists) {
    const name = typeof list?.name === "string" ? list.name.trim() : "";
    if (!name || name.length > LIMITS.listName || !Array.isArray(list.games)) {
      skipped += Array.isArray(list?.games) ? list.games.length : 0;
      continue;
    }
    const games = lists.get(name) ?? new Map();
    for (const raw of list.games) {
      const game = cleanGame(raw);
      if (game) games.set(game.igdb_id, game);
      else skipped += 1;
    }
    lists.set(name, games);
  }

  const included = Array.isArray(body.included_estimates)
    ? body.included_estimates.filter((id) => Number.isInteger(id) && id > 0).slice(0, MAX_RESTORE_GAMES)
    : [];
  return { lists, skipped, included };
}

// Puts a validated backup into the user's library without ever overwriting or deleting what is already there: lists
// are matched by name, and a game already in a list is left exactly as it is.
export function restoreBackup(userId, { lists, skipped, included }) {
  const summary = {
    lists_created: 0,
    lists_matched: 0,
    games_added: 0,
    games_already_there: 0,
    games_skipped: skipped,
    games_over_limit: 0,
  };

  db.transaction(() => {
    const existing = new Map(db.prepare("SELECT id, name FROM lists WHERE user_id = ?").all(userId).map((l) => [l.name, l.id]));
    let listCount = existing.size;
    const insertList = db.prepare("INSERT INTO lists (name, user_id) VALUES (?, ?)");
    const countGames = db.prepare("SELECT COUNT(*) AS n FROM list_games WHERE list_id = ?");
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

      let capacity = LIMITS.gamesPerList - countGames.get(listId).n;
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
