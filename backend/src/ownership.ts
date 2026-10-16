import db from "./db.ts";
import type { ListRow } from "./types.ts";

// A list you do not own looks exactly like a list that does not exist, so callers answer 404 for both.
export function findOwnedList(userId: number | null | undefined, listId: number | string): ListRow | undefined {
  if (!userId) return undefined;
  return db.prepare<[number | string, number], ListRow>("SELECT * FROM lists WHERE id = ? AND user_id = ?").get(listId, userId);
}
