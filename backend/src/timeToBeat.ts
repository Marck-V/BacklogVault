import { igdbRequest } from "./igdbClient.ts";
import db from "./db.ts";

export interface TimeToBeatSnapshot {
  main_seconds: number | null;
  completionist_seconds: number | null;
}

interface IgdbTimeToBeat {
  game_id?: number;
  normally?: number;
  completely?: number;
}

const snapshotOf = (t: IgdbTimeToBeat | undefined): TimeToBeatSnapshot => ({
  main_seconds: t?.normally ?? null,
  completionist_seconds: t?.completely ?? null,
});

// IGDB's estimate for one game, seconds for the main story and for 100%. Saved when a game is added, so a failed lookup
// must never block adding it: null means IGDB could not be reached, and the dashboard fills the game in later.
export async function fetchTimeToBeat(igdbId: number): Promise<TimeToBeatSnapshot | null> {
  try {
    const [t] = await igdbRequest<IgdbTimeToBeat[]>("game_time_to_beats", `fields normally,completely; where game_id = ${igdbId};`);
    return snapshotOf(t);
  } catch (err) {
    console.error(err);
    return null;
  }
}

// Looks the given games up on IGDB (one request per 500 games) and saves the estimate on every row of each game.
// Games IGDB has no estimate for are saved as checked with nothing, so they are not asked about again. With
// keepExisting (a refresh), a game IGDB now has nothing for keeps the estimate it already had instead of losing it.
// Returns how many games ended up with a different estimate. Throws when IGDB cannot be reached; whatever was saved
// before that stays saved.
export async function backfillTimeToBeat(igdbIds: number[], { keepExisting = false } = {}): Promise<number> {
  const current = db.prepare<[number], { main: number | null; completionist: number | null }>(
    `SELECT MAX(time_to_beat_main_seconds) AS main, MAX(time_to_beat_completionist_seconds) AS completionist
     FROM list_games WHERE igdb_id = ?`
  );
  const save = db.prepare(
    `UPDATE list_games SET time_to_beat_main_seconds = ?, time_to_beat_completionist_seconds = ?, time_to_beat_checked_at = CURRENT_TIMESTAMP
     WHERE igdb_id = ?`
  );
  let changed = 0;
  for (let i = 0; i < igdbIds.length; i += 500) {
    const chunk = igdbIds.slice(i, i + 500);
    const found = await igdbRequest<IgdbTimeToBeat[]>(
      "game_time_to_beats",
      `fields game_id,normally,completely; where game_id = (${chunk.join(",")}); limit 500;`
    );
    const byGame = new Map(found.filter((t) => typeof t.game_id === "number").map((t) => [t.game_id as number, t]));
    db.transaction(() => {
      for (const id of chunk) {
        const before = current.get(id);
        const s = snapshotOf(byGame.get(id));
        const main = keepExisting ? (s.main_seconds ?? before?.main ?? null) : s.main_seconds;
        const completionist = keepExisting ? (s.completionist_seconds ?? before?.completionist ?? null) : s.completionist_seconds;
        if (main !== (before?.main ?? null) || completionist !== (before?.completionist ?? null)) changed += 1;
        save.run(main, completionist, id);
      }
    })();
  }
  return changed;
}
