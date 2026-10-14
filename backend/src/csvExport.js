import db from "./db.js";

// The spreadsheet export. It used to be a separate C# service; it lives in the API now because it was about 50 lines
// of logic that only ever asked the API for its data anyway.
export const CSV_HEADER = "Game,Status,List,Date Added";

// A spreadsheet runs a cell that starts with one of these as a formula, so a game named "=HYPERLINK(...)" could do
// harm when someone opens the file (CSV injection).
const FORMULA_STARTS = ["=", "+", "-", "@", "\t", "\r"];
const NEEDS_QUOTING = /[,"\n\r]/;

// RFC 4180 quoting, plus a leading apostrophe on values a spreadsheet would run as a formula.
export function escapeCsv(value) {
  if (value === null || value === undefined || value === "") return "";
  let text = String(value);
  if (FORMULA_STARTS.includes(text[0])) text = `'${text}`;
  return NEEDS_QUOTING.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// lists: [{ name, games: [{ name, status, added_at }] }]. No trailing newline, one row per game, in list order.
export function buildCsv(lists) {
  const rows = [CSV_HEADER];
  for (const list of lists) {
    for (const game of list.games) {
      const added = typeof game.added_at === "string" && game.added_at.length >= 10 ? game.added_at.slice(0, 10) : game.added_at;
      rows.push([escapeCsv(game.name), escapeCsv(game.status), escapeCsv(list.name), escapeCsv(added)].join(","));
    }
  }
  return rows.join("\n");
}

// One user's lists (by name) with their games (newest first). Only that user's own rows are ever read.
export function listsForExport(userId) {
  const lists = db.prepare("SELECT id, name FROM lists WHERE user_id = ? ORDER BY name").all(userId);
  const games = db
    .prepare(
      `SELECT lg.list_id, lg.name, lg.status, lg.added_at
       FROM list_games lg JOIN lists l ON l.id = lg.list_id
       WHERE l.user_id = ? ORDER BY lg.added_at DESC`
    )
    .all(userId);

  const byList = new Map(lists.map((list) => [list.id, { name: list.name, games: [] }]));
  for (const game of games) byList.get(game.list_id)?.games.push(game);
  return [...byList.values()];
}
