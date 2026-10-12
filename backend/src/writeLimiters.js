import rateLimit from "express-rate-limit";

function limiter({ windowMs, limit, message, skip }) {
  return rateLimit({ windowMs, limit, standardHeaders: "draft-7", legacyHeaders: false, message: { error: message }, skip });
}

// Per-IP cap on changes (create, edit, delete). Reads are not counted.
export function createWriteLimiter(limit = Number(process.env.WRITE_RATE_LIMIT ?? 120)) {
  return limiter({
    windowMs: 60 * 1000,
    limit,
    message: "Too many changes in a short time. Please slow down.",
    skip: (req) => ["GET", "HEAD", "OPTIONS"].includes(req.method),
  });
}

// Per-IP cap on requests that would start a new guest session. Requests that already have a session are not counted,
// so a bot cannot create unlimited guest accounts, but a person using the site normally never notices.
export function createGuestLimiter(limit = Number(process.env.GUEST_RATE_LIMIT ?? 10)) {
  return limiter({
    windowMs: 60 * 60 * 1000,
    limit,
    message: "Too many new sessions from your network. Please try again later.",
    skip: (req) => Boolean(req.user),
  });
}
