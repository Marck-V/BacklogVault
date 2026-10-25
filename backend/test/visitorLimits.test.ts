import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createVisitorLimiter } from "../src/visitorLimits.ts";

// A small app where the test says who is calling: X-User is the visitor's session, X-Forwarded-For their address.
function appWith(limit: number, addressLimit: number) {
  const app = express();
  app.set("trust proxy", true);
  app.use((req, _res, next) => {
    const id = req.get("X-User");
    req.user = id ? ({ id: Number(id) } as Express.Request["user"]) : null;
    next();
  });
  app.use(createVisitorLimiter({ windowMs: 60_000, limit, addressLimit, message: { error: "slow down" } }));
  app.get("/x", (_req, res) => res.json({ ok: true }));
  return app;
}
const call = (app: express.Express, ip: string, user?: number) => {
  const r = request(app).get("/x").set("X-Forwarded-For", ip);
  return (user ? r.set("X-User", String(user)) : r).then((res) => res.status);
};

describe("visitor limiter", () => {
  it("gives each visitor on one shared address their own allowance", async () => {
    const app = appWith(2, 100);
    for (const user of [1, 2, 3]) {
      expect(await call(app, "10.0.0.1", user)).toBe(200);
      expect(await call(app, "10.0.0.1", user)).toBe(200);
    }
    expect(await call(app, "10.0.0.1", 1)).toBe(429);
    expect(await call(app, "10.0.0.1", 2)).toBe(429);
  });

  it("keeps counting one visitor when their address changes", async () => {
    const app = appWith(2, 100);
    expect(await call(app, "10.0.0.1", 7)).toBe(200);
    expect(await call(app, "10.0.0.2", 7)).toBe(200);
    expect(await call(app, "10.0.0.3", 7)).toBe(429);
  });

  it("counts requests with no session by address", async () => {
    const app = appWith(2, 100);
    expect(await call(app, "10.0.0.1")).toBe(200);
    expect(await call(app, "10.0.0.1")).toBe(200);
    expect(await call(app, "10.0.0.1")).toBe(429);
    expect(await call(app, "10.0.0.2")).toBe(200);
  });

  it("caps everyone behind one address together, so fresh sessions from one place cannot multiply the allowance", async () => {
    const app = appWith(2, 5);
    const results: number[] = [];
    for (let user = 1; user <= 6; user += 1) results.push(await call(app, "10.0.0.1", user));
    expect(results).toEqual([200, 200, 200, 200, 200, 429]);
    // A different address is unaffected.
    expect(await call(app, "10.0.0.9", 99)).toBe(200);
  });

  it("answers with the visitor's own RateLimit header and the same message", async () => {
    const app = appWith(1, 5);
    await request(app).get("/x").set("X-User", "1");
    const blocked = await request(app).get("/x").set("X-User", "1");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("slow down");
    expect(blocked.headers["ratelimit-policy"]).toBe("1;w=60");
  });
});
