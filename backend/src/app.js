import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import compression from "compression";
import { igdbRequest } from "./igdbClient.js";
import { escapeIgdbString } from "./igdbQuery.js";
import { createIgdbLimiter } from "./igdbLimiter.js";
import { trustProxyHops, clientIpHeader } from "./config.js";
import { useClientIpHeader } from "./clientIp.js";
import { createWriteLimiter } from "./writeLimiters.js";
import { LIMITS } from "./limits.js";
import { attachUser } from "./auth.js";
import authRouter from "./authRoutes.js";
import listsRouter from "./listsRoutes.js";
import importRouter from "./importRoutes.js";
import steamLinkRouter from "./steamLinkRoutes.js";
import libraryRouter from "./libraryRoutes.js";
import { DETAIL_FIELDS, ageRatings, audioLanguages, storeLinks } from "./gameDetails.js";
import { gameAchievements, forgetAchievements } from "./steamAchievements.js";
import { refreshPlaytime } from "./steamRefresh.js";
import { SteamError } from "./steam.js";
import db from "./db.js";
import { currentlyPlaying, libraryBreakdown, emptyBreakdown } from "./dashboardData.js";
import { siteRouter } from "./staticSite.js";

const app = express();

// Where the real visitor address comes from, which every per-IP rate limit depends on (see config.js). On a host whose
// proxy sets its own header (Railway: X-Real-IP), use that header and ignore X-Forwarded-For entirely. Otherwise, count
// the proxies in front so Express can read X-Forwarded-For safely (none locally).
const ipHeader = clientIpHeader();
const proxyHops = trustProxyHops();
if (ipHeader) {
  if (proxyHops > 0) console.warn(`TRUST_PROXY is ignored because CLIENT_IP_HEADER is set (${ipHeader}).`);
  app.use(useClientIpHeader(ipHeader));
} else if (proxyHops > 0) {
  app.set("trust proxy", proxyHops);
}

// Standard security headers (and no X-Powered-By, which tells attackers which framework to target).
app.use(helmet());
// gzip for everything worth compressing (the main script shrinks to about a third).
app.use(compression());

// Credentialed CORS cannot use "*": only the listed origins may send the session cookie cross-origin. That is only
// needed in local development, where Vite serves the site on another port. In production the site and the API share
// one address, so no other origin is allowed unless CORS_ORIGIN says so.
const corsOrigins = (process.env.CORS_ORIGIN ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:5173"))
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
if (corsOrigins.length > 0) app.use(cors({ origin: corsOrigins, credentials: true }));
// Bodies are small everywhere except restoring a backup file, which may hold thousands of games.
const smallJson = express.json();
const backupJson = express.json({ limit: "4mb" });
app.use((req, res, next) => (req.path === "/api/library/restore" ? backupJson : smallJson)(req, res, next));
app.use(cookieParser());
app.use(attachUser);

// One shared budget per IP across every route that calls IGDB.
const igdbLimiter = createIgdbLimiter();
app.use("/api/games", igdbLimiter);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/games/search", async (req, res) => {
  const search = req.query.q;
  if (typeof search !== "string" || !search.trim()) {
    return res.status(400).json({ error: "Missing query param 'q'" });
  }
  if (search.length > LIMITS.searchQuery) {
    return res.status(400).json({ error: `Search text must be at most ${LIMITS.searchQuery} characters` });
  }

  try {
    const query = `search "${escapeIgdbString(search)}"; fields name,cover.url,first_release_date,summary,rating; limit 20;`;
    const games = await igdbRequest("games", query);
    res.json(games);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch games from IGDB" });
  }
});

app.get("/api/games/:id/details", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid game id" });
  }

  try {
    const [game] = await igdbRequest(
      "games",
      `fields ${DETAIL_FIELDS}; where id = ${id};`
    );
    const [timeToBeat] = await igdbRequest(
      "game_time_to_beats",
      `fields normally,completely; where game_id = ${id};`
    );

    const developer = game?.involved_companies?.find((c) => c.developer)?.company?.name ?? null;

    res.json({
      name: game?.name ?? null,
      summary: game?.summary ?? null,
      first_release_date: game?.first_release_date ?? null,
      developer,
      age_ratings: ageRatings(game),
      audio_languages: audioLanguages(game),
      store_links: storeLinks(game),
      time_to_beat_main_seconds: timeToBeat?.normally ?? null,
      time_to_beat_completionist_seconds: timeToBeat?.completely ?? null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch game details from IGDB" });
  }
});

// Steam achievements for one game, for the signed-in visitor's connected Steam account only. Always answers 200 with a
// status (see gameAchievements), so the window can simply leave the line out when there is nothing to say.
app.get("/api/games/:id/achievements", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid game id" });
  res.json(await gameAchievements(req.user?.id, id));
});

// IGDB's time-to-beat numbers are crowd-sourced, and endless or multiplayer games (VRChat, Bloons TD 6)
// get submissions of tens or hundreds of thousands of hours. One of those would swamp the whole total,
// so a game over either limit is left out of the sums and reported as a count instead.
const MAX_MAIN_STORY_HOURS = 200;
const MAX_COMPLETIONIST_HOURS = 500;

app.get("/api/stats/time-to-beat", igdbLimiter, async (req, res) => {
  try {
    // 0 matches no user (ids start at 1), so visitors without a session get the empty totals.
    const userId = req.user?.id ?? 0;

    const rows = db
      .prepare(
        `SELECT DISTINCT lg.igdb_id
         FROM list_games lg JOIN lists l ON l.id = lg.list_id
         WHERE l.user_id = ? AND lg.hidden = 0 AND lg.status IN ('Backlog', 'Playing')`
      )
      .all(userId);
    const uniqueIds = rows.map((r) => r.igdb_id);

    const { completed_count } = db
      .prepare(
        `SELECT COUNT(DISTINCT lg.igdb_id) AS completed_count
         FROM list_games lg JOIN lists l ON l.id = lg.list_id
         WHERE l.user_id = ? AND lg.hidden = 0 AND lg.status = 'Completed'`
      )
      .get(userId);

    // Hours you logged, once per game even if it sits in several lists (the biggest entry wins).
    // This comes from our own database, so it still works when IGDB is down.
    const { total_hours_played } = db
      .prepare(
        `SELECT COALESCE(SUM(h), 0) AS total_hours_played FROM (
           SELECT MAX(lg.hours_played) AS h
           FROM list_games lg JOIN lists l ON l.id = lg.list_id
           WHERE l.user_id = ? AND lg.hidden = 0
           GROUP BY lg.igdb_id
         )`
      )
      .get(userId);

    if (uniqueIds.length === 0) {
      return res.json({
        game_count: 0,
        total_main_story_seconds: 0,
        total_completionist_seconds: 0,
        completed_count,
        total_hours_played,
        games_left_out: 0,
        games_without_estimate: 0,
      });
    }

    let timesToBeat;
    try {
      timesToBeat = await igdbRequest(
        "game_time_to_beats",
        `fields game_id,normally,completely; where game_id = (${uniqueIds.join(",")}); limit 500;`
      );
    } catch (err) {
      // IGDB is only needed for the hour totals, so the counts from our own database still go out.
      console.error(err);
      return res.json({
        game_count: uniqueIds.length,
        completed_count,
        total_hours_played,
        total_main_story_seconds: null,
        total_completionist_seconds: null,
        igdb_unavailable: true,
      });
    }

    const totals = { total_main_story_seconds: 0, total_completionist_seconds: 0 };
    const included = new Set(
      db.prepare("SELECT igdb_id FROM time_estimate_includes WHERE user_id = ?").all(userId).map((r) => r.igdb_id)
    );
    const names = new Map(
      db
        .prepare(
          `SELECT lg.igdb_id, MIN(lg.name) AS name
           FROM list_games lg JOIN lists l ON l.id = lg.list_id
           WHERE l.user_id = ? GROUP BY lg.igdb_id`
        )
        .all(userId)
        .map((r) => [r.igdb_id, r.name])
    );
    let withEstimate = 0;
    let gamesLeftOut = 0;
    const overLimit = [];
    for (const t of timesToBeat) {
      if (!t.normally && !t.completely) continue;
      withEstimate += 1;
      if ((t.normally ?? 0) > MAX_MAIN_STORY_HOURS * 3600 || (t.completely ?? 0) > MAX_COMPLETIONIST_HOURS * 3600) {
        const isIncluded = included.has(t.game_id);
        overLimit.push({
          igdb_id: t.game_id,
          name: names.get(t.game_id) ?? "Unknown game",
          main_story_seconds: t.normally ?? 0,
          completionist_seconds: t.completely ?? 0,
          included: isIncluded,
        });
        if (!isIncluded) {
          gamesLeftOut += 1;
          continue;
        }
      }
      totals.total_main_story_seconds += t.normally ?? 0;
      totals.total_completionist_seconds += t.completely ?? 0;
    }

    res.json({
      game_count: uniqueIds.length,
      completed_count,
      total_hours_played,
      ...totals,
      games_left_out: gamesLeftOut,
      over_limit_games: overLimit.sort((a, b) => b.main_story_seconds - a.main_story_seconds),
      games_without_estimate: uniqueIds.length - withEstimate,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load dashboard stats" });
  }
});

// Lets the user count (or stop counting) one over-the-limit game in the time-remaining totals.
app.put("/api/stats/time-to-beat/includes/:igdbId", (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not signed in" });
  const igdbId = Number(req.params.igdbId);
  if (!Number.isInteger(igdbId) || igdbId < 1 || typeof req.body?.included !== "boolean") {
    return res.status(400).json({ error: "Send { included: true | false } for a valid game id" });
  }
  const owned = db
    .prepare(
      `SELECT 1 FROM list_games lg JOIN lists l ON l.id = lg.list_id
       WHERE l.user_id = ? AND lg.igdb_id = ? LIMIT 1`
    )
    .get(req.user.id, igdbId);
  if (!owned) return res.status(404).json({ error: "Game not found in your lists" });

  if (req.body.included) {
    db.prepare("INSERT OR IGNORE INTO time_estimate_includes (user_id, igdb_id) VALUES (?, ?)").run(req.user.id, igdbId);
  } else {
    db.prepare("DELETE FROM time_estimate_includes WHERE user_id = ? AND igdb_id = ?").run(req.user.id, igdbId);
  }
  res.json({ igdb_id: igdbId, included: req.body.included });
});

app.get("/api/stats/currently-playing", async (req, res) => {
  // Visitors without a session have no games and no Steam link.
  if (!req.user) return res.json({ source: "manual", steam_linked: false, steam_failed: false, games: [] });
  try {
    res.json(await currentlyPlaying(req.user.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load currently playing games" });
  }
});

// The dashboard's refresh button: re-reads small, quickly changing things from Steam. That is the recently played
// list, the hours of the games already in the library, and (by forgetting what was remembered) the achievement counts
// of games opened next. A short cooldown per user keeps the button from being used to hammer Steam and IGDB, and the
// hours part, which reads the whole owned-games list, has a longer one of its own.
const REFRESH_COOLDOWN_MS = 30 * 1000;
const HOURS_COOLDOWN_MS = 5 * 60 * 1000;
const lastRefresh = new Map();
const lastHoursRefresh = new Map();

function rememberTime(map, userId) {
  if (map.size >= 5000) map.delete(map.keys().next().value);
  map.set(userId, Date.now());
}

app.post("/api/steam/refresh", igdbLimiter, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not signed in" });
  try {
    const waitMs = REFRESH_COOLDOWN_MS - (Date.now() - (lastRefresh.get(req.user.id) ?? 0));
    if (waitMs > 0) {
      res.set("Retry-After", String(Math.ceil(waitMs / 1000)));
      return res.status(429).json({ error: "Refreshed a moment ago. Try again in a few seconds." });
    }
    const currently_playing = await currentlyPlaying(req.user.id, { force: true });
    if (!currently_playing.steam_linked) {
      return res.status(409).json({ error: "Import your Steam library first so we know which account to refresh." });
    }
    // Only a real attempt starts the cooldown; a request that was turned away above does not.
    rememberTime(lastRefresh, req.user.id);
    forgetAchievements(req.user.id);

    // Hours are best effort: if Steam, IGDB or the profile's privacy gets in the way, the recently played part above
    // still succeeded, and the answer says why the hours were not touched.
    let hours;
    if (Date.now() - (lastHoursRefresh.get(req.user.id) ?? 0) < HOURS_COOLDOWN_MS) {
      hours = { status: "recent" };
    } else {
      const steamId = db.prepare("SELECT steam_id FROM users WHERE id = ? AND steam_verified = 1").get(req.user.id)?.steam_id;
      try {
        hours = await refreshPlaytime(req.user.id, steamId, process.env.STEAM_API_KEY);
        rememberTime(lastHoursRefresh, req.user.id);
      } catch (err) {
        if (!(err instanceof SteamError)) console.error(err);
        else console.error(`Hours refresh failed: ${err.kind}`);
        hours = {
          status: "error",
          message: err instanceof SteamError ? err.message : "Something went wrong while updating hours.",
        };
      }
    }
    res.json({ currently_playing, hours });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to refresh from Steam" });
  }
});

app.get("/api/stats/breakdown", igdbLimiter, async (req, res) => {
  if (!req.user) return res.json(emptyBreakdown());
  try {
    const breakdown = await libraryBreakdown(req.user.id);
    res.json(breakdown ?? { igdb_unavailable: true, game_count: null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load the library breakdown" });
  }
});

app.use("/api/library", libraryRouter);
app.use("/api", steamLinkRouter);
app.use("/api/auth", authRouter);
app.use("/api/lists", createWriteLimiter(), listsRouter);
app.use("/api/import", importRouter);

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

// In the Docker image the API also serves the website (STATIC_DIR is the built React app), so one service is the whole
// site. In local development Vite serves the website instead and this is off.
if (process.env.STATIC_DIR) app.use(siteRouter(process.env.STATIC_DIR));

// Last stop for errors: always JSON, never a stack trace or internal message.
// Express only treats a function with exactly four parameters as an error handler, so `next` must stay.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON in request body" });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Request body too large" });
  const status = err.status ?? err.statusCode;
  if (status >= 400 && status < 500) return res.status(status).json({ error: "Bad request" });
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});

export default app;
