// The shapes of the database rows and of the signed-in visitor. SQLite stores booleans as 0 or 1.

import type { GameStatus, List, ListGame, SessionUser } from "../../shared/api.ts";
export type { GameStatus, SessionUser };

export interface UserRow {
  id: number;
  email: string | null;
  password_hash: string | null;
  is_guest: number;
  created_at: string;
  last_seen_at: string;
  steam_id: string | null;
  steam_verified: number;
  steam_persona: string | null;
}

// Lists and games are sent to the website as they are stored, so the shared API types describe the rows too.
export type ListRow = List;
export type ListGameRow = ListGame;

// Every request carries the visitor (set by attachUser in auth.ts; null for a visitor with no session) and the raw
// session token.
declare global {
  namespace Express {
    interface Request {
      user: SessionUser | null;
      sessionToken: string | null;
    }
  }
}

// A count from SELECT COUNT(*) AS n.
export interface CountRow {
  n: number;
}
