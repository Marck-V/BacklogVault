import db from "./db.ts";
import type { PlaytimeSnapshot } from "../../shared/api.ts";

const today = () => new Date().toISOString().slice(0, 10);

// Saves today's library totals for the user (hidden games left out, like every other dashboard number). Called whenever
// the dashboard is read or the hours change, so a day with any visit gets a row and the last reading of the day wins.
// A library with no games records nothing, and an unchanged day is not written again.
export function recordPlaytimeSnapshot(userId: number): void {
  try {
    const totals = db
      .prepare<[number], { game_count: number; total_hours: number; completed_count: number }>(
        `SELECT COUNT(*) AS game_count, COALESCE(SUM(hours), 0) AS total_hours, COALESCE(SUM(completed), 0) AS completed_count
         FROM (
           SELECT lg.igdb_id,
                  MAX(COALESCE(lg.hours_played, 0)) AS hours,
                  MAX(lg.status = 'Completed') AS completed
           FROM list_games lg JOIN lists l ON l.id = lg.list_id
           WHERE l.user_id = ? AND lg.hidden = 0
           GROUP BY lg.igdb_id
         )`
      )
      .get(userId);
    if (!totals || totals.game_count === 0) return;
    db.prepare(
      `INSERT INTO playtime_snapshots (user_id, day, total_hours, game_count, completed_count) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, day) DO UPDATE SET
         total_hours = excluded.total_hours, game_count = excluded.game_count, completed_count = excluded.completed_count
       WHERE total_hours IS NOT excluded.total_hours OR game_count IS NOT excluded.game_count
          OR completed_count IS NOT excluded.completed_count`
    ).run(userId, today(), Math.round(totals.total_hours * 10) / 10, totals.game_count, totals.completed_count);
  } catch (err) {
    // History is a bonus: never let it break the page that triggered it.
    console.error(err);
  }
}

export function playtimeHistory(userId: number, limit = 366): PlaytimeSnapshot[] {
  return db
    .prepare<[number, number], PlaytimeSnapshot>(
      `SELECT day, total_hours, game_count, completed_count FROM (
         SELECT day, total_hours, game_count, completed_count FROM playtime_snapshots
         WHERE user_id = ? ORDER BY day DESC LIMIT ?
       ) ORDER BY day`
    )
    .all(userId, limit);
}
