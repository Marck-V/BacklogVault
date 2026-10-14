import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

vi.mock("../src/igdbClient.js", () => ({ igdbRequest: vi.fn() }));

import app from "../src/app.js";
import { igdbRequest } from "../src/igdbClient.js";

beforeEach(() => {
  vi.mocked(igdbRequest).mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/games/search", () => {
  it.each([["/api/games/search"], ["/api/games/search?q="], ["/api/games/search?q=%20%20"], ["/api/games/search?q=a&q=b"]])(
    "rejects a missing, blank or repeated q: %s",
    async (url) => {
      const res = await request(app).get(url);
      expect(res.status).toBe(400);
      expect(igdbRequest).not.toHaveBeenCalled();
    }
  );

  it("passes the search term through to IGDB and returns the results", async () => {
    vi.mocked(igdbRequest).mockResolvedValue([{ id: 1, name: "Hades" }]);
    const res = await request(app).get("/api/games/search").query({ q: "hades" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 1, name: "Hades" }]);
    expect(igdbRequest).toHaveBeenCalledWith("games", expect.stringContaining('search "hades";'));
  });

  it("escapes quotes so user input cannot inject extra IGDB query clauses", async () => {
    vi.mocked(igdbRequest).mockResolvedValue([]);
    await request(app).get("/api/games/search").query({ q: 'x"; where id = 1; "' });
    const query = vi.mocked(igdbRequest).mock.calls[0][1];
    expect(query).toContain('search "x\\"; where id = 1; \\"";');
  });

  it("returns 500 when IGDB fails", async () => {
    vi.mocked(igdbRequest).mockRejectedValue(new Error("boom"));
    const res = await request(app).get("/api/games/search").query({ q: "hades" });
    expect(res.status).toBe(500);
  });
});

describe("GET /api/games/:id/details", () => {
  it("rejects a non-integer id", async () => {
    const res = await request(app).get("/api/games/abc/details");
    expect(res.status).toBe(400);
  });

  it("maps IGDB data to developer, release date and time to beat", async () => {
    vi.mocked(igdbRequest)
      .mockResolvedValueOnce([
        {
          name: "Hades",
          summary: "Roguelike",
          first_release_date: 1600000000,
          involved_companies: [
            { developer: false, company: { name: "Publisher Co" } },
            { developer: true, company: { name: "Supergiant Games" } },
          ],
        },
      ])
      .mockResolvedValueOnce([{ normally: 72000, completely: 180000 }]);

    const res = await request(app).get("/api/games/113112/details");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      name: "Hades",
      summary: "Roguelike",
      first_release_date: 1600000000,
      developer: "Supergiant Games",
      age_ratings: [],
      audio_languages: [],
      store_links: [],
      time_to_beat_main_seconds: 72000,
      time_to_beat_completionist_seconds: 180000,
    });
  });

  it("returns nulls when IGDB has no data for the game", async () => {
    vi.mocked(igdbRequest).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const res = await request(app).get("/api/games/1/details");
    expect(res.status).toBe(200);
    expect(res.body.developer).toBeNull();
    expect(res.body.time_to_beat_main_seconds).toBeNull();
  });

  it("returns 500 when IGDB fails", async () => {
    vi.mocked(igdbRequest).mockRejectedValue(new Error("boom"));
    const res = await request(app).get("/api/games/1/details");
    expect(res.status).toBe(500);
  });
});
