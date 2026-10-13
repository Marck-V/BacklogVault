import crypto from "crypto";
import { promisify } from "util";
import db from "./db.js";

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

export const SESSION_COOKIE = "bv_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

// --- Passwords: scrypt with a random per-user salt, stored as scrypt$N$r$p$salt$hash ---

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

export async function verifyPassword(password, stored) {
  const parts = String(stored).split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  try {
    const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT.maxmem,
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

let dummyHash;
// Verifying against this when the email is unknown keeps login timing the same for real and fake accounts.
export function getDummyHash() {
  dummyHash ??= hashPassword("not-a-real-password");
  return dummyHash;
}

// --- Sessions: the cookie holds a random token, the database only stores its SHA-256 hash ---

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    hashToken(token),
    userId,
    new Date(now).toISOString(),
    new Date(now + SESSION_TTL_MS).toISOString()
  );
  return token;
}

export function destroySession(token) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

function cookieOptions() {
  return { httpOnly: true, sameSite: "lax", secure: process.env.COOKIE_SECURE === "true", path: "/" };
}

export function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_TTL_MS });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

// --- Middleware ---

export function attachUser(req, res, next) {
  req.user = null;
  req.sessionToken = null;

  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === "string" && token) {
    const row = db
      .prepare(
        `SELECT u.id, u.email, u.is_guest, u.last_seen_at, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`
      )
      .get(hashToken(token));

    if (row && new Date(row.expires_at).getTime() > Date.now()) {
      req.user = { id: row.id, email: row.email, isGuest: Boolean(row.is_guest) };
      req.sessionToken = token;

      // Sliding expiry, written at most once an hour so reads do not turn into writes.
      if (Date.now() - new Date(row.last_seen_at).getTime() > TOUCH_INTERVAL_MS) {
        const now = Date.now();
        db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(new Date(now).toISOString(), row.id);
        db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").run(
          new Date(now + SESSION_TTL_MS).toISOString(),
          hashToken(token)
        );
        setSessionCookie(res, token);
      }
    }
  }
  next();
}

// Guests are created lazily, on the first valid write, so people who only browse never create a row.
export function ensureUser(req, res) {
  if (req.user) return req.user;
  const nowIso = new Date().toISOString();
  const result = db
    .prepare("INSERT INTO users (is_guest, created_at, last_seen_at) VALUES (1, ?, ?)")
    .run(nowIso, nowIso);
  const token = createSession(result.lastInsertRowid);
  setSessionCookie(res, token);
  req.user = { id: Number(result.lastInsertRowid), email: null, isGuest: true };
  req.sessionToken = token;
  return req.user;
}

// --- Cleanup ---

export function purgeStale({ guestMaxAgeDays = 90 } = {}) {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - guestMaxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  const sessions = db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now).changes;
  db.prepare("DELETE FROM steam_link_attempts WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM steam_api_usage WHERE day < ?").run(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const guests = db.prepare("DELETE FROM users WHERE is_guest = 1 AND last_seen_at < ?").run(cutoff).changes;
  return { sessions, guests };
}
