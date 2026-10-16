import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";

const jsonResponse = (body, init = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });

let fetchMock: Mock;
let igdbRequest: typeof import("../src/igdbClient.ts").igdbRequest;

const isIgdb = ([url]: unknown[]) => String(url).includes("api.igdb.com");
const igdbCalls = () => fetchMock.mock.calls.filter(isIgdb);

async function loadClient() {
  vi.resetModules(); // the queue is module-level state, so each test needs its own copy
  ({ igdbRequest } = await import("../src/igdbClient.ts"));
}

beforeEach(() => {
  process.env.IGDB_CLIENT_ID = "test-client";
  process.env.IGDB_CLIENT_SECRET = "test-secret";
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  delete process.env.IGDB_MIN_INTERVAL_MS;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function respondWith(igdbHandler) {
  fetchMock.mockImplementation(async (url, options) =>
    String(url).includes("id.twitch.tv")
      ? jsonResponse({ access_token: "t", expires_in: 3600 })
      : igdbHandler(url, options)
  );
}

describe("outbound rate limit", () => {
  it("starts IGDB requests at least 300 ms apart (under 4 per second)", async () => {
    process.env.IGDB_MIN_INTERVAL_MS = "300";
    await loadClient();
    const startTimes: number[] = [];
    respondWith(async () => {
      startTimes.push(Date.now());
      return jsonResponse([]);
    });

    const done = Promise.all(Array.from({ length: 5 }, (_, i) => igdbRequest("games", `q${i}`)));
    await vi.advanceTimersByTimeAsync(2000);
    await done;

    expect(startTimes).toHaveLength(5);
    const gaps = startTimes.slice(1).map((t, i) => t - startTimes[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(300);
    expect(startTimes[4] - startTimes[0]).toBe(1200);
  });

  it("never has more than 8 requests open at once", async () => {
    process.env.IGDB_MIN_INTERVAL_MS = "0";
    await loadClient();
    const releases: Array<() => void> = [];
    respondWith(() => new Promise((resolve) => releases.push(() => resolve(jsonResponse([])))));

    const all = Promise.all(Array.from({ length: 12 }, (_, i) => igdbRequest("games", `q${i}`)));
    await vi.advanceTimersByTimeAsync(10);
    expect(igdbCalls()).toHaveLength(8);

    releases.shift()?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(igdbCalls()).toHaveLength(9);

    while (releases.length) releases.shift()?.();
    await vi.advanceTimersByTimeAsync(10);
    while (releases.length) releases.shift()?.();
    await all;
    expect(igdbCalls()).toHaveLength(12);
  });

  it("frees the slot when a request fails, so the queue keeps moving", async () => {
    process.env.IGDB_MIN_INTERVAL_MS = "0";
    await loadClient();
    let n = 0;
    respondWith(async () => {
      n += 1;
      if (n === 1) throw new Error("network down");
      return jsonResponse([{ ok: true }]);
    });

    const first = igdbRequest("games", "a").catch((e) => e.message);
    const second = igdbRequest("games", "b");
    await vi.advanceTimersByTimeAsync(10);
    expect(await first).toBe("network down");
    expect(await second).toEqual([{ ok: true }]);
  });
});

describe("429 handling", () => {
  beforeEach(async () => {
    process.env.IGDB_MIN_INTERVAL_MS = "0";
    await loadClient();
  });

  it("waits for Retry-After and then succeeds", async () => {
    let n = 0;
    respondWith(async () => {
      n += 1;
      return n === 1
        ? new Response("slow down", { status: 429, headers: { "Retry-After": "2" } })
        : jsonResponse([{ id: 1 }]);
    });

    const result = igdbRequest("games", "q");
    await vi.advanceTimersByTimeAsync(1900);
    expect(igdbCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(await result).toEqual([{ id: 1 }]);
    expect(igdbCalls()).toHaveLength(2);
  });

  it("caps an excessive Retry-After at 5 seconds", async () => {
    let n = 0;
    respondWith(async () => {
      n += 1;
      return n === 1
        ? new Response("wait", { status: 429, headers: { "Retry-After": "600" } })
        : jsonResponse([]);
    });

    const result = igdbRequest("games", "q");
    await vi.advanceTimersByTimeAsync(5100);
    await result;
    expect(igdbCalls()).toHaveLength(2);
  });

  it("falls back to exponential backoff without a Retry-After header", async () => {
    let n = 0;
    respondWith(async () => {
      n += 1;
      return n < 3 ? new Response("slow down", { status: 429 }) : jsonResponse([{ done: true }]);
    });

    const result = igdbRequest("games", "q");
    await vi.advanceTimersByTimeAsync(1000); // first retry after 1 s
    expect(igdbCalls()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2000); // second retry after 2 s
    expect(await result).toEqual([{ done: true }]);
    expect(igdbCalls()).toHaveLength(3);
  });

  it("gives up after 2 retries and reports the 429", async () => {
    respondWith(async () => new Response("still limited", { status: 429 }));

    const result = igdbRequest("games", "q").catch((e) => e.message);
    await vi.advanceTimersByTimeAsync(10000);
    expect(await result).toMatch(/IGDB request failed: 429/);
    expect(igdbCalls()).toHaveLength(3);
  });
});
