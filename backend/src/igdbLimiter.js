import rateLimit from "express-rate-limit";

// Per-IP cap on routes that spend IGDB quota, so one visitor or bot cannot use up the budget everyone shares.
export function createIgdbLimiter(limit = Number(process.env.IGDB_ROUTE_RATE_LIMIT ?? 60)) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests. Please slow down and try again in a minute." },
  });
}
