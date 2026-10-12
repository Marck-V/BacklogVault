import express from "express";
import db from "./db.js";
import { ensureUser } from "./auth.js";
import { LIMITS } from "./limits.js";
import { findOwnedList } from "./ownership.js";
import { createGuestLimiter } from "./writeLimiters.js";

const router = express.Router();

// Every list route goes through this: a list you do not own looks exactly like a list that does not exist.
const ownedList = (req) => findOwnedList(req.user?.id, req.params.id);

router.get("/", (req, res) => {
  if (!req.user) return res.json([]);
  const lists = db.prepare("SELECT * FROM lists WHERE user_id = ? ORDER BY created_at DESC").all(req.user.id);
  res.json(lists);
});

router.post("/", createGuestLimiter(), (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    return res.status(400).json({ error: "Name is required" });
  }
  if (name.length > LIMITS.listName) {
    return res.status(400).json({ error: `Name must be at most ${LIMITS.listName} characters` });
  }
  if (req.user) {
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM lists WHERE user_id = ?").get(req.user.id);
    if (n >= LIMITS.listsPerUser) {
      return res.status(409).json({ error: `You can have at most ${LIMITS.listsPerUser} lists` });
    }
  }
  // Validate first so invalid requests never create a guest account.
  const user = ensureUser(req, res);
  const result = db.prepare("INSERT INTO lists (name, user_id) VALUES (?, ?)").run(name, user.id);
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
  const { igdb_id, cover_url } = req.body ?? {};
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!Number.isInteger(igdb_id) || igdb_id <= 0 || !name) {
    return res.status(400).json({ error: "igdb_id (a positive integer) and name are required" });
  }
  if (name.length > LIMITS.gameName) {
    return res.status(400).json({ error: `name must be at most ${LIMITS.gameName} characters` });
  }
  if (
    cover_url != null &&
    (typeof cover_url !== "string" || cover_url.length > LIMITS.coverUrl || !cover_url.startsWith("https://"))
  ) {
    return res.status(400).json({ error: `cover_url must be an https URL of at most ${LIMITS.coverUrl} characters` });
  }
  const list = ownedList(req);
  if (!list) return res.status(404).json({ error: "List not found" });

  const { n } = db.prepare("SELECT COUNT(*) AS n FROM list_games WHERE list_id = ?").get(list.id);
  if (n >= LIMITS.gamesPerList) {
    return res.status(409).json({ error: `A list can hold at most ${LIMITS.gamesPerList} games` });
  }

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
  if (notes != null && (typeof notes !== "string" || notes.length > LIMITS.notes)) {
    return res.status(400).json({ error: `notes must be text of at most ${LIMITS.notes} characters` });
  }
  if (
    hoursPlayed != null &&
    (typeof hoursPlayed !== "number" || !Number.isFinite(hoursPlayed) || hoursPlayed < 0 || hoursPlayed > LIMITS.maxHours)
  ) {
    return res.status(400).json({ error: `hoursPlayed must be a number between 0 and ${LIMITS.maxHours}` });
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

// Changes the status of several games in one list at once (the list page's multi-select). Only status changes here,
// so rating, hours and notes are left exactly as they are. A game that is already Completed keeps its original
// completion date. Ids that are not in this list are skipped, and the answer says how many were changed.
router.patch("/:id/games", (req, res) => {
  const { ids, status } = req.body ?? {};

  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
  }
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > LIMITS.gamesPerList ||
    !ids.every((id) => Number.isInteger(id) && id > 0)
  ) {
    return res.status(400).json({ error: `ids must be a list of 1 to ${LIMITS.gamesPerList} game ids` });
  }

  const list = ownedList(req);
  if (!list) return res.status(404).json({ error: "List not found" });

  const find = db.prepare("SELECT * FROM list_games WHERE id = ? AND list_id = ?");
  const update = db.prepare("UPDATE list_games SET status = ?, date_completed = ? WHERE id = ? AND list_id = ?");
  const now = new Date().toISOString();
  const games = [];

  db.transaction(() => {
    for (const id of new Set(ids)) {
      const existing = find.get(id, list.id);
      if (!existing) continue;
      const newlyCompleted = status === "Completed" && (existing.status !== "Completed" || !existing.date_completed);
      update.run(status, newlyCompleted ? now : existing.date_completed, id, list.id);
      games.push(find.get(id, list.id));
    }
  })();

  if (games.length === 0) return res.status(404).json({ error: "None of those games are in this list" });
  res.json({ updated: games.length, games });
});

router.delete("/:id/games/:gameId", (req, res) => {
  const list = ownedList(req);
  if (list) {
    db.prepare("DELETE FROM list_games WHERE id = ? AND list_id = ?").run(req.params.gameId, list.id);
  }
  res.status(204).end();
});

export default router;
