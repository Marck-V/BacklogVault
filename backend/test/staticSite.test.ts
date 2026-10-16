import type { Express } from "express";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import { SITE_HEADERS } from "../src/staticSite.ts";

// A small stand-in for the React build: index.html, one hashed script (big enough to be compressed) and a favicon.
let dir: string;
let app: Express;
const SCRIPT = `console.log(${JSON.stringify("x".repeat(5000))});`;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bv-site-"));
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(path.join(dir, "index.html"), '<!doctype html><div id="root"></div>');
  fs.writeFileSync(path.join(dir, "assets", "index-abc123.js"), SCRIPT);
  fs.writeFileSync(path.join(dir, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");

  vi.resetModules();
  process.env.STATIC_DIR = dir;
  app = (await import("../src/app.ts")).default;
});

afterAll(() => {
  delete process.env.STATIC_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

const expectSiteHeaders = (res) => {
  for (const [name, value] of Object.entries(SITE_HEADERS)) expect(res.headers[name.toLowerCase()]).toBe(value);
};

describe("the API serving the website (STATIC_DIR)", () => {
  it("serves the page with the site's security headers, re-checked on every visit", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/html/);
    expect(res.text).toContain('<div id="root">');
    expect(res.headers["cache-control"]).toBe("no-cache");
    expectSiteHeaders(res);
    expect(res.headers["strict-transport-security"]).toMatch(/max-age=31536000/);
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it.each(["/lists/4", "/privacy", "/some/deep/path"])("sends index.html for the app route %s", async (route) => {
    const res = await request(app).get(route);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="root">');
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("caches hashed build files for a year", async () => {
    const res = await request(app).get("/assets/index-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/javascript/);
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expectSiteHeaders(res);
  });

  it("gives a missing build file a real 404 that is not cached (and not the page)", async () => {
    const res = await request(app).get("/assets/does-not-exist.js");
    expect(res.status).toBe(404);
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.text).not.toContain('<div id="root">');
  });

  it("re-checks other files, such as the favicon", async () => {
    const res = await request(app).get("/favicon.svg");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("compresses when the browser accepts it", async () => {
    const res = await request(app).get("/assets/index-abc123.js").set("Accept-Encoding", "gzip");
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(res.text).toBe(SCRIPT); // supertest unzips it: the content is unchanged
  });

  it("keeps API answers as JSON, including unknown API paths", async () => {
    expect((await request(app).get("/api/health")).body).toEqual({ status: "ok" });
    const missing = await request(app).get("/api/nope");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "Not found" });
    // The API keeps helmet's own headers; the stricter page policy is only for the website.
    expect(missing.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });

  it("never serves files from outside the build folder", async () => {
    for (const attempt of ["/../package.json", "/%2e%2e/package.json", "/assets/..%2f..%2fpackage.json"]) {
      const res = await request(app).get(attempt);
      expect(res.text).not.toContain("backlog-tracker-backend");
      expect(res.text).not.toContain("better-sqlite3");
    }
  });
});
