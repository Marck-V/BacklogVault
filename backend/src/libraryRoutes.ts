import express from "express";
import { ensureUser } from "./auth.ts";
import { buildBackup, restoreBackup, validateBackup } from "./libraryBackup.ts";
import { buildCsv, listsForExport } from "./csvExport.ts";
import { createGuestLimiter, createRestoreLimiter } from "./writeLimiters.ts";

const router = express.Router();

// The whole library as a file to keep. Only the signed-in (or guest) visitor's own data, never anyone else's.
router.get("/backup", (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Nothing to back up yet. Add a game to a list first." });
  const stamp = new Date().toISOString().slice(0, 10);
  res.set("Content-Disposition", `attachment; filename="backlogvault-backup-${stamp}.json"`);
  res.json(buildBackup(req.user.id));
});

// The library as a spreadsheet: one row per game (Game, Status, List, Date Added). For looking at, not for restoring: it
// has no IGDB id, hours, rating or notes, which is what the backup file is for.
router.get("/export.csv", (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Nothing to export yet. Add a game to a list first." });
  res.set("Content-Disposition", 'attachment; filename="backlog.csv"');
  res.type("text/csv; charset=utf-8").send(buildCsv(listsForExport(req.user.id)));
});

// Puts a backup file back. It only ever adds: nothing already in the library is changed or removed.
router.post("/restore", createRestoreLimiter(), createGuestLimiter(), (req, res) => {
  const checked = validateBackup(req.body);
  if ("error" in checked) return res.status(400).json({ error: checked.error });

  // Validate first so a bad file never creates a guest account.
  const user = ensureUser(req, res);
  res.json(restoreBackup(user.id, checked));
});

export default router;
