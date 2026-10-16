import crypto from "crypto";
import express from "express";
import type { Response } from "express";
import db, { isUniqueViolation } from "./db.ts";
import type { CountRow } from "./types.ts";
import { ensureUser } from "./auth.ts";
import { appUrl, publicUrl } from "./config.ts";
import { asyncHandler } from "./asyncHandler.ts";
import { SteamError, fetchPersonaName } from "./steam.ts";
import { forgetRecentlyPlayed } from "./dashboardData.ts";
import { forgetAchievements } from "./steamAchievements.ts";
import { buildLoginUrl, claimedSteamId, readOpenIdParams, steamConfirms } from "./steamOpenId.ts";
import { createGuestLimiter, createSteamLinkLimiter } from "./writeLimiters.ts";

const router = express.Router();
const ATTEMPT_TTL_MS = 10 * 60 * 1000;
const CALLBACK_PATH = "/api/auth/steam/callback";
const STATE_FORMAT = /^[A-Za-z0-9_-]{43}$/;

const hashToken = (token: string): string => crypto.createHash("sha256").update(token).digest("hex");
const enabled = () => Boolean(process.env.STEAM_API_KEY);

// Sends the visitor back to the website with a short code saying what happened, which the home page turns into a message.
const backToApp = (res: Response, outcome: string, reason?: string) => {
  const url = new URL("/", appUrl());
  url.searchParams.set("steam", outcome);
  if (reason) url.searchParams.set("reason", reason);
  res.redirect(url.toString());
};

// Step 1: the "Connect Steam" button lands here and is sent on to Steam's own sign-in page.
router.get("/auth/steam/start", createSteamLinkLimiter(), createGuestLimiter(), (req, res) => {
  if (!enabled()) return res.status(503).json({ error: "Steam sign-in isn't set up on this server." });

  const user = ensureUser(req, res);
  const state = crypto.randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO steam_link_attempts (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(
    hashToken(state),
    user.id,
    new Date(Date.now() + ATTEMPT_TTL_MS).toISOString()
  );

  const base = publicUrl();
  res.redirect(buildLoginUrl({ returnTo: `${base}${CALLBACK_PATH}?state=${state}`, realm: base }));
});

// Step 2: Steam sends the visitor back here. Nothing in the address is trusted until Steam itself confirms it.
router.get(
  "/auth/steam/callback",
  createSteamLinkLimiter(),
  asyncHandler(async (req, res) => {
    if (!enabled()) return backToApp(res, "error", "disabled");

    const state = req.query.state;
    if (typeof state !== "string" || !STATE_FORMAT.test(state)) return backToApp(res, "error", "state");
    if (!req.user) return backToApp(res, "error", "session");

    // The code works once: it is removed before anything else is checked, so a replayed address always fails.
    const tokenHash = hashToken(state);
    const attempt = db
      .prepare<[string], { user_id: number; expires_at: string }>("SELECT user_id, expires_at FROM steam_link_attempts WHERE token_hash = ?")
      .get(tokenHash);
    db.prepare("DELETE FROM steam_link_attempts WHERE token_hash = ?").run(tokenHash);
    if (!attempt || attempt.user_id !== req.user.id || Date.parse(attempt.expires_at) < Date.now()) {
      return backToApp(res, "error", "state");
    }

    const params = readOpenIdParams(req.query);
    const steamId = params && claimedSteamId(params, `${publicUrl()}${CALLBACK_PATH}?state=${state}`);
    if (!steamId) return backToApp(res, "error", "invalid");

    try {
      if (!(await steamConfirms(params))) return backToApp(res, "error", "invalid");
    } catch (err) {
      if (!(err instanceof SteamError)) throw err;
      // Log the kind of failure only, never the request.
      console.error(`Steam sign-in failed: ${err.kind}${err.upstreamStatus ? ` (upstream ${err.upstreamStatus})` : ""}`);
      return backToApp(res, "error", "unavailable");
    }

    const persona = await fetchPersonaName(steamId, process.env.STEAM_API_KEY ?? "");
    try {
      db.prepare("UPDATE users SET steam_id = ?, steam_verified = 1, steam_persona = ? WHERE id = ?").run(
        steamId,
        persona,
        req.user.id
      );
    } catch (err) {
      if (isUniqueViolation(err)) return backToApp(res, "error", "already_linked");
      throw err;
    }
    backToApp(res, "linked");
  })
);

// Disconnects the Steam account AND deletes the library (every list and game in it), so no Steam data, such as the hours
// imported from Steam, outlives the connection. That cannot be undone, so the request must say so explicitly: a client
// that only means "disconnect" gets a refusal instead of silently losing someone's lists.
router.delete("/steam/link", (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not signed in" });
  if (req.body?.deleteLibrary !== true) {
    return res.status(400).json({
      error: "Disconnecting Steam also deletes your library. Send deleteLibrary: true to confirm.",
    });
  }

  const userId = req.user.id;
  const linked = db.prepare("SELECT 1 FROM users WHERE id = ? AND steam_verified = 1").get(userId);
  if (!linked) return res.status(409).json({ error: "No Steam account is connected." });

  const deleted = db.transaction(() => {
    const games =
      db
        .prepare<[number], CountRow>("SELECT COUNT(*) AS n FROM list_games lg JOIN lists l ON l.id = lg.list_id WHERE l.user_id = ?")
        .get(userId)?.n ?? 0;
    // A list's games go with it (the database cascades), and so does everything that refers to them.
    const lists = db.prepare("DELETE FROM lists WHERE user_id = ?").run(userId).changes;
    db.prepare("DELETE FROM time_estimate_includes WHERE user_id = ?").run(userId);
    db.prepare("UPDATE users SET steam_id = NULL, steam_verified = 0, steam_persona = NULL WHERE id = ?").run(userId);
    return { lists, games };
  })();

  forgetRecentlyPlayed(userId);
  forgetAchievements(userId);
  res.json({ linked: false, deleted });
});

export default router;
