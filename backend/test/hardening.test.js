import { describe, it, expect, afterEach, vi } from "vitest";
import request from "supertest";

vi.mock("../src/igdbClient.js", () => ({ igdbRequest: vi.fn(async () => []) }));

// Security audit 2026-10-14, findings 4 and 6.
const saved = { NODE_ENV: process.env.NODE_ENV, CORS_ORIGIN: process.env.CORS_ORIGIN };

async function loadApp(env) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return (await import("../src/app.js")).default;
}

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const allowedOrigin = (res) => res.headers["access-control-allow-origin"];

describe("cross-origin calls (CORS)", () => {
  it("in production, no other address may call the API with cookies, not even the development one", async () => {
    const app = await loadApp({ NODE_ENV: "production", CORS_ORIGIN: undefined });
    const res = await request(app).get("/api/health").set("Origin", "http://localhost:5173");
    expect(res.status).toBe(200);
    expect(allowedOrigin(res)).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("in production, an explicitly configured address is still allowed", async () => {
    const app = await loadApp({ NODE_ENV: "production", CORS_ORIGIN: "https://admin.example.com" });
    const res = await request(app).get("/api/health").set("Origin", "https://admin.example.com");
    expect(allowedOrigin(res)).toBe("https://admin.example.com");
  });

  it("in development, the Vite address keeps working", async () => {
    const app = await loadApp({ NODE_ENV: "development", CORS_ORIGIN: undefined });
    const res = await request(app).get("/api/health").set("Origin", "http://localhost:5173");
    expect(allowedOrigin(res)).toBe("http://localhost:5173");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });
});

describe("search text length", () => {
  it("accepts up to 100 characters and refuses more, before asking IGDB", async () => {
    const app = await loadApp({});
    const { igdbRequest } = await import("../src/igdbClient.js");
    vi.mocked(igdbRequest).mockClear();

    expect((await request(app).get("/api/games/search").query({ q: "a".repeat(100) })).status).toBe(200);
    const tooLong = await request(app).get("/api/games/search").query({ q: "a".repeat(101) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error).toMatch(/at most 100 characters/);
    expect(vi.mocked(igdbRequest)).toHaveBeenCalledTimes(1);
  });
});
