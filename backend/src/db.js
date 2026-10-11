import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, "..", "backlog.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password_hash TEXT,
    is_guest INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS list_games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    igdb_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    cover_url TEXT,
    status TEXT NOT NULL DEFAULT 'Backlog',
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(list_id, igdb_id)
  );
`);

const listGamesColumns = db.prepare("PRAGMA table_info(list_games)").all().map((c) => c.name);
if (!listGamesColumns.includes("status")) {
  db.exec("ALTER TABLE list_games ADD COLUMN status TEXT NOT NULL DEFAULT 'Backlog'");
}
if (!listGamesColumns.includes("rating")) {
  db.exec("ALTER TABLE list_games ADD COLUMN rating INTEGER");
}
if (!listGamesColumns.includes("hours_played")) {
  db.exec("ALTER TABLE list_games ADD COLUMN hours_played REAL");
}
if (!listGamesColumns.includes("notes")) {
  db.exec("ALTER TABLE list_games ADD COLUMN notes TEXT");
}
if (!listGamesColumns.includes("date_completed")) {
  db.exec("ALTER TABLE list_games ADD COLUMN date_completed TEXT");
}

const listsColumns = db.prepare("PRAGMA table_info(lists)").all().map((c) => c.name);
if (!listsColumns.includes("user_id")) {
  db.exec("ALTER TABLE lists ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE");
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_lists_user ON lists(user_id);
  CREATE INDEX IF NOT EXISTS idx_list_games_list ON list_games(list_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

db.prepare("UPDATE list_games SET status = 'Backlog' WHERE status = 'Not Playing'").run();
db.prepare("UPDATE list_games SET status = 'Playing' WHERE status = 'Currently Playing'").run();

export default db;
