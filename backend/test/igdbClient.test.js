import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const jsonResponse = (body, init = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });

let fetchMock;
let igdbRequest;

beforeEach(async () => {
  process.env.IGDB_CLIENT_ID = "test-client";
  process.env.IGDB_CLIENT_SECRET = "test-secret";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // The token cache is module-level state, so load a fresh copy for every test.
  vi.resetModules();
  ({ igdbRequest } = await import("../src/igdbClient.js"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const tokenCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("id.twitch.tv"));
const igdbCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("api.igdb.com"));

function mockTwitchAndIgdb({ expiresIn = 3600 } = {}) {
  let n = 0;
  fetchMock.mockImplementation(async (url) => {
    if (String(url).includes("id.twitch.tv")) {
      n += 1;
      return jsonResponse({ access_token: `token-${n}`, expires_in: expiresIn });
    }
    return jsonResponse([{ id: 1 }]);
  });
}

describe("igdbRequest", () => {
  it("requests a client-credentials token from Twitch using the env credentials", async () => {
    mockTwitchAndIgdb();
    await igdbRequest("games", "fields name;");
    const [url, options] = tokenCalls()[0];
    expect(options.method).toBe("POST");
    const params = new URL(url).searchParams;
    expect(params.get("client_id")).toBe("test-client");
    expect(params.get("client_secret")).toBe("test-secret");
    expect(params.get("grant_type")).toBe("client_credentials");
  });

  it("sends the Client-ID header, Bearer token and raw query body to IGDB", async () => {
    mockTwitchAndIgdb();
    const result = await igdbRequest("games", "fields name;");
    const [url, options] = igdbCalls()[0];
    expect(url).toBe("https://api.igdb.com/v4/games");
    expect(options.method).toBe("POST");
    expect(options.headers["Client-ID"]).toBe("test-client");
    expect(options.headers.Authorization).toBe("Bearer token-1");
    expect(options.body).toBe("fields name;");
    expect(result).toEqual([{ id: 1 }]);
  });

  it("caches the token across requests instead of re-authenticating every time", async () => {
    mockTwitchAndIgdb();
    await igdbRequest("games", "q1");
    await igdbRequest("games", "q2");
    await igdbRequest("games", "q3");
    expect(tokenCalls()).toHaveLength(1);
    expect(igdbCalls()).toHaveLength(3);
  });

  it("refreshes the token once it is within the 60 second safety buffer of expiring", async () => {
    mockTwitchAndIgdb({ expiresIn: 3600 });
    await igdbRequest("games", "q1");

    vi.setSystemTime(new Date("2026-01-01T00:58:00Z")); // 58 min: still valid
    await igdbRequest("games", "q2");
    expect(tokenCalls()).toHaveLength(1);

    vi.setSystemTime(new Date("2026-01-01T00:59:30Z")); // 30s before expiry: inside the buffer
    await igdbRequest("games", "q3");
    expect(tokenCalls()).toHaveLength(2);
    expect(igdbCalls()[2][1].headers.Authorization).toBe("Bearer token-2");
  });

  it("throws when Twitch rejects the credentials", async () => {
    fetchMock.mockResolvedValue(new Response("invalid client", { status: 400 }));
    await expect(igdbRequest("games", "q")).rejects.toThrow(/Failed to fetch Twitch access token: 400/);
  });

  it("throws when IGDB returns an error status", async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).includes("id.twitch.tv")
        ? jsonResponse({ access_token: "t", expires_in: 3600 })
        : new Response("rate limited", { status: 429 })
    );
    await expect(igdbRequest("games", "q")).rejects.toThrow(/IGDB request failed: 429/);
  });
});
