import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { igdbRequest } from "./igdbClient.js";
import { escapeIgdbString } from "./igdbQuery.js";
import { createIgdbLimiter } from "./igdbLimiter.js";
import { trustProxyHops } from "./config.js";
import { createWriteLimiter } from "./writeLimiters.js";
import { attachUser } from "./auth.js";
import authRouter from "./authRoutes.js";
import listsRouter from "./listsRoutes.js";
import db from "./db.js";

const app = express();

// Tell Express how many proxies sit in front, so rate limiting sees the real client IP (see config.js).
const proxyHops = trustProxyHops();
if (proxyHops > 0) app.set("trust proxy", proxyHops);

// Standard security headers (and no X-Powered-By, which tells attackers which framework to target).
app.use(helmet());

// Credentialed CORS cannot use "*": only the listed origins may send the session cookie cross-origin (local dev).
app.use(
  cors({
    origin: (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(","),
    credentials: true,
  })
);
app.use(express.json());
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
      `fields name,first_release_date,summary,involved_companies.company.name,involved_companies.developer; where id = ${id};`
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
      time_to_beat_main_seconds: timeToBeat?.normally ?? null,
      time_to_beat_completionist_seconds: timeToBeat?.completely ?? null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch game details from IGDB" });
  }
});

app.get("/api/stats/time-to-beat", igdbLimiter, async (req, res) => {
  try {
    // 0 matches no user (ids start at 1), so visitors without a session get the empty totals.
    const userId = req.user?.id ?? 0;

    const rows = db
      .prepare(
        `SELECT DISTINCT lg.igdb_id
         FROM list_games lg JOIN lists l ON l.id = lg.list_id
         WHERE l.user_id = ? AND lg.status IN ('Backlog', 'Playing')`
      )
      .all(userId);
    const uniqueIds = rows.map((r) => r.igdb_id);

    const { completed_count } = db
      .prepare(
        `SELECT COUNT(DISTINCT lg.igdb_id) AS completed_count
         FROM list_games lg JOIN lists l ON l.id = lg.list_id
         WHERE l.user_id = ? AND lg.status = 'Completed'`
      )
      .get(userId);

    if (uniqueIds.length === 0) {
      return res.json({
        game_count: 0,
        total_main_story_seconds: 0,
        total_completionist_seconds: 0,
        completed_count,
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
        total_main_story_seconds: null,
        total_completionist_seconds: null,
        igdb_unavailable: true,
      });
    }

    const totals = timesToBeat.reduce(
      (acc, t) => {
        acc.total_main_story_seconds += t.normally ?? 0;
        acc.total_completionist_seconds += t.completely ?? 0;
        return acc;
      },
      { total_main_story_seconds: 0, total_completionist_seconds: 0 }
    );

    res.json({ game_count: uniqueIds.length, completed_count, ...totals });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load dashboard stats" });
  }
});

app.get("/api/stats/currently-playing", (req, res) => {
  const games = db
    .prepare(
      `SELECT lg.igdb_id, lg.name, lg.cover_url, MIN(lg.added_at) AS added_at
       FROM list_games lg JOIN lists l ON l.id = lg.list_id
       WHERE l.user_id = ? AND lg.status = 'Playing'
       GROUP BY lg.igdb_id
       ORDER BY added_at DESC`
    )
    .all(req.user?.id ?? 0);
  res.json(games);
});

// The signed-in user's whole library in one response. The export service builds its CSV from this
// instead of reading the database, so session handling and ownership checks live only in this API.
app.get("/api/library", (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not signed in" });

  const lists = db
    .prepare("SELECT id, name, created_at FROM lists WHERE user_id = ? ORDER BY name")
    .all(req.user.id);
  const games = db
    .prepare(
      `SELECT lg.* FROM list_games lg JOIN lists l ON l.id = lg.list_id
       WHERE l.user_id = ? ORDER BY lg.added_at DESC`
    )
    .all(req.user.id);

  const byList = new Map(lists.map((list) => [list.id, { ...list, games: [] }]));
  for (const game of games) byList.get(game.list_id)?.games.push(game);
  res.json({ lists: [...byList.values()] });
});

app.use("/api/auth", authRouter);
app.use("/api/lists", createWriteLimiter(), listsRouter);

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

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
