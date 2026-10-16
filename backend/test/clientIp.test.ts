import type { Express } from "express";
import { describe, it, expect, afterEach, vi } from "vitest";
import request from "supertest";
import { clientIpHeader } from "../src/config.ts";

// Railway's proxy reports the visitor in X-Real-IP and passes the visitor's own X-Forwarded-For through untouched.
// These tests use the backup-restore limiter (set to 2 per hour here), so a third request from one visitor is refused.
const saved = { ...process.env };

async function loadApp(env) {
  vi.resetModules();
  Object.assign(process.env, { RESTORE_RATE_LIMIT: "2", GUEST_RATE_LIMIT: "1000" }, env);
  return (await import("../src/app.ts")).default;
}

const restore = (app: Express, headers: Record<string, string>) => {
  const req = request(app).post("/api/library/restore").send({});
  for (const [name, value] of Object.entries(headers)) req.set(name, value);
  return req;
};

afterEach(() => {
  for (const key of ["CLIENT_IP_HEADER", "TRUST_PROXY", "RESTORE_RATE_LIMIT", "GUEST_RATE_LIMIT"]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
});

describe("CLIENT_IP_HEADER (Railway: X-Real-IP)", () => {
  it("reproduces the live problem first: trusting X-Forwarded-For lets a visitor fake a new address each time", async () => {
    const app = await loadApp({ TRUST_PROXY: "1" });
    for (let i = 1; i <= 4; i++) {
      // Railway would pass this through; the visitor changes it on every request and is never limited.
      expect((await restore(app, { "X-Forwarded-For": `198.51.100.${i}` })).status).toBe(400);
    }
  });

  it("with the header set, a faked X-Forwarded-For no longer helps", async () => {
    const app = await loadApp({ CLIENT_IP_HEADER: "X-Real-IP" });
    const statuses: number[] = [];
    for (let i = 1; i <= 3; i++) {
      statuses.push((await restore(app, { "X-Real-IP": "203.0.113.7", "X-Forwarded-For": `198.51.100.${i}` })).status);
    }
    expect(statuses).toEqual([400, 400, 429]);
  });

  it("gives each real visitor their own allowance", async () => {
    const app = await loadApp({ CLIENT_IP_HEADER: "x-real-ip" });
    await restore(app, { "X-Real-IP": "203.0.113.7" });
    await restore(app, { "X-Real-IP": "203.0.113.7" });
    expect((await restore(app, { "X-Real-IP": "203.0.113.7" })).status).toBe(429);
    expect((await restore(app, { "X-Real-IP": "203.0.113.8" })).status).toBe(400);
    expect((await restore(app, { "X-Real-IP": "2001:db8::1" })).status).toBe(400);
  });

  it("ignores a value that is not an IP address and uses the connection's own address", async () => {
    const app = await loadApp({ CLIENT_IP_HEADER: "X-Real-IP" });
    const statuses: number[] = [];
    for (const junk of ["not-an-ip", "1.2.3.4, 5.6.7.8", "999.1.1.1"]) {
      statuses.push((await restore(app, { "X-Real-IP": junk })).status);
    }
    // All three fall back to the same real connection, so they share one allowance of 2.
    expect(statuses).toEqual([400, 400, 429]);
  });

  it("takes priority over TRUST_PROXY, and says so once at start", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = await loadApp({ CLIENT_IP_HEADER: "X-Real-IP", TRUST_PROXY: "1" });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/TRUST_PROXY is ignored/));
    const statuses: number[] = [];
    for (let i = 1; i <= 3; i++) {
      statuses.push((await restore(app, { "X-Real-IP": "203.0.113.9", "X-Forwarded-For": `198.51.100.${i}` })).status);
    }
    expect(statuses).toEqual([400, 400, 429]);
  });
});

describe("clientIpHeader setting", () => {
  it("is off when empty and lower-cases a valid header name", () => {
    expect(clientIpHeader(undefined)).toBeNull();
    expect(clientIpHeader("")).toBeNull();
    expect(clientIpHeader("X-Real-IP")).toBe("x-real-ip");
  });

  it("refuses something that is not a header name", () => {
    expect(() => clientIpHeader("x real ip")).toThrow(/CLIENT_IP_HEADER/);
    expect(() => clientIpHeader("x-real-ip\r\nx")).toThrow(/CLIENT_IP_HEADER/);
  });
});
