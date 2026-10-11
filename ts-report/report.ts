import Database from "better-sqlite3";
import path from "path";

// --- Types ---

type Status = "Backlog" | "Playing" | "Completed" | "Dropped";

interface GameEntry {
  id: number;
  list_id: number;
  list_name: string;
  igdb_id: number;
  name: string;
  status: Status;
  added_at: string;
}

interface StatusCounts {
  Backlog: number;
  Playing: number;
  Completed: number;
  Dropped: number;
}

interface Report {
  totalGames: number;
  counts: StatusCounts;
  longestWaiting: GameEntry | null;
  currentlyPlaying: GameEntry[];
}

// --- Database ---

const dbPath = path.resolve(__dirname, "..", "backend", "backlog.db");
const db = new Database(dbPath, { readonly: true });

function fetchGames(): GameEntry[] {
  return db
    .prepare(
      `SELECT lg.id, lg.list_id, l.name AS list_name, lg.igdb_id,
              lg.name, lg.status, lg.added_at
       FROM list_games lg
       JOIN lists l ON l.id = lg.list_id
       ORDER BY lg.added_at ASC`
    )
    .all() as GameEntry[];
}

// --- Report logic ---

function buildReport(games: GameEntry[]): Report {
  const counts: StatusCounts = { Backlog: 0, Playing: 0, Completed: 0, Dropped: 0 };

  for (const game of games) {
    counts[game.status]++;
  }

  const longestWaiting = games.find((g) => g.status === "Backlog") ?? null;
  const currentlyPlaying = games.filter((g) => g.status === "Playing");

  return { totalGames: games.length, counts, longestWaiting, currentlyPlaying };
}

// --- Display ---

function formatDate(dateStr: string): string {
  return dateStr.slice(0, 10);
}

function line(char: string = "─", width: number = 36): string {
  return char.repeat(width);
}

function printReport(report: Report): void {
  console.log("\n" + line("═"));
  console.log("  📋  BacklogVault Report");
  console.log(line("═"));

  console.log(`\n  Total games tracked : ${report.totalGames}`);
  console.log(`  Backlog             : ${report.counts.Backlog}`);
  console.log(`  Currently Playing   : ${report.counts.Playing}`);
  console.log(`  Completed           : ${report.counts.Completed}`);
  console.log(`  Dropped             : ${report.counts.Dropped}`);

  if (report.currentlyPlaying.length > 0) {
    console.log("\n" + line());
    console.log("  🎮  Currently Playing");
    console.log(line());
    for (const game of report.currentlyPlaying) {
      console.log(`  • ${game.name}  (${game.list_name})`);
    }
  }

  if (report.longestWaiting) {
    const g = report.longestWaiting;
    console.log("\n" + line());
    console.log("  ⏳  Longest Waiting in Backlog");
    console.log(line());
    console.log(`  ${g.name}`);
    console.log(`  Added ${formatDate(g.added_at)} · List: ${g.list_name}`);
  }

  const completion =
    report.totalGames > 0
      ? Math.round((report.counts.Completed / report.totalGames) * 100)
      : 0;

  console.log("\n" + line());
  console.log("  📊  Completion Rate");
  console.log(line());
  console.log(`  ${completion}% of tracked games completed`);
  const filled = Math.round(completion / 5);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  console.log(`  [${bar}] ${completion}%`);

  console.log("\n" + line("═") + "\n");
}

// --- Run ---

const games = fetchGames();
const report = buildReport(games);
printReport(report);

db.close();
