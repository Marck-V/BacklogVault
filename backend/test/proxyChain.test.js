import { describe, it, expect, afterEach, vi } from "vitest";
import request from "supertest";

// The production chain is: visitor -> Caddy -> nginx -> API. Caddy puts the visitor in X-Forwarded-For and
// nginx appends the address it saw (Caddy's). supertest plays the part of nginx, the last hop before the API.
const CADDY = "172.18.0.5";

async function loadApp(hops) {
  vi.resetModules();
  process.env.TRUST_PROXY = String(hops);
  process.env.AUTH_RATE_LIMIT_MAX = "2"; // two attempts allowed, the third is refused
  return (await import("../src/app.js")).default;
}

const tryLogin = (app, visitor) =>
  request(app)
    .post("/api/auth/login")
    .set("X-Forwarded-For", `${visitor}, ${CADDY}`)
    .send({ email: "nobody@example.com", password: "whatever-123" });

afterEach(() => {
  delete process.env.TRUST_PROXY;
  process.env.AUTH_RATE_LIMIT_MAX = "1000";
});

describe("per-IP limits behind two proxies (Caddy then nginx)", () => {
  it("counts each visitor separately when TRUST_PROXY matches the chain (2)", async () => {
    const app = await loadApp(2);

    expect((await tryLogin(app, "203.0.113.7")).status).toBe(401);
    expect((await tryLogin(app, "203.0.113.7")).status).toBe(401);
    expect((await tryLogin(app, "203.0.113.7")).status).toBe(429);

    // A different visitor is unaffected by the first one's lockout.
    expect((await tryLogin(app, "198.51.100.9")).status).toBe(401);
  });

  it("treats every visitor as the proxy when TRUST_PROXY is too low (1), so one visitor locks out everyone", async () => {
    const app = await loadApp(1);

    expect((await tryLogin(app, "203.0.113.7")).status).toBe(401);
    expect((await tryLogin(app, "203.0.113.7")).status).toBe(401);
    expect((await tryLogin(app, "203.0.113.7")).status).toBe(429);

    // This is the misconfiguration the audit found: a completely different visitor is blocked too.
    expect((await tryLogin(app, "198.51.100.9")).status).toBe(429);
  });

  it("ignores an address a visitor forges themselves when the hop count is right", async () => {
    const app = await loadApp(2);

    // The visitor sends their own fake X-Forwarded-For to Caddy, which appends the real one.
    const forged = (spoof) =>
      request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", `${spoof}, 203.0.113.7, ${CADDY}`)
        .send({ email: "nobody@example.com", password: "whatever-123" });

    expect((await forged("1.1.1.1")).status).toBe(401);
    expect((await forged("2.2.2.2")).status).toBe(401);
    // Rotating the forged value does not buy more attempts: the real address is still 203.0.113.7.
    expect((await forged("3.3.3.3")).status).toBe(429);
  });
});
