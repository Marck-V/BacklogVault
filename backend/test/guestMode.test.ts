import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import request from "supertest";
import app from "../src/app.ts";
import db from "../src/db.ts";
import { LIMITS } from "../src/limits.ts";
import { backupDatabase } from "../src/backupDatabase.ts";
import { MAX_RESTORE_GAMES, BACKUP_FORMAT } from "../src/libraryBackup.ts";
import { resetDb, newClient, createList, addGame, type Client, dbGet, dbAll } from "./helpers.ts";

let client: Client;

beforeEach(() => {
  resetDb();
  db.exec("DELETE FROM time_estimate_includes");
  client = newClient(app);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const game = (n, extra = {}) => ({
  igdb_id: n,
  name: `Game ${n}`,
  cover_url: `https://images.igdb.com/igdb/image/upload/t_cover_big/${n}.jpg`,
  status: "Backlog",
  rating: null,
  hours_played: null,
  notes: null,
  date_completed: null,
  added_at: "2026-01-02 03:04:05",
  ...extra,
});
const backup = (lists, extra = {}) => ({ app: "BacklogVault", format: BACKUP_FORMAT, lists, ...extra });
const restore = (body, agent = client) => agent.post("/api/library/restore").send(body);
const rows = () => dbAll("SELECT l.name AS list, lg.* FROM list_games lg JOIN lists l ON l.id = lg.list_id ORDER BY l.name, lg.igdb_id");

describe("accounts are off unless switched on", () => {
  it("tells the website whether to offer sign up and sign in", async () => {
    expect((await client.get("/api/auth/me")).body.accountsEnabled).toBe(true);
    vi.stubEnv("ENABLE_ACCOUNTS", "false");
    expect((await client.get("/api/auth/me")).body.accountsEnabled).toBe(false);
    vi.stubEnv("ENABLE_ACCOUNTS", "");
    expect((await client.get("/api/auth/me")).body.accountsEnabled).toBe(false);
  });

  it("turns the sign up and sign in endpoints off too, not just the buttons", async () => {
    vi.stubEnv("ENABLE_ACCOUNTS", "false");
    const credentials = { email: "a@example.com", password: "correct horse battery" };
    const register = await client.post("/api/auth/register").send(credentials);
    const login = await client.post("/api/auth/login").send(credentials);
    expect(register.status).toBe(404);
    expect(login.status).toBe(404);
    expect(register.body.error).toMatch(/aren't available yet/);
    expect(dbGet("SELECT COUNT(*) AS n FROM users").n).toBe(0);
  });

  it("still gives visitors a library without an account", async () => {
    vi.stubEnv("ENABLE_ACCOUNTS", "false");
    const list = await createList(client, "Mine");
    await addGame(client, list.id, { igdb_id: 1 });
    expect((await client.get(`/api/lists/${list.id}`)).body.games).toHaveLength(1);
  });
});

describe("GET /api/library/backup", () => {
  it("needs something to back up", async () => {
    expect((await request(app).get("/api/library/backup")).status).toBe(401);
  });

  it("downloads the whole library as a dated file, with everything needed to restore it", async () => {
    const list = await createList(client, "Weekend");
    const g = await addGame(client, list.id, { igdb_id: 7, name: "Hades", cover_url: "https://images.igdb.com/x.jpg" });
    await client.put(`/api/lists/${list.id}/games/${g.id}`).send({ status: "Completed", rating: 9, hoursPlayed: 42.5, notes: "Great" });

    const res = await client.get("/api/library/backup");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="backlogvault-backup-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(res.body).toMatchObject({ app: "BacklogVault", format: 1 });
    expect(res.body.lists).toHaveLength(1);
    expect(res.body.lists[0]).toMatchObject({
      name: "Weekend",
      games: [{ igdb_id: 7, name: "Hades", cover_url: "https://images.igdb.com/x.jpg", status: "Completed", rating: 9, hours_played: 42.5, notes: "Great" }],
    });
    expect(res.body.lists[0].games[0].date_completed).toMatch(/^\d{4}-/);
  });

  it("holds only the visitor's own data, with no internal ids", async () => {
    const mine = await createList(client, "Mine");
    await addGame(client, mine.id, { igdb_id: 1 });
    const other = newClient(app);
    const theirs = await createList(other, "Theirs");
    await addGame(other, theirs.id, { igdb_id: 2, name: "Secret" });

    const body = (await client.get("/api/library/backup")).body;
    expect(JSON.stringify(body)).not.toContain("Secret");
    expect(JSON.stringify(body)).not.toContain("user_id");
    expect(body.lists[0].games[0]).not.toHaveProperty("id");
    expect(body.lists[0].games[0]).not.toHaveProperty("list_id");
  });

  it("restores into a fresh visitor exactly what was backed up", async () => {
    const list = await createList(client, "Weekend");
    const g = await addGame(client, list.id, { igdb_id: 7, name: "Hades" });
    await client.put(`/api/lists/${list.id}/games/${g.id}`).send({ status: "Dropped", rating: 4, hoursPlayed: 3, notes: "Meh" });
    await client.put("/api/stats/time-to-beat/includes/7").send({ included: true });
    const file = (await client.get("/api/library/backup")).body;

    const fresh = newClient(app);
    const res = await restore(file, fresh);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ lists_created: 1, games_added: 1 });

    const again = (await fresh.get("/api/library/backup")).body;
    expect(again.lists).toEqual(file.lists);
    expect(again.included_estimates).toEqual([7]);
  });
});

describe("POST /api/library/restore", () => {
  it("creates lists and games, and says what happened", async () => {
    const res = await restore(backup([{ name: "A", games: [game(1), game(2)] }, { name: "B", games: [game(3)] }]));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lists_created: 2, lists_matched: 0, games_added: 3, games_already_there: 0, games_skipped: 0, games_over_limit: 0 });
    expect(rows().map((r) => [r.list, r.igdb_id])).toEqual([["A", 1], ["A", 2], ["B", 3]]);
  });

  it("works for a visitor who has no session yet, by giving them a guest session", async () => {
    const res = await restore(backup([{ name: "A", games: [game(1)] }]), newClient(app));
    expect(res.status).toBe(200);
    expect(String(res.headers["set-cookie"])).toContain("bv_session=");
  });

  it("keeps ratings, hours, notes, dates and covers", async () => {
    await restore(backup([{ name: "A", games: [game(1, { status: "Completed", rating: 8, hours_played: 12.5, notes: "Note", date_completed: "2026-02-03T00:00:00.000Z" })] }]));
    expect(rows()[0]).toMatchObject({ status: "Completed", rating: 8, hours_played: 12.5, notes: "Note", date_completed: "2026-02-03T00:00:00.000Z", added_at: "2026-01-02 03:04:05" });
  });

  it("only ever adds: a game already in the library is left exactly as it is", async () => {
    const list = await createList(client, "A");
    const mine = await addGame(client, list.id, { igdb_id: 1, name: "My version" });
    await client.put(`/api/lists/${list.id}/games/${mine.id}`).send({ status: "Playing", hoursPlayed: 99, notes: "Mine" });

    const res = await restore(backup([{ name: "A", games: [game(1, { name: "Backup version", status: "Dropped", hours_played: 1 }), game(2)] }]));
    expect(res.body).toMatchObject({ lists_created: 0, lists_matched: 1, games_added: 1, games_already_there: 1 });
    expect(rows().find((r) => r.igdb_id === 1)).toMatchObject({ name: "My version", status: "Playing", hours_played: 99, notes: "Mine" });
  });

  it("does it twice without duplicating anything", async () => {
    const file = backup([{ name: "A", games: [game(1), game(2)] }]);
    await restore(file);
    const second = await restore(file);
    expect(second.body).toMatchObject({ lists_created: 0, games_added: 0, games_already_there: 2 });
    expect(rows()).toHaveLength(2);
  });

  it("merges lists with the same name inside the file", async () => {
    const res = await restore(backup([{ name: "A", games: [game(1)] }, { name: " A ", games: [game(2)] }]));
    expect(res.body).toMatchObject({ lists_created: 1, games_added: 2 });
  });

  it("skips unusable games and counts them, but still restores the rest", async () => {
    const bad = [null, "text", {}, game(0), game(-1), game(1.5), { ...game(5), name: "" }, { ...game(6), name: "x".repeat(LIMITS.gameName + 1) }];
    const res = await restore(backup([{ name: "A", games: [...bad, game(9)] }]));
    expect(res.body).toMatchObject({ games_added: 1, games_skipped: bad.length });
    expect(rows().map((r) => r.igdb_id)).toEqual([9]);
  });

  it("repairs odd values instead of trusting them", async () => {
    await restore(
      backup([
        {
          name: "A",
          games: [
            game(1, { status: "Finished", rating: 99, hours_played: -5, cover_url: "http://insecure.example/c.jpg", notes: "n".repeat(LIMITS.notes + 1), date_completed: "yesterday", added_at: "soon" }),
            game(2, { status: "Backlog", rating: 7 }),
            game(3, { status: "Completed", rating: 7, hours_played: LIMITS.maxHours + 1 }),
          ],
        },
      ])
    );
    const [one, two, three] = rows();
    expect(one).toMatchObject({ status: "Backlog", rating: null, hours_played: null, cover_url: null, notes: null, date_completed: null });
    expect(one.added_at).toMatch(/^\d{4}-\d{2}-\d{2}/); // falls back to now
    expect(two.rating).toBeNull(); // a rating only belongs on Completed or Dropped
    expect(three).toMatchObject({ rating: 7, hours_played: null });
  });

  it("stores text as text: nothing in the file is run or interpreted", async () => {
    await restore(backup([{ name: "A'); DROP TABLE users;--", games: [game(1, { name: "<script>alert(1)</script>", notes: "'; DELETE FROM lists;--" })] }]));
    expect(dbGet("SELECT COUNT(*) AS n FROM users").n).toBe(1);
    expect(rows()[0]).toMatchObject({ list: "A'); DROP TABLE users;--", name: "<script>alert(1)</script>" });
  });

  it("restores the choices to count over-limit games, only for games that are in the library", async () => {
    await restore(backup([{ name: "A", games: [game(1)] }], { included_estimates: [1, 2, "x", -3] }));
    expect(dbAll("SELECT igdb_id FROM time_estimate_includes")).toEqual([{ igdb_id: 1 }]);
  });

  it("stops at the list limit and says how many games did not fit", async () => {
    for (let i = 0; i < LIMITS.listsPerUser - 1; i++) await createList(client, `Existing ${i}`);
    const res = await restore(backup([{ name: "New 1", games: [game(1)] }, { name: "New 2", games: [game(2), game(3)] }]));
    expect(res.body).toMatchObject({ lists_created: 1, games_added: 1, games_over_limit: 2 });
  });

  it("stops at the games-per-list limit", async () => {
    const list = await createList(client, "Full");
    const insert = db.prepare("INSERT INTO list_games (list_id, igdb_id, name) VALUES (?, ?, 'x')");
    db.transaction(() => {
      for (let i = 1; i <= LIMITS.gamesPerList - 1; i++) insert.run(list.id, i);
    })();
    const res = await restore(backup([{ name: "Full", games: [game(100001), game(100002)] }]));
    expect(res.body).toMatchObject({ games_added: 1, games_over_limit: 1 });
  });

  it("refuses files that are not backups, without creating a guest session", async () => {
    const stranger = newClient(app);
    for (const body of [{}, { app: "Other", format: 1, lists: [] }, { app: "BacklogVault", format: 2, lists: [] }, { app: "BacklogVault", format: 1, lists: "no" }, []]) {
      const res = await restore(body, stranger);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/doesn't look like a BacklogVault backup/);
    }
    expect(dbGet("SELECT COUNT(*) AS n FROM users").n).toBe(0);
  });

  it("refuses a file with too many games or too many lists", async () => {
    const many = Array.from({ length: MAX_RESTORE_GAMES + 1 }, (_, i) => game(i + 1));
    expect((await restore(backup([{ name: "Big", games: many }]))).status).toBe(400);
    const lists = Array.from({ length: 201 }, (_, i) => ({ name: `L${i}`, games: [] }));
    expect((await restore(backup(lists))).status).toBe(400);
    expect(rows()).toHaveLength(0);
  });

  it("accepts a large honest backup in one request", async () => {
    const games = Array.from({ length: 1500 }, (_, i) => game(i + 1, { notes: "n".repeat(200) }));
    const res = await restore(backup([{ name: "Big", games }]));
    expect(res.status).toBe(200);
    expect(res.body.games_added).toBe(1500);
  });

  it("refuses a body over the 4 MB limit with a clear message", async () => {
    const huge = backup([{ name: "A", games: [game(1, { notes: "x".repeat(5 * 1024 * 1024) })] }]);
    const res = await restore(huge);
    expect(res.status).toBe(413);
  });

  it("never touches someone else's library", async () => {
    const other = newClient(app);
    const theirs = await createList(other, "A");
    await addGame(other, theirs.id, { igdb_id: 1, name: "Theirs" });

    await restore(backup([{ name: "A", games: [game(1, { name: "Mine" }), game(2)] }]));
    const all = rows();
    expect(all.filter((r) => r.name === "Theirs")).toHaveLength(1);
    expect(all.filter((r) => r.name === "Mine")).toHaveLength(1);
  });
});

describe("DELETE /api/auth/me (delete my data)", () => {
  const wipe = (agent = client, body: Record<string, unknown> = { deleteEverything: true }) => agent.delete("/api/auth/me").send(body);
  const counts = () => ({
    users: dbGet("SELECT COUNT(*) AS n FROM users").n,
    lists: dbGet("SELECT COUNT(*) AS n FROM lists").n,
    games: dbGet("SELECT COUNT(*) AS n FROM list_games").n,
    sessions: dbGet("SELECT COUNT(*) AS n FROM sessions").n,
    includes: dbGet("SELECT COUNT(*) AS n FROM time_estimate_includes").n,
  });

  it("deletes the visitor and everything of theirs, and says how much", async () => {
    const a = await createList(client, "A");
    await createList(client, "B");
    await addGame(client, a.id, { igdb_id: 1 });
    await addGame(client, a.id, { igdb_id: 2 });
    await client.put("/api/stats/time-to-beat/includes/1").send({ included: true });
    db.prepare("UPDATE users SET steam_id = '76561197960287930', steam_verified = 1, steam_persona = 'Gabe'").run();

    const res = await wipe();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: { lists: 2, games: 2 } });
    expect(counts()).toEqual({ users: 0, lists: 0, games: 0, sessions: 0, includes: 0 });
  });

  it("ends the session: the old cookie no longer works and the browser is told to drop it", async () => {
    await createList(client, "A");
    const res = await wipe();
    expect(String(res.headers["set-cookie"])).toMatch(/bv_session=;/);
    expect((await client.get("/api/auth/me")).body.user).toBeNull();
    expect((await client.get("/api/lists")).body).toEqual([]);
  });

  it("lets the same browser start fresh afterwards", async () => {
    await createList(client, "A");
    await wipe();
    const list = await createList(client, "New start");
    expect(list.name).toBe("New start");
    expect((await client.get("/api/lists")).body).toHaveLength(1);
  });

  it("refuses unless the request confirms it on purpose, and changes nothing", async () => {
    await createList(client, "A");
    for (const body of [{}, { deleteEverything: false }, { deleteEverything: "true" }, { deleteEverything: 1 }]) {
      const res = await wipe(client, body);
      expect(res.status).toBe(400);
    }
    expect(counts()).toMatchObject({ users: 1, lists: 1 });
  });

  it("needs someone to delete", async () => {
    expect((await wipe(request(app))).status).toBe(401);
  });

  it("leaves everyone else alone", async () => {
    const other = newClient(app);
    const theirs = await createList(other, "Theirs");
    await addGame(other, theirs.id, { igdb_id: 1 });
    await createList(client, "Mine");

    await wipe();
    expect(counts()).toMatchObject({ users: 1, lists: 1, games: 1 });
    expect((await other.get(`/api/lists/${theirs.id}`)).body.games).toHaveLength(1);
  });

  it("also deletes a registered account, and works while accounts are switched off", async () => {
    await client.post("/api/auth/register").send({ email: "a@example.com", password: "correct horse battery" });
    await createList(client, "A");
    vi.stubEnv("ENABLE_ACCOUNTS", "false");
    expect((await wipe()).status).toBe(200);
    expect(counts().users).toBe(0);
  });
});

describe("backing up the database file", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bv-backup-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes a dated copy that opens and holds the data", async () => {
    const list = await createList(client, "Kept");
    await addGame(client, list.id, { igdb_id: 1, name: "Hades" });

    const file = await backupDatabase(db, path.join(dir, "nested", "backups"));
    expect(path.basename(file)).toMatch(/^backlog-\d{8}-\d{6}\.db$/);

    const copy = new Database(file, { readonly: true });
    expect(copy.prepare("SELECT name FROM list_games").all()).toEqual([{ name: "Hades" }]);
    copy.close();
  });

  it("keeps only the newest copies", async () => {
    for (let day = 1; day <= 5; day++) {
      await backupDatabase(db, dir, { keep: 3, now: new Date(Date.UTC(2026, 9, day, 3, 0, 0)) });
    }
    const left = fs.readdirSync(dir).sort();
    expect(left).toHaveLength(3);
    expect(left[0]).toBe("backlog-20261003-030000.db");
    expect(left[2]).toBe("backlog-20261005-030000.db");
  });

  it("never deletes files that are not its own backups", async () => {
    fs.writeFileSync(path.join(dir, "notes.txt"), "keep me");
    for (let day = 1; day <= 3; day++) await backupDatabase(db, dir, { keep: 1, now: new Date(Date.UTC(2026, 9, day)) });
    expect(fs.existsSync(path.join(dir, "notes.txt"))).toBe(true);
  });
});
