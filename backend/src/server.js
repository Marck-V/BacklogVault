import "dotenv/config";
import app from "./app.js";
import db from "./db.js";
import { purgeStale } from "./auth.js";
import { createShutdown } from "./shutdown.js";

const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});

const shutdown = createShutdown({ server, db });
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Remove expired sessions and guests nobody has used for 90 days (their lists cascade-delete with them).
const purge = () => {
  const { sessions, guests } = purgeStale();
  if (sessions || guests) console.log(`Purged ${sessions} expired session(s) and ${guests} stale guest(s)`);
};
purge();
setInterval(purge, 24 * 60 * 60 * 1000).unref();
