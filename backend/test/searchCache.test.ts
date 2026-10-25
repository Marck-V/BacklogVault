import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/igdbClient.ts", () => ({ igdbRequest: vi.fn() }));

import app from "../src/app.ts";
import { igdbRequest } from "../src/igdbClient.ts";
import { cachedSearch, rememberSearch } from "../src/searchCache.ts";
import { newClient } from "./helpers.ts";

beforeEach(() => vi.mocked(igdbRequest).mockReset());
afterEach(() => vi.useRealTimers());

describe("search cache", () => {
  it("asks IGDB once for the same search, however it is typed, and for any visitor", async () => {
    vi.mocked(igdbRequest).mockResolvedValue([{ id: 1, name: "Hades" }]);
    const first = await newClient(app).get("/api/games/search?q=hades");
    const second = await newClient(app).get("/api/games/search?q=%20%20HADES%20");
    expect(first.body).toEqual([{ id: 1, name: "Hades" }]);
    expect(second.body).toEqual(first.body);
    expect(igdbRequest).toHaveBeenCalledTimes(1);
  });

  it("treats different words as different searches", async () => {
    vi.mocked(igdbRequest).mockResolvedValue([]);
    await newClient(app).get("/api/games/search?q=hades");
    await newClient(app).get("/api/games/search?q=celeste");
    expect(igdbRequest).toHaveBeenCalledTimes(2);
  });

  it("does not remember a failure, so the next try asks IGDB again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(igdbRequest).mockRejectedValueOnce(new Error("down")).mockResolvedValue([{ id: 2 }]);
    const failed = await newClient(app).get("/api/games/search?q=hades");
    expect(failed.status).toBe(500);
    const retry = await newClient(app).get("/api/games/search?q=hades");
    expect(retry.body).toEqual([{ id: 2 }]);
    expect(igdbRequest).toHaveBeenCalledTimes(2);
  });

  it("remembers an empty answer too", async () => {
    vi.mocked(igdbRequest).mockResolvedValue([]);
    await newClient(app).get("/api/games/search?q=zzzz");
    await newClient(app).get("/api/games/search?q=zzzz");
    expect(igdbRequest).toHaveBeenCalledTimes(1);
  });

  it("forgets an answer after ten minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    rememberSearch("old", [1]);
    expect(cachedSearch("old")).toEqual([1]);
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1);
    expect(cachedSearch("old")).toBeUndefined();
  });

  it("keeps at most 500 searches, dropping the oldest", () => {
    for (let i = 0; i < 501; i += 1) rememberSearch(`q${i}`, [i]);
    expect(cachedSearch("q0")).toBeUndefined();
    expect(cachedSearch("q1")).toEqual([1]);
    expect(cachedSearch("q500")).toEqual([500]);
  });
});
