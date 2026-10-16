import db from "./db.ts";
import { igdbRequest } from "./igdbClient.ts";
import { fetchOwnedGames, SteamError } from "./steam.ts";
import { STEAM_SOURCE_ID } from "./gameDetails.ts";
import { hoursFromMinutes } from "./steamImport.ts";
import type { ListGameRow } from "./types.ts";

const IGDB_BATCH = 200;

// Brings the hours of games already in the user's lists up to what Steam says, using one Steam call for the whole
// library. It never lowers an hour count: if someone typed 40 hours by hand and Steam says 35, their 40 stays. It does
// not add games (that is what Import is for), and it only touches the games the user already has.
// Returns { status: "ok", updated } where updated is how many different games got more hours.
export async function refreshPlaytime(userId: number, steamId: string, apiKey: string): Promise<{ status: "ok"; updated: number }> {
  const owned = await fetchOwnedGames(steamId, apiKey);
  const minutesByApp = new Map(owned.map((game) => [String(game.appid), game.minutes]));

  const rows = db
    .prepare<[number], Pick<ListGameRow, "id" | "igdb_id" | "hours_played">>(
      `SELECT lg.id, lg.igdb_id, lg.hours_played FROM list_games lg JOIN lists l ON l.id = lg.list_id WHERE l.user_id = ?`
    )
    .all(userId);
  const igdbIds = [...new Set(rows.map((row) => row.igdb_id))];

  // Which Steam apps each of the user's games is, according to IGDB.
  const appsByGame = new Map<number, Set<string>>();
  try {
    for (let i = 0; i < igdbIds.length; i += IGDB_BATCH) {
      const batch = igdbIds.slice(i, i + IGDB_BATCH);
      const found = await igdbRequest<Array<{ uid?: unknown; game?: unknown }>>(
        "external_games",
        `fields uid,game; where external_game_source = ${STEAM_SOURCE_ID} & game = (${batch.join(",")}); limit 500;`
      );
      for (const row of found) {
        if (typeof row?.game !== "number" || !Number.isInteger(row.game) || typeof row.uid !== "string") continue;
        const apps = appsByGame.get(row.game) ?? new Set<string>();
        apps.add(row.uid);
        appsByGame.set(row.game, apps);
      }
    }
  } catch (err) {
    console.error(err);
    throw new SteamError(
      "igdb_unavailable",
      "We couldn't match your games right now because IGDB isn't responding. Please try again in a minute.",
      502
    );
  }

  // Two Steam apps for one game (a base game and an edition) add up, the same way the import does it.
  const steamHours = new Map();
  for (const [igdbId, apps] of appsByGame) {
    let minutes = 0;
    for (const app of apps) minutes += minutesByApp.get(app) ?? 0;
    const hours = hoursFromMinutes(minutes);
    if (hours !== null) steamHours.set(igdbId, hours);
  }

  const raise = db.prepare("UPDATE list_games SET hours_played = ? WHERE id = ?");
  const raisedGames = new Set();
  db.transaction(() => {
    for (const row of rows) {
      const hours = steamHours.get(row.igdb_id);
      if (hours !== undefined && hours > (row.hours_played ?? 0)) {
        raise.run(hours, row.id);
        raisedGames.add(row.igdb_id);
      }
    }
  })();

  return { status: "ok", updated: raisedGames.size };
}
