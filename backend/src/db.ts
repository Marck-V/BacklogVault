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

  -- Games whose IGDB time is over the dashboard limits but that the user chose to count anyway.
  CREATE TABLE IF NOT EXISTS time_estimate_includes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    igdb_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, igdb_id)
  );
`);

const columnsOf = (table: string) =>
  db.prepare<[], { name: string }>(`PRAGMA table_info(${table})`).all().map((c) => c.name);

const listGamesColumns = columnsOf("list_games");
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
if (!listGamesColumns.includes("hidden")) {
  // 1 = the user hid this game: it stays saved, but is left out of every dashboard number until they unhide it.
  db.exec("ALTER TABLE list_games ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
}

if (!listGamesColumns.includes("time_to_beat_main_seconds")) {
  // IGDB's estimate as it was when the game was added (null when IGDB had none or could not be reached).
  db.exec("ALTER TABLE list_games ADD COLUMN time_to_beat_main_seconds INTEGER");
}
if (!listGamesColumns.includes("time_to_beat_completionist_seconds")) {
  db.exec("ALTER TABLE list_games ADD COLUMN time_to_beat_completionist_seconds INTEGER");
}
if (!listGamesColumns.includes("time_to_beat_checked_at")) {
  // Set once IGDB has been asked, even when it had no estimate, so an empty snapshot is told apart from one never fetched.
  db.exec("ALTER TABLE list_games ADD COLUMN time_to_beat_checked_at TEXT");
}

const usersColumns = columnsOf("users");
if (!usersColumns.includes("steam_id")) {
  db.exec("ALTER TABLE users ADD COLUMN steam_id TEXT");
}
if (!usersColumns.includes("steam_verified")) {
  // 1 only after the visitor signed in on Steam itself, so steam_id is then an account they really control.
  db.exec("ALTER TABLE users ADD COLUMN steam_verified INTEGER NOT NULL DEFAULT 0");
}
if (!usersColumns.includes("steam_persona")) {
  db.exec("ALTER TABLE users ADD COLUMN steam_persona TEXT");
}

const listsColumns = columnsOf("lists");
if (!listsColumns.includes("user_id")) {
  db.exec("ALTER TABLE lists ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE");
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_lists_user ON lists(user_id);
  CREATE INDEX IF NOT EXISTS idx_list_games_list ON list_games(list_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  -- A verified Steam account belongs to exactly one BacklogVault account.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_steam_verified ON users(steam_id) WHERE steam_verified = 1;

  -- Calls made to the Steam Web API each day, to stay under Steam's daily limit for the whole site.
  CREATE TABLE IF NOT EXISTS steam_api_usage (
    day TEXT PRIMARY KEY,
    calls INTEGER NOT NULL
  );

  -- One row per "Connect Steam" click, so the way back from Steam can be matched to the visitor who left.
  CREATE TABLE IF NOT EXISTS steam_link_attempts (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );

  -- IGDB genres, themes and game modes per game (JSON arrays of names), kept so the library breakdown still draws when
  -- IGDB cannot be reached. Public game data, shared by everyone, with nothing about any user.
  CREATE TABLE IF NOT EXISTS game_metadata (
    igdb_id INTEGER PRIMARY KEY,
    genres TEXT NOT NULL,
    themes TEXT NOT NULL,
    modes TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  );

  -- When a user's Steam "recently played" list was last read, and from which Steam account.
  CREATE TABLE IF NOT EXISTS steam_recent_state (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    steam_id TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  );

  -- That list itself, as last read. Shown (marked as old) when Steam or IGDB cannot answer. Removed with the Steam link.
  CREATE TABLE IF NOT EXISTS steam_recent_games (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    igdb_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    cover_url TEXT,
    minutes INTEGER NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (user_id, igdb_id)
  );

  -- One row per user per day (UTC) with the library totals at that time, so trends can be drawn later. The past cannot
  -- be rebuilt from the library, which only holds today's hours.
  CREATE TABLE IF NOT EXISTS playtime_snapshots (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    total_hours REAL NOT NULL,
    game_count INTEGER NOT NULL,
    completed_count INTEGER NOT NULL,
    PRIMARY KEY (user_id, day)
  );
`);

db.prepare("UPDATE list_games SET status = 'Backlog' WHERE status = 'Not Playing'").run();
db.prepare("UPDATE list_games SET status = 'Playing' WHERE status = 'Currently Playing'").run();

// True when SQLite refused a write because it would break a UNIQUE rule (for example a game already in the list).
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && (err as Error & { code?: unknown }).code === "SQLITE_CONSTRAINT_UNIQUE";
}

export default db;
