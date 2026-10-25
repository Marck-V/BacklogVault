import rateLimit from "express-rate-limit";
import type { Request } from "express";
import { createVisitorLimiter } from "./visitorLimits.ts";

interface LimiterOptions {
  windowMs: number;
  limit: number;
  message: string;
  skip?: (req: Request) => boolean;
}

function limiter({ windowMs, limit, message, skip }: LimiterOptions) {
  return rateLimit({ windowMs, limit, standardHeaders: "draft-7", legacyHeaders: false, message: { error: message }, skip });
}

// Cap on changes (create, edit, delete). Reads are not counted. Counted per visitor with a session, plus a larger
// ceiling for everyone behind one address (see visitorLimits.ts).
export function createWriteLimiter(
  limit = Number(process.env.WRITE_RATE_LIMIT ?? 120),
  addressLimit = Number(process.env.WRITE_ADDRESS_RATE_LIMIT ?? limit * 5)
) {
  return createVisitorLimiter({
    windowMs: 60 * 1000,
    limit,
    addressLimit,
    message: { error: "Too many changes in a short time. Please slow down." },
    skip: (req: Request) => ["GET", "HEAD", "OPTIONS"].includes(req.method),
  });
}

// Per-IP cap on requests that would start a new guest session. Requests that already have a session are not counted,
// so a bot cannot create unlimited guest accounts, but a person using the site normally never notices.
export function createGuestLimiter(limit = Number(process.env.GUEST_RATE_LIMIT ?? 10)) {
  return limiter({
    windowMs: 60 * 60 * 1000,
    limit,
    message: "Too many new sessions from your network. Please try again later.",
    skip: (req: Request) => Boolean(req.user),
  });
}

// Per-IP cap on Steam imports. Each one spends Steam and IGDB quota, so it is much stricter than ordinary writes.
export function createImportLimiter(limit = Number(process.env.IMPORT_RATE_LIMIT ?? 5)) {
  return limiter({
    windowMs: 60 * 60 * 1000,
    limit,
    message: "You have started several imports recently. Please try again later.",
  });
}

// Per-IP cap on Steam sign-in attempts. Each one costs a call to Steam, and nobody needs many.
export function createSteamLinkLimiter(limit = Number(process.env.STEAM_LINK_RATE_LIMIT ?? 20)) {
  return limiter({
    windowMs: 60 * 60 * 1000,
    limit,
    message: "Too many Steam sign-in attempts. Please try again later.",
  });
}

// Per-IP cap on restoring backup files. Each one can write thousands of rows, so it is stricter than ordinary writes.
export function createRestoreLimiter(limit = Number(process.env.RESTORE_RATE_LIMIT ?? 10)) {
  return limiter({
    windowMs: 60 * 60 * 1000,
    limit,
    message: "You have restored several backups recently. Please try again later.",
  });
}
