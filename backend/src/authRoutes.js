import express from "express";
import rateLimit from "express-rate-limit";
import db from "./db.js";
import { asyncHandler } from "./asyncHandler.js";
import {
  hashPassword,
  verifyPassword,
  getDummyHash,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
} from "./auth.js";

export function createAuthLimiter(limit = Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10)) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many attempts. Please try again later." },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readCredentials(body) {
  return {
    email: typeof body?.email === "string" ? body.email.trim().toLowerCase() : "",
    password: typeof body?.password === "string" ? body.password : "",
  };
}

function validateNewCredentials({ email, password }) {
  if (!EMAIL_RE.test(email) || email.length > 254) return "A valid email is required";
  if (password.length < 8) return "Password must be at least 8 characters";
  if (password.length > 128) return "Password must be at most 128 characters";
  return null;
}

const router = express.Router();
const limiter = createAuthLimiter();

router.get("/me", (req, res) => {
  res.json({ user: req.user });
});

router.post("/register", limiter, asyncHandler(async (req, res) => {
  const creds = readCredentials(req.body);
  const problem = validateNewCredentials(creds);
  if (problem) return res.status(400).json({ error: problem });
  if (req.user && !req.user.isGuest) return res.status(400).json({ error: "You are already signed in" });

  if (db.prepare("SELECT id FROM users WHERE email = ?").get(creds.email)) {
    return res.status(409).json({ error: "An account with that email already exists" });
  }

  const passwordHash = await hashPassword(creds.password);
  let userId;
  try {
    if (req.user?.isGuest) {
      // Upgrade the guest in place so their library carries over with no data migration.
      db.prepare("UPDATE users SET email = ?, password_hash = ?, is_guest = 0 WHERE id = ?").run(
        creds.email,
        passwordHash,
        req.user.id
      );
      userId = req.user.id;
      destroySession(req.sessionToken);
    } else {
      const now = new Date().toISOString();
      const result = db
        .prepare("INSERT INTO users (email, password_hash, is_guest, created_at, last_seen_at) VALUES (?, ?, 0, ?, ?)")
        .run(creds.email, passwordHash, now, now);
      userId = Number(result.lastInsertRowid);
    }
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "An account with that email already exists" });
    }
    throw err;
  }

  setSessionCookie(res, createSession(userId));
  res.status(201).json({ user: { id: userId, email: creds.email, isGuest: false } });
}));

router.post("/login", limiter, asyncHandler(async (req, res) => {
  const { email, password } = readCredentials(req.body);
  if (!email || !password || password.length > 128) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const user = db.prepare("SELECT id, email, password_hash FROM users WHERE email = ? AND is_guest = 0").get(email);
  const passwordOk = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()));
  if (!user || !passwordOk) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const guest = req.user?.isGuest && req.user.id !== user.id ? req.user : null;
  const merge = req.body?.mergeGuestData === true;
  let mergedLists = 0;

  db.transaction(() => {
    if (guest && merge) {
      mergedLists = db.prepare("UPDATE lists SET user_id = ? WHERE user_id = ?").run(user.id, guest.id).changes;
      db.prepare("UPDATE OR IGNORE time_estimate_includes SET user_id = ? WHERE user_id = ?").run(user.id, guest.id);
      db.prepare("DELETE FROM users WHERE id = ?").run(guest.id);
    } else if (req.sessionToken) {
      destroySession(req.sessionToken);
    }
  })();

  setSessionCookie(res, createSession(user.id));
  res.json({ user: { id: user.id, email: user.email, isGuest: false }, mergedLists });
}));

router.post("/logout", (req, res) => {
  if (req.sessionToken) destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.status(204).end();
});

export default router;
