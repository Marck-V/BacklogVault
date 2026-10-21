import express from "express";
import type { Request } from "express";
import db, { isUniqueViolation } from "./db.ts";
import type { CountRow, ListGameRow, ListRow } from "./types.ts";
import { ensureUser } from "./auth.ts";
import { LIMITS } from "./limits.ts";
import { findOwnedList } from "./ownership.ts";
import { createGuestLimiter } from "./writeLimiters.ts";
import { fetchTimeToBeat } from "./timeToBeat.ts";

const router = express.Router();

// Every list route goes through this: a list you do not own looks exactly like a list that does not exist.
// (Express 5 types a route parameter as a string or, for wildcard routes, a list; :id is always a single string.)
const ownedList = (req: Request) => findOwnedList(req.user?.id, String(req.params.id ?? ""));

router.get("/", (req, res) => {
  if (!req.user) return res.json([]);
  const lists = db.prepare<[number], ListRow>("SELECT * FROM lists WHERE user_id = ? ORDER BY created_at DESC").all(req.user.id);
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
    const n = db.prepare<[number], CountRow>("SELECT COUNT(*) AS n FROM lists WHERE user_id = ?").get(req.user.id)?.n ?? 0;
    if (n >= LIMITS.listsPerUser) {
      return res.status(409).json({ error: `You can have at most ${LIMITS.listsPerUser} lists` });
    }
  }
  // Validate first so invalid requests never create a guest account.
  const user = ensureUser(req, res);
  const result = db.prepare("INSERT INTO lists (name, user_id) VALUES (?, ?)").run(name, user.id);
  const list = db.prepare<[number | bigint], ListRow>("SELECT * FROM lists WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(list);
});

router.get("/:id", (req, res) => {
  const list = ownedList(req);
  if (!list) return res.status(404).json({ error: "List not found" });
  const games = db
    .prepare<[number], ListGameRow>("SELECT * FROM list_games WHERE list_id = ? ORDER BY added_at DESC")
    .all(list.id);
  res.json({ ...list, games });
});

router.delete("/:id", (req, res) => {
  const list = ownedList(req);
  if (list) db.prepare("DELETE FROM lists WHERE id = ?").run(list.id);
  res.status(204).end();
});

router.post("/:id/games", async (req, res) => {
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

  const n = db.prepare<[number], CountRow>("SELECT COUNT(*) AS n FROM list_games WHERE list_id = ?").get(list.id)?.n ?? 0;
  if (n >= LIMITS.gamesPerList) {
    return res.status(409).json({ error: `A list can hold at most ${LIMITS.gamesPerList} games` });
  }

  const ttb = await fetchTimeToBeat(igdb_id);
  try {
    const result = db
      .prepare(
        `INSERT INTO list_games
           (list_id, igdb_id, name, cover_url, status, time_to_beat_main_seconds, time_to_beat_completionist_seconds, time_to_beat_checked_at)
         VALUES (?, ?, ?, ?, 'Backlog', ?, ?, ?)`
      )
      .run(
        list.id, igdb_id, name, cover_url || null,
        ttb?.main_seconds ?? null, ttb?.completionist_seconds ?? null, ttb ? new Date().toISOString() : null
      );
    const game = db.prepare<[number | bigint], ListGameRow>("SELECT * FROM list_games WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json(game);
  } catch (err) {
    if (isUniqueViolation(err)) {
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

  // Express 5 leaves the body undefined when a request sends none, so a body-less request gets a 400, not a crash.
  const { status, rating, hoursPlayed, notes } = req.body ?? {};

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
    .prepare<[string, number], ListGameRow>("SELECT * FROM list_games WHERE id = ? AND list_id = ?")
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

  const game = db.prepare<[string], ListGameRow>("SELECT * FROM list_games WHERE id = ?").get(req.params.gameId ?? "");
  res.json(game);
});

// Hides or shows one game. A hidden game stays in the list and is kept, but every dashboard number leaves it out.
router.put("/:id/games/:gameId/hidden", (req, res) => {
  if (typeof req.body?.hidden !== "boolean") return res.status(400).json({ error: "hidden must be true or false" });
  const list = ownedList(req);
  if (!list) return res.status(404).json({ error: "Game not found in list" });
  const result = db
    .prepare("UPDATE list_games SET hidden = ? WHERE id = ? AND list_id = ?")
    .run(req.body.hidden ? 1 : 0, req.params.gameId, list.id);
  if (result.changes === 0) return res.status(404).json({ error: "Game not found in list" });
  res.json(db.prepare<[string], ListGameRow>("SELECT * FROM list_games WHERE id = ?").get(req.params.gameId ?? ""));
});

// Changes the status of several games in one list at once (the list page's multi-select). Only status changes here,
// so rating, hours and notes are left exactly as they are. Send { ids, hidden } instead of a status to hide or show them
// all. A game that is already Completed keeps its original
// completion date. Ids that are not in this list are skipped, and the answer says how many were changed.
router.patch("/:id/games", (req, res) => {
  const { ids, status, hidden } = req.body ?? {};
  const hiding = typeof hidden === "boolean";

  if (!hiding && !VALID_STATUSES.includes(status)) {
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

  const find = db.prepare<[number, number], ListGameRow>("SELECT * FROM list_games WHERE id = ? AND list_id = ?");
  const update = db.prepare("UPDATE list_games SET status = ?, date_completed = ? WHERE id = ? AND list_id = ?");
  const setHidden = db.prepare("UPDATE list_games SET hidden = ? WHERE id = ? AND list_id = ?");
  const now = new Date().toISOString();
  const games: ListGameRow[] = [];

  db.transaction(() => {
    for (const id of new Set(ids)) {
      const existing = find.get(id, list.id);
      if (!existing) continue;
      // Read the row back after the change, so the answer shows exactly what is stored now.
      const keepUpdated = () => {
        const row = find.get(id, list.id);
        if (row) games.push(row);
      };
      if (hiding) {
        setHidden.run(hidden ? 1 : 0, id, list.id);
        keepUpdated();
        continue;
      }
      const newlyCompleted = status === "Completed" && (existing.status !== "Completed" || !existing.date_completed);
      update.run(status, newlyCompleted ? now : existing.date_completed, id, list.id);
      keepUpdated();
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
