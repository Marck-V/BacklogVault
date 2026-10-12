import { describe, it, expect, vi } from "vitest";
import request from "supertest";

// These re-run the scenarios from the pre-deployment audit against the real app with the DEFAULT limits
// (the other test files raise the limits so they can create many records quickly).
async function freshAppWithDefaultLimits() {
  vi.resetModules();
  delete process.env.WRITE_RATE_LIMIT;
  delete process.env.GUEST_RATE_LIMIT;
  const app = (await import("../src/app.js")).default;
  const db = (await import("../src/db.js")).default;
  return { app, db };
}

describe("abuse scenarios from the audit, with default limits", () => {
  it("300 list creations from one client: only the first 50 are stored", async () => {
    const { app, db } = await freshAppWithDefaultLimits();
    const agent = request.agent(app);

    const statuses = [];
    for (let i = 0; i < 300; i += 1) statuses.push((await agent.post("/api/lists").send({ name: `spam ${i}` })).status);

    expect(statuses.filter((s) => s === 201)).toHaveLength(50);
    expect(new Set(statuses)).toEqual(new Set([201, 409, 429]));
    expect(db.prepare("SELECT COUNT(*) AS n FROM lists").get().n).toBe(50);
  });

  it("100 anonymous clients from one address: only 10 guest accounts are created", async () => {
    const { app, db } = await freshAppWithDefaultLimits();

    const statuses = [];
    for (let i = 0; i < 100; i += 1) statuses.push((await request(app).post("/api/lists").send({ name: "bot" })).status);

    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(90);
    expect(db.prepare("SELECT COUNT(*) AS n FROM users").get().n).toBe(10);
  });

  it("90,000-character list and game names are refused", async () => {
    const { app } = await freshAppWithDefaultLimits();
    const agent = request.agent(app);
    const huge = "x".repeat(90000);

    const list = await agent.post("/api/lists").send({ name: "ok" });
    expect((await agent.post("/api/lists").send({ name: huge })).status).toBe(400);
    expect((await agent.post(`/api/lists/${list.body.id}/games`).send({ igdb_id: 1, name: huge })).status).toBe(400);
  });
});
