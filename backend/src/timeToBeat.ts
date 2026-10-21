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

// Fills in the snapshot for games added before it existed (or while IGDB was down), one IGDB request per 500 games.
// Games IGDB has no estimate for are saved as checked with nothing, so they are not asked about again. Throws when
// IGDB cannot be reached; whatever was saved before that stays saved.
export async function backfillTimeToBeat(igdbIds: number[]): Promise<void> {
  const save = db.prepare(
    `UPDATE list_games SET time_to_beat_main_seconds = ?, time_to_beat_completionist_seconds = ?, time_to_beat_checked_at = CURRENT_TIMESTAMP
     WHERE igdb_id = ?`
  );
  for (let i = 0; i < igdbIds.length; i += 500) {
    const chunk = igdbIds.slice(i, i + 500);
    const found = await igdbRequest<IgdbTimeToBeat[]>(
      "game_time_to_beats",
      `fields game_id,normally,completely; where game_id = (${chunk.join(",")}); limit 500;`
    );
    const byGame = new Map(found.filter((t) => typeof t.game_id === "number").map((t) => [t.game_id as number, t]));
    db.transaction(() => {
      for (const id of chunk) {
        const s = snapshotOf(byGame.get(id));
        save.run(s.main_seconds, s.completionist_seconds, id);
      }
    })();
  }
}
