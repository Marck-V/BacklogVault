import db from "./db.ts";
import { igdbRequest } from "./igdbClient.ts";
import { fetchAchievements, SteamError, type AchievementResult } from "./steam.ts";
import { STEAM_SOURCE_ID } from "./gameDetails.ts";

const CACHE_MS = 10 * 60 * 1000;
const MAX_USERS = 5000;
const MAX_PER_USER = 200;

// userId -> Map(igdbId -> { at, result }). It only saves calls to Steam; losing it (a restart) costs nothing, and it is
// emptied when someone disconnects Steam or deletes their data.
const cache = new Map<number, Map<number, { at: number; result: AchievementResult }>>();

export function forgetAchievements(userId: number): void {
  cache.delete(userId);
}

export function clearAchievementCache() {
  cache.clear();
}

function remember(userId: number, igdbId: number, result: AchievementResult): void {
  const oldestUser = cache.keys().next().value;
  if (!cache.has(userId) && cache.size >= MAX_USERS && oldestUser !== undefined) cache.delete(oldestUser);
  const mine = cache.get(userId) ?? new Map<number, { at: number; result: AchievementResult }>();
  const oldestGame = mine.keys().next().value;
  if (mine.size >= MAX_PER_USER && oldestGame !== undefined) mine.delete(oldestGame);
  mine.set(igdbId, { at: Date.now(), result });
  cache.set(userId, mine);
}

// How far the connected Steam account is through one game's achievements. Steam is asked only for a visitor who has
// connected their own account, and only when they open that game. The answer is one of:
//   { status: "not_connected" }   no connected Steam account (or Steam is switched off on this server)
//   { status: "none" }            Steam has no achievements for this game, or IGDB has no Steam page for it
//   { status: "private" }         the profile's game details are not public
//   { status: "unavailable" }     Steam (or IGDB) did not answer; nothing is cached, so the next open tries again
//   { status: "ok", total, unlocked }
export async function gameAchievements(userId: number | null | undefined, igdbId: number): Promise<AchievementResult> {
  const apiKey = process.env.STEAM_API_KEY;
  if (!userId || !apiKey) return { status: "not_connected" };
  const steamId = db
    .prepare<[number], { steam_id: string }>("SELECT steam_id FROM users WHERE id = ? AND steam_verified = 1")
    .get(userId)?.steam_id;
  if (!steamId) return { status: "not_connected" };

  const hit = cache.get(userId)?.get(igdbId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;

  try {
    const rows = await igdbRequest<Array<{ uid?: unknown }>>(
      "external_games",
      `fields uid; where game = ${igdbId} & external_game_source = ${STEAM_SOURCE_ID}; limit 5;`
    );
    const appId = rows.map((row) => row?.uid).find((uid): uid is string => typeof uid === "string" && /^\d{1,10}$/.test(uid));
    const result: AchievementResult = appId ? await fetchAchievements(steamId, appId, apiKey) : { status: "none" };
    // A private profile is not remembered, so changing the privacy setting works on the very next open.
    if (result.status !== "private") remember(userId, igdbId, result);
    return result;
  } catch (err) {
    // Log the kind of failure, never the request: Steam's address carries the API key.
    console.error(err instanceof SteamError ? `Achievements failed: ${err.kind}` : err);
    return { status: "unavailable" };
  }
}
