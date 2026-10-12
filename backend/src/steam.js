const STEAM_API = "https://api.steampowered.com";
const REQUEST_TIMEOUT_MS = 10000;
export const MAX_OWNED_APPS = 20000;

const STEAM_ID64 = /^7656119\d{10}$/;
const VANITY_NAME = /^[A-Za-z0-9_-]{2,32}$/;
// The profile segment must end at a path boundary, so "…/id/bad name" is refused instead of reading as "bad".
const PROFILE_URL = /^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/(profiles|id)\/([^/?#\s]+)(?:[/?#].*)?$/i;

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

const invalidInput = () =>
  new SteamError(
    "invalid_input",
    "Enter a Steam profile link, a 17-digit Steam ID, or your custom profile name.",
    400
  );

const unavailable = (upstreamStatus) =>
  new SteamError("unavailable", "Steam isn't responding right now. Please try again in a minute.", 502, upstreamStatus);

// Accepts a profile link (https://steamcommunity.com/id/name or /profiles/7656119...), a 17-digit Steam ID,
// or a bare custom profile name. Only characters Steam allows get through, so nothing odd reaches a URL.
export function parseSteamIdentifier(raw) {
  if (typeof raw !== "string") throw invalidInput();
  const text = raw.trim();
  if (!text || text.length > 200) throw invalidInput();

  if (STEAM_ID64.test(text)) return { type: "id", value: text };

  const url = PROFILE_URL.exec(text);
  if (url) {
    const kind = url[1].toLowerCase();
    const value = url[2];
    if (kind === "profiles") {
      if (STEAM_ID64.test(value)) return { type: "id", value };
      throw invalidInput();
    }
    if (VANITY_NAME.test(value)) return { type: "vanity", value };
    throw invalidInput();
  }

  if (VANITY_NAME.test(text)) return { type: "vanity", value: text };
  throw invalidInput();
}

async function steamGet(path, params, apiKey) {
  const url = new URL(`${STEAM_API}${path}`);
  url.search = new URLSearchParams({ ...params, key: apiKey, format: "json" }).toString();

  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { Accept: "application/json" } });
  } catch {
    // Deliberately not rethrown or logged: the message of a failed fetch can include the URL, and so the key.
    throw unavailable();
  }
  if (!res.ok) throw unavailable(res.status);

  try {
    return await res.json();
  } catch {
    throw unavailable(res.status);
  }
}

export async function resolveSteamId(identifier, apiKey) {
  if (identifier.type === "id") return identifier.value;

  const body = await steamGet("/ISteamUser/ResolveVanityURL/v1/", { vanityurl: identifier.value }, apiKey);
  const result = body?.response;
  if (result?.success === 1 && STEAM_ID64.test(String(result.steamid))) return String(result.steamid);
  // 42 is what Steam returns for a name that matches no profile (community-documented, not in Valve's docs).
  if (result?.success === 42) throw new SteamError("not_found", "We couldn't find that Steam profile.", 404);
  throw unavailable();
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
