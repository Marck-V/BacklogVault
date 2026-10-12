import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

vi.mock("../src/igdbClient.js", () => ({ igdbRequest: vi.fn() }));

// Wrap the real hashing functions so a test can make one of them fail once.
vi.mock("../src/auth.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    hashPassword: vi.fn(actual.hashPassword),
    verifyPassword: vi.fn(actual.verifyPassword),
  };
});

import app from "../src/app.js";
import { hashPassword, verifyPassword } from "../src/auth.js";
import { resetDb } from "./helpers.js";

const credentials = { email: "player@example.com", password: "correct horse battery" };

beforeEach(() => {
  resetDb();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// If one of these ever escapes as an unhandled rejection, Vitest fails the whole run, which is the same
// thing that would have killed the real server process.
describe("failures inside async handlers", () => {
  it("returns a JSON 500 when hashing fails during register, and the app keeps serving", async () => {
    vi.mocked(hashPassword).mockRejectedValueOnce(new Error("scrypt exploded: secret internals"));

    const res = await request(app).post("/api/auth/register").send(credentials);
    expect(res.status).toBe(500);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body).toEqual({ error: "Something went wrong" });
    expect(JSON.stringify(res.body)).not.toMatch(/scrypt|internals/);

    expect((await request(app).get("/api/health")).status).toBe(200);
    expect((await request(app).post("/api/auth/register").send(credentials)).status).toBe(201);
  });

  it("returns a JSON 500 when password checking fails during login, and the app keeps serving", async () => {
    await request(app).post("/api/auth/register").send(credentials);
    vi.mocked(verifyPassword).mockRejectedValueOnce(new Error("boom"));

    const res = await request(app).post("/api/auth/login").send(credentials);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Something went wrong" });

    expect((await request(app).post("/api/auth/login").send(credentials)).status).toBe(200);
  });

  it("logs the underlying error for the operator without sending it to the client", async () => {
    vi.mocked(hashPassword).mockRejectedValueOnce(new Error("disk on fire"));
    await request(app).post("/api/auth/register").send(credentials);
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: "disk on fire" }));
  });
});

describe("bad requests", () => {
  it("answers malformed JSON with a JSON 400, not an HTML page", async () => {
    const res = await request(app).post("/api/lists").set("Content-Type", "application/json").send("{bad json");
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body).toEqual({ error: "Invalid JSON in request body" });
  });

  it("answers an oversized body with a JSON 413", async () => {
    const res = await request(app)
      .post("/api/lists")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ name: "x".repeat(200000) }));
    expect(res.status).toBe(413);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body).toEqual({ error: "Request body too large" });
  });

  it("answers an unknown API route with a JSON 404", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });
});
