import db from "./db.js";

// A list you do not own looks exactly like a list that does not exist, so callers answer 404 for both.
export function findOwnedList(userId, listId) {
  if (!userId) return undefined;
  return db.prepare("SELECT * FROM lists WHERE id = ? AND user_id = ?").get(listId, userId);
}
