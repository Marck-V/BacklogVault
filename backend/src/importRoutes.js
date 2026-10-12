import express from "express";
import { asyncHandler } from "./asyncHandler.js";
import { findOwnedList } from "./ownership.js";
import { createImportLimiter } from "./writeLimiters.js";
import { SteamError, parseSteamIdentifier, resolveSteamId, fetchOwnedGames } from "./steam.js";
import { importOwnedGames } from "./steamImport.js";

const router = express.Router();

// The frontend uses this to show the import box only when the server has a Steam key.
router.get("/steam/status", (req, res) => {
  res.json({ enabled: Boolean(process.env.STEAM_API_KEY) });
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

    try {
      const identifier = parseSteamIdentifier(req.body?.steam);
      const steamId = await resolveSteamId(identifier, apiKey);
      const owned = await fetchOwnedGames(steamId, apiKey);
      const summary = await importOwnedGames({ list, owned });
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
