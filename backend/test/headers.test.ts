import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../src/app.ts";

describe("security headers on API responses", () => {
  it("does not announce the framework", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("stops browsers guessing content types", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("sets the same headers on error responses", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("credentialed CORS still works next to the security headers", () => {
  it("allows the dev frontend origin to read responses with its cookie", async () => {
    const res = await request(app).get("/api/health").set("Origin", "http://localhost:5173");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("does not grant access to an origin that is not on the list", async () => {
    const res = await request(app).get("/api/health").set("Origin", "https://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
