import express from "express";
import db from "./db.ts";
import { recordPlaytimeSnapshot } from "./playtimeHistory.ts";
import type { UserRow } from "./types.ts";
import { asyncHandler } from "./asyncHandler.ts";
import { findOwnedList } from "./ownership.ts";
import { createImportLimiter } from "./writeLimiters.ts";
import { SteamError, fetchOwnedGames } from "./steam.ts";
import { importOwnedGames } from "./steamImport.ts";

const router = express.Router();

// The frontend uses this to show the import box only when the server has a Steam key.
// It also says whether this visitor has connected a Steam account, and which one, so the page can offer the right buttons.
router.get("/steam/status", (req, res) => {
  const enabled = Boolean(process.env.STEAM_API_KEY);
  const linked = req.user
    ? db
        .prepare<[number], Pick<UserRow, "steam_id" | "steam_persona">>("SELECT steam_id, steam_persona FROM users WHERE id = ? AND steam_verified = 1")
        .get(req.user.id)
    : null;
  res.json({ enabled, linked: Boolean(linked), personaName: linked?.steam_persona ?? null });
});

router.post(
  "/steam",
  createImportLimiter(),
  asyncHandler(async (req, res) => {
    const apiKey = process.env.STEAM_API_KEY;
    if (!apiKey) return res.status(503).json({ error: "Steam import isn't set up on this server." });

    const listId = req.body?.listId;
    if (!Number.isInteger(listId) || listId <= 0) return res.status(400).json({ error: "listId is required" });
    const list = findOwnedList(req.user?.id, listId);
    if (!list) return res.status(404).json({ error: "List not found" });

    // Steam's terms allow fetching a person's Steam data only when that person asks for it. So the import reads one
    // account only: the one this visitor proved is theirs through Steam's own sign-in. No profile can be typed in.
    const linked = req.user
      ? db.prepare<[number], { steam_id: string }>("SELECT steam_id FROM users WHERE id = ? AND steam_verified = 1").get(req.user.id)
      : undefined;
    if (!linked) {
      return res.status(403).json({ error: "Connect your Steam account first, then import your library." });
    }
    const steamId = linked.steam_id;

    try {
      const owned = await fetchOwnedGames(steamId, apiKey);
      const summary = await importOwnedGames({ list, owned });
      recordPlaytimeSnapshot(req.user!.id);
      res.json({ steamId, ...summary });
    } catch (err) {
      if (!(err instanceof SteamError)) throw err;
      // Log what kind of failure it was, never the request itself: Steam's URL carries the API key.
      if (err.status >= 500) console.error(`Steam import failed: ${err.kind}${err.upstreamStatus ? ` (upstream ${err.upstreamStatus})` : ""}`);
      res.status(err.status).json({ error: err.message });
    }
  })
);

export default router;
