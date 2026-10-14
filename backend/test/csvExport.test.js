import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db.js";
import { buildCsv, escapeCsv } from "../src/csvExport.js";
import { resetDb, newClient, createList, addGame } from "./helpers.js";

// These first two groups are the cases of the C# service's xUnit tests (CsvExportTests.cs), ported when the service was
// folded into the API, so the same behavior is still pinned down.
const library = (...lists) => lists.map(([name, games]) => ({ name, games: games.map(([n, status, added_at]) => ({ name: n, status, added_at })) }));

describe("escapeCsv", () => {
  it.each([["Hades"], [""], ["Half-Life 2"], ["Dark Souls: Remastered"]])("leaves ordinary text alone: %s", (text) => {
    expect(escapeCsv(text)).toBe(text);
  });

  it("returns empty for null and undefined", () => {
    expect(escapeCsv(null)).toBe("");
    expect(escapeCsv(undefined)).toBe("");
  });

  it("quotes a value containing a comma without changing it", () => {
    expect(escapeCsv("Zelda, Link")).toBe('"Zelda, Link"');
  });

  it("doubles embedded quotes inside a quoted value", () => {
    expect(escapeCsv('Link\'s "Awakening"')).toBe('"Link\'s ""Awakening"""');
  });

  it.each([["Two\nLines"], ["Two\r\nLines"]])("quotes values with line breaks so they stay in one row", (text) => {
    const escaped = escapeCsv(text);
    expect(escaped.startsWith('"')).toBe(true);
    expect(escaped.endsWith('"')).toBe(true);
    expect(escaped).toContain("Two");
    expect(escaped).toContain("Lines");
  });

  it.each([
    ["=SUM(1+1)", "'=SUM(1+1)"],
    ["+1", "'+1"],
    ["-2+3", "'-2+3"],
    ["@cmd", "'@cmd"],
    ["\tTab", "'\tTab"],
  ])("neutralises spreadsheet formulas: %j", (input, expected) => {
    expect(escapeCsv(input)).toBe(expected);
  });

  it("neutralises a formula that also needs quoting", () => {
    expect(escapeCsv('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
  });
});

describe("buildCsv", () => {
  it("with no lists is just the header", () => {
    expect(buildCsv([])).toBe("Game,Status,List,Date Added");
  });

  it("writes one row per game in list order, with no trailing newline", () => {
    const csv = buildCsv(
      library(
        ["Alpha", [["Hades", "Playing", "2026-02-01 10:00:00"], ["Celeste", "Backlog", "2026-01-01 09:00:00"]]],
        ["Zed", [["Tunic", "Completed", "2026-03-05T12:00:00.000Z"]]]
      )
    );
    expect(csv).toBe(
      ["Game,Status,List,Date Added", "Hades,Playing,Alpha,2026-02-01", "Celeste,Backlog,Alpha,2026-01-01", "Tunic,Completed,Zed,2026-03-05"].join("\n")
    );
  });

  it("keeps awkward names in a single well-formed row", () => {
    const csv = buildCsv(library(['Shelf, "Main"', [['Zelda, Link\'s "Awakening"', "Backlog", "2026-10-11 00:00:00"]]]));
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('"Zelda, Link\'s ""Awakening""",Backlog,"Shelf, ""Main""",2026-10-11');
  });

  it("does not split a name with a newline into two records", () => {
    const csv = buildCsv(library(["Main", [["Two\nLine Game", "Backlog", "2026-10-11 00:00:00"]]]));
    expect(csv).toBe('Game,Status,List,Date Added\n"Two\nLine Game",Backlog,Main,2026-10-11');
  });

  it("tolerates a short date value", () => {
    expect(buildCsv(library(["Main", [["G", "Backlog", "short"]]])).endsWith(",short")).toBe(true);
  });
});

describe("GET /api/library/export.csv", () => {
  let client;
  beforeEach(() => {
    resetDb();
    client = newClient(app);
  });

  it("is refused without a session, and does not create a guest", async () => {
    const res = await client.get("/api/library/export.csv");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Nothing to export yet/);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS n FROM users").get().n).toBe(0);
  });

  it("rejects a forged cookie", async () => {
    const res = await request(app).get("/api/library/export.csv").set("Cookie", "bv_session=forged-token");
    expect(res.status).toBe(401);
  });

  it("downloads as backlog.csv, as UTF-8 text", async () => {
    const list = await createList(client);
    await addGame(client, list.id, { name: "Hades" });
    const res = await client.get("/api/library/export.csv");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="backlog.csv"');
    expect(res.text.split("\n")[0]).toBe("Game,Status,List,Date Added");
  });

  it("is just the header for a signed-in user with no games", async () => {
    const list = await createList(client);
    await client.delete(`/api/lists/${list.id}`);
    const res = await client.get("/api/library/export.csv");
    expect(res.status).toBe(200);
    expect(res.text).toBe("Game,Status,List,Date Added");
  });

  it("orders lists by name and games newest first, with the date only", async () => {
    const zed = await createList(client, "Zed");
    const alpha = await createList(client, "Alpha");
    const older = await addGame(client, alpha.id, { igdb_id: 1, name: "Older" });
    const newer = await addGame(client, alpha.id, { igdb_id: 2, name: "Newer" });
    await addGame(client, zed.id, { igdb_id: 3, name: "In Zed" });
    db.prepare("UPDATE list_games SET added_at = ? WHERE id = ?").run("2026-01-01 00:00:00", older.id);
    db.prepare("UPDATE list_games SET added_at = ? WHERE id = ?").run("2026-02-01 00:00:00", newer.id);
    db.prepare("UPDATE list_games SET added_at = '2026-03-01 00:00:00' WHERE list_id = ?").run(zed.id);

    const res = await client.get("/api/library/export.csv");
    expect(res.text.split("\n")).toEqual([
      "Game,Status,List,Date Added",
      "Newer,Backlog,Alpha,2026-02-01",
      "Older,Backlog,Alpha,2026-01-01",
      "In Zed,Backlog,Zed,2026-03-01",
    ]);
  });

  it("neutralises a game named like a formula, end to end", async () => {
    const list = await createList(client);
    await addGame(client, list.id, { name: "=HYPERLINK(\"http://evil\",\"x\")" });
    const res = await client.get("/api/library/export.csv");
    expect(res.text.split("\n")[1].startsWith('"\'=HYPERLINK(')).toBe(true);
  });

  it("includes hidden games: the export is the whole library", async () => {
    const list = await createList(client);
    const game = await addGame(client, list.id, { name: "Kept" });
    await client.put(`/api/lists/${list.id}/games/${game.id}/hidden`).send({ hidden: true });
    expect((await client.get("/api/library/export.csv")).text).toContain("Kept,Backlog,Main,");
  });

  it("only ever contains the signed-in user's own games", async () => {
    const alice = client;
    const bob = newClient(app);
    const aliceList = await createList(alice, "Alice's");
    await addGame(alice, aliceList.id, { igdb_id: 7, name: "Alice Game" });
    const bobList = await createList(bob, "Bob's");
    await addGame(bob, bobList.id, { igdb_id: 7, name: "Bob Game" });

    const a = (await alice.get("/api/library/export.csv")).text;
    const b = (await bob.get("/api/library/export.csv")).text;
    expect(a).toContain("Alice Game");
    expect(a).not.toContain("Bob");
    expect(b).toContain("Bob Game");
    expect(b).not.toContain("Alice");
  });

  it("the old unprotected-shape endpoint is gone", async () => {
    await createList(client);
    expect((await client.get("/api/library")).status).toBe(404);
  });
});
