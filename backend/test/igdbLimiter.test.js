import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../src/igdbClient.js", () => ({ igdbRequest: vi.fn().mockResolvedValue([]) }));

import app from "../src/app.js";
import { createIgdbLimiter } from "../src/igdbLimiter.js";
import { newClient, resetDb, createList } from "./helpers.js";

describe("createIgdbLimiter", () => {
  it("returns 429 with a clear message once the per-IP limit is used up", async () => {
    const tiny = express();
    tiny.use(createIgdbLimiter(3));
    tiny.get("/x", (req, res) => res.json({ ok: true }));

    for (let i = 0; i < 3; i += 1) expect((await request(tiny).get("/x")).status).toBe(200);
    const blocked = await request(tiny).get("/x");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many requests/i);
    expect(blocked.headers["retry-after"]).toBeDefined();
  });

  it("counts each client separately", async () => {
    const tiny = express();
    tiny.set("trust proxy", true);
    tiny.use(createIgdbLimiter(1));
    tiny.get("/x", (req, res) => res.json({ ok: true }));

    expect((await request(tiny).get("/x").set("X-Forwarded-For", "10.0.0.1")).status).toBe(200);
    expect((await request(tiny).get("/x").set("X-Forwarded-For", "10.0.0.1")).status).toBe(429);
    expect((await request(tiny).get("/x").set("X-Forwarded-For", "10.0.0.2")).status).toBe(200);
  });
});

describe("limiter wiring in the real app", () => {
  it.each([["/api/games/search?q=zelda"], ["/api/games/1/details"], ["/api/stats/time-to-beat"]])(
    "applies the IGDB limiter to %s",
    async (url) => {
      const res = await request(app).get(url);
      expect(res.headers["ratelimit-policy"]).toBeDefined();
    }
  );

  it.each([["/api/lists"], ["/api/health"], ["/api/stats/currently-playing"]])(
    "does not spend IGDB quota (or limit) on %s",
    async (url) => {
      const res = await request(app).get(url);
      expect(res.headers["ratelimit-policy"]).toBeUndefined();
    }
  );

  it("shares one budget across search and the dashboard for the same client", async () => {
    resetDb();
    const client = newClient(app);
    await createList(client);
    const first = await client.get("/api/games/search?q=a");
    const second = await client.get("/api/stats/time-to-beat");
    const used = (res) => Number(/remaining=(\d+)/.exec(res.headers["ratelimit"])[1]);
    expect(used(second)).toBe(used(first) - 1);
  });
});
