import db from "./db.js";

const STEAM_API = "https://api.steampowered.com";
const REQUEST_TIMEOUT_MS = 10000;
export const MAX_OWNED_APPS = 20000;

// kind says what went wrong, status is the HTTP status we answer with, message is safe to show to a visitor.
// None of these ever carries the Steam URL or the original error, because Steam wants the API key in the URL.
export class SteamError extends Error {
  constructor(kind, message, status, upstreamStatus) {
    super(message);
    this.name = "SteamError";
    this.kind = kind;
    this.status = status;
    this.upstreamStatus = upstreamStatus;
  }
}

const unavailable = (upstreamStatus) =>
  new SteamError("unavailable", "Steam isn't responding right now. Please try again in a minute.", 502, upstreamStatus);

// Steam's terms cap the Web API at 100,000 calls a day for the whole site, whoever triggers them. We stop at 90,000 (by UTC
// day, kept in the database so a restart does not reset it) and answer "try again tomorrow" instead of risking the key.
export const DEFAULT_DAILY_CALL_LIMIT = 90000;

function spendCall() {
  const limit = Number(process.env.STEAM_DAILY_CALL_LIMIT ?? DEFAULT_DAILY_CALL_LIMIT);
  const day = new Date().toISOString().slice(0, 10);
  db.transaction(() => {
    const used = db.prepare("SELECT calls FROM steam_api_usage WHERE day = ?").get(day)?.calls ?? 0;
    if (used >= limit) {
      throw new SteamError(
        "quota",
        "Steam lookups are paused for today because this site has used its daily allowance. Please try again tomorrow.",
        503
      );
    }
    db.prepare("INSERT INTO steam_api_usage (day, calls) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET calls = calls + 1").run(day);
  })();
}

// okStatuses: HTTP statuses whose body is still an answer we can read (Steam reports some private or empty cases that way).
async function steamGet(path, params, apiKey, { okStatuses = [] } = {}) {
  spendCall();
  const url = new URL(`${STEAM_API}${path}`);
  url.search = new URLSearchParams({ ...params, key: apiKey, format: "json" }).toString();

  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { Accept: "application/json" } });
  } catch {
    // Deliberately not rethrown or logged: the message of a failed fetch can include the URL, and so the key.
    throw unavailable();
  }
  if (!res.ok && !okStatuses.includes(res.status)) throw unavailable(res.status);

  try {
    return await res.json();
  } catch {
    throw unavailable(res.status);
  }
}

// Returns [{ appid, name, minutes }]. Steam answers with an empty object when the owned games are not visible.
export async function fetchOwnedGames(steamId, apiKey) {
  const body = await steamGet(
    "/IPlayerService/GetOwnedGames/v1/",
    { steamid: steamId, include_appinfo: 1, include_played_free_games: 1 },
    apiKey
  );
  const result = body?.response;
  if (!result || typeof result !== "object") throw unavailable();

  if (!Array.isArray(result.games)) {
    if (result.game_count === 0) {
      throw new SteamError("empty", "That Steam account has no games to import.", 422);
    }
    throw new SteamError(
      "private",
      "We couldn't see that profile's games. In Steam, open your profile, choose Edit Profile, then Privacy Settings, " +
        "set Game details to Public, and try again.",
      422
    );
  }

  if (result.games.length > MAX_OWNED_APPS) {
    throw new SteamError("too_large", `That library is too large to import (over ${MAX_OWNED_APPS} games).`, 422);
  }

  return result.games
    .filter((game) => Number.isInteger(game?.appid) && game.appid > 0)
    .map((game) => ({
      appid: game.appid,
      name: typeof game.name === "string" && game.name.trim() ? game.name.trim() : `Steam app ${game.appid}`,
      minutes: Number.isFinite(game.playtime_forever) && game.playtime_forever > 0 ? game.playtime_forever : 0,
    }));
}

// Games played in the last two weeks, most played first: [{ appid, name, minutes }] (minutes are for those two weeks).
// Steam answers with no games both for "nothing played lately" and for a private profile, so both give [].
export async function fetchRecentlyPlayed(steamId, apiKey, count = 12) {
  const body = await steamGet("/IPlayerService/GetRecentlyPlayedGames/v1/", { steamid: steamId, count }, apiKey);
  const result = body?.response;
  if (!result || typeof result !== "object") throw unavailable();
  if (!Array.isArray(result.games)) return [];

  return result.games
    .filter((game) => Number.isInteger(game?.appid) && game.appid > 0)
    .map((game) => ({
      appid: game.appid,
      name: typeof game.name === "string" && game.name.trim() ? game.name.trim() : `Steam app ${game.appid}`,
      minutes: Number.isFinite(game.playtime_2weeks) && game.playtime_2weeks > 0 ? game.playtime_2weeks : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes);
}

// The account's display name, for showing "Connected as ...". Best effort: a failure just means no name is shown.
export async function fetchPersonaName(steamId, apiKey) {
  try {
    const body = await steamGet("/ISteamUser/GetPlayerSummaries/v2/", { steamids: steamId }, apiKey);
    const name = body?.response?.players?.[0]?.personaname;
    return typeof name === "string" && name.trim() ? name.trim().slice(0, 100) : null;
  } catch {
    return null;
  }
}

// How many of one game's achievements the account has unlocked. Steam answers with a "success: false" body (and an HTTP
// 400 or 403) when the profile is not public or the game has no achievements, so those are told apart by their message.
export async function fetchAchievements(steamId, appId, apiKey) {
  const body = await steamGet(
    "/ISteamUserStats/GetPlayerAchievements/v1/",
    { steamid: steamId, appid: appId },
    apiKey,
    { okStatuses: [400, 403] }
  );
  const stats = body?.playerstats;
  if (!stats || typeof stats !== "object") throw unavailable();

  if (stats.success === true) {
    const list = Array.isArray(stats.achievements) ? stats.achievements : [];
    if (list.length === 0) return { status: "none" };
    return { status: "ok", total: list.length, unlocked: list.filter((a) => a?.achieved === 1).length };
  }
  return /not public/i.test(String(stats.error ?? "")) ? { status: "private" } : { status: "none" };
}
