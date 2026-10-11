import express from "express";
import db from "./db.js";
import { ensureUser } from "./auth.js";

const router = express.Router();

// Every list route goes through this: a list you do not own looks exactly like a list that does not exist.
function ownedList(req) {
  if (!req.user) return undefined;
  return db.prepare("SELECT * FROM lists WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
}

router.get("/", (req, res) => {
  if (!req.user) return res.json([]);
  const lists = db.prepare("SELECT * FROM lists WHERE user_id = ? ORDER BY created_at DESC").all(req.user.id);
  res.json(lists);
});

router.post("/", (req, res) => {
  const { name } = req.body;
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Name is required" });
  }
  // Validate first so invalid requests never create a guest account.
  const user = ensureUser(req, res);
  const result = db.prepare("INSERT INTO lists (name, user_id) VALUES (?, ?)").run(name.trim(), user.id);
  const list = db.prepare("SELECT * FROM lists WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(list);
});

router.get("/:id", (req, res) => {
  const list = ownedList(req);
  if (!list) return res.status(404).json({ error: "List not found" });
  const games = db
    .prepare("SELECT * FROM list_games WHERE list_id = ? ORDER BY added_at DESC")
    .all(list.id);
  res.json({ ...list, games });
});

router.delete("/:id", (req, res) => {
  const list = ownedList(req);
  if (list) db.prepare("DELETE FROM lists WHERE id = ?").run(list.id);
  res.status(204).end();
});

router.post("/:id/games", (req, res) => {
  const { igdb_id, name, cover_url } = req.body;
  if (!igdb_id || !name) {
    return res.status(400).json({ error: "igdb_id and name are required" });
  }
  const list = ownedList(req);
  if (!list) return res.status(404).json({ error: "List not found" });

  try {
    const result = db
      .prepare(
        "INSERT INTO list_games (list_id, igdb_id, name, cover_url, status) VALUES (?, ?, ?, ?, 'Backlog')"
      )
      .run(list.id, igdb_id, name, cover_url || null);
    const game = db.prepare("SELECT * FROM list_games WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json(game);
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "Game already in this list" });
    }
    throw err;
  }
});

const VALID_STATUSES = ["Backlog", "Playing", "Completed", "Dropped"];
const RATING_ALLOWED_STATUSES = ["Completed", "Dropped"];

router.put("/:id/games/:gameId", (req, res) => {
  const list = ownedList(req);
  if (!list) return res.status(404).json({ error: "Game not found in list" });

  const { status, rating, hoursPlayed, notes } = req.body;

  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
  }
  if (rating != null && !RATING_ALLOWED_STATUSES.includes(status)) {
    return res.status(400).json({ error: "rating can only be set when status is Completed or Dropped" });
  }
  if (rating != null && (!Number.isInteger(rating) || rating < 1 || rating > 10)) {
    return res.status(400).json({ error: "rating must be an integer between 1 and 10" });
  }

  const existing = db
    .prepare("SELECT * FROM list_games WHERE id = ? AND list_id = ?")
    .get(req.params.gameId, list.id);
  if (!existing) return res.status(404).json({ error: "Game not found in list" });

  const dateCompleted =
    status === "Completed" ? new Date().toISOString() : existing.date_completed;

  db.prepare(
    `UPDATE list_games
     SET status = ?, rating = ?, hours_played = ?, notes = ?, date_completed = ?
     WHERE id = ? AND list_id = ?`
  ).run(
    status,
    rating ?? existing.rating,
    hoursPlayed ?? existing.hours_played,
    notes ?? existing.notes,
    dateCompleted,
    req.params.gameId,
    list.id
  );

  const game = db.prepare("SELECT * FROM list_games WHERE id = ?").get(req.params.gameId);
  res.json(game);
});

router.delete("/:id/games/:gameId", (req, res) => {
  const list = ownedList(req);
  if (list) {
    db.prepare("DELETE FROM list_games WHERE id = ? AND list_id = ?").run(req.params.gameId, list.id);
  }
  res.status(204).end();
});

export default router;
