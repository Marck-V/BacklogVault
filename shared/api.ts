// The shapes of the API's answers, shared by the backend (which builds them) and the frontend (which reads them).
// If one side changes a field, the other no longer type-checks, instead of breaking quietly in the browser.
// Types only: nothing here exists at runtime.

export type GameStatus = "Backlog" | "Playing" | "Completed" | "Dropped";

// ---- Dashboard

export interface PlayingGame {
  igdb_id: number;
  name: string;
  cover_url: string | null;
  // Set for games marked Playing by hand.
  added_at?: string;
  // Set for games from Steam's "played in the last two weeks".
  hours_last_two_weeks?: number;
}

export interface CurrentlyPlaying {
  source: "steam" | "manual";
  steam_linked: boolean;
  steam_failed: boolean;
  games: PlayingGame[];
}

export interface BreakdownItem {
  name: string;
  count: number;
}

export interface BreakdownCategory {
  items: BreakdownItem[];
  without: number;
}

export type BreakdownCategoryName = "genres" | "themes" | "modes";

export type Breakdown = { game_count: number } & Record<BreakdownCategoryName, BreakdownCategory>;

export type BreakdownResponse = Breakdown | { igdb_unavailable: true; game_count: null };

// ---- Steam achievements for one game

export type AchievementResult =
  | { status: "ok"; total: number; unlocked: number }
  | { status: "none" | "private" | "not_connected" | "unavailable" };

export interface OverLimitGame {
  igdb_id: number;
  name: string;
  main_story_seconds: number;
  completionist_seconds: number;
  included: boolean;
}

// GET /api/stats/time-to-beat. The hour totals are null when IGDB could not be reached (igdb_unavailable).
export interface TimeToBeatStats {
  game_count: number;
  completed_count: number;
  total_hours_played: number;
  total_main_story_seconds: number | null;
  total_completionist_seconds: number | null;
  games_left_out?: number;
  over_limit_games?: OverLimitGame[];
  games_without_estimate?: number;
  igdb_unavailable?: true;
}

// ---- One game's details window: GET /api/games/:id/details

export interface AgeRating {
  organization: string;
  rating: string;
}

export interface StoreLink {
  key: string;
  label: string;
  url: string;
}

export interface GameDetails {
  name: string | null;
  summary: string | null;
  first_release_date: number | null;
  developer: string | null;
  age_ratings: AgeRating[];
  audio_languages: string[];
  store_links: StoreLink[];
  time_to_beat_main_seconds: number | null;
  time_to_beat_completionist_seconds: number | null;
}

// ---- POST /api/steam/refresh

export type HoursRefresh = { status: "ok"; updated: number } | { status: "recent" } | { status: "error"; message: string };

export interface RefreshResult {
  currently_playing: CurrentlyPlaying;
  hours: HoursRefresh;
}

// ---- Lists and games

export interface List {
  id: number;
  name: string;
  created_at: string;
  user_id: number | null;
}

// A game in a list. SQLite stores booleans as 0 or 1, so hidden is a number.
export interface ListGame {
  id: number;
  list_id: number;
  igdb_id: number;
  name: string;
  cover_url: string | null;
  status: GameStatus;
  added_at: string;
  rating: number | null;
  hours_played: number | null;
  notes: string | null;
  date_completed: string | null;
  hidden: number;
}

export type ListWithGames = List & { games: ListGame[] };

// PATCH /api/lists/:id/games (several games at once).
export interface BulkResult {
  updated: number;
  games: ListGame[];
}

// GET /api/games/search: IGDB's own fields, passed through.
export interface SearchResult {
  id: number;
  name: string;
  cover?: { url?: string };
  first_release_date?: number;
  summary?: string;
  rating?: number;
}

// ---- The visitor

export interface SessionUser {
  id: number;
  email: string | null;
  isGuest: boolean;
}

// GET /api/auth/me
export interface Me {
  user: SessionUser | null;
  accountsEnabled: boolean;
}

export interface LoginResult {
  user: SessionUser;
  mergedLists?: number;
}

// What Delete My Data and Disconnect Steam removed.
export interface DeletedCounts {
  lists: number;
  games: number;
}

// ---- Backup and restore: POST /api/library/restore

export interface RestoreSummary {
  lists_created: number;
  lists_matched: number;
  games_added: number;
  games_already_there: number;
  games_skipped: number;
  games_over_limit: number;
}

// ---- Steam import

// GET /api/import/steam/status
export interface SteamImportStatus {
  enabled: boolean;
  linked: boolean;
  personaName: string | null;
}

// POST /api/import/steam
export interface SteamImportResult {
  steamId: string;
  owned: number;
  matched: number;
  imported: number;
  alreadyInList: number;
  skippedOverCap: number;
  unmatched: number;
  unmatchedSample: string[];
}
