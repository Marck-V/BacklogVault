import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../src/igdbClient.js", () => ({ igdbRequest: vi.fn() }));

// These tests start far more sign-ins than one visitor would in an hour, so lift the per-IP caps for this file.
// (The cap itself is tested at the bottom with a small limit.)
vi.hoisted(() => {
  process.env.STEAM_LINK_RATE_LIMIT = "100000";
  process.env.GUEST_RATE_LIMIT = "100000";
});

import app from "../src/app.js";
import db from "../src/db.js";
import { publicUrl, appUrl } from "../src/config.js";
import { buildLoginUrl, claimedSteamId, readOpenIdParams } from "../src/steamOpenId.js";
import { createSteamLinkLimiter } from "../src/writeLimiters.js";
import { resetDb, newClient, createList } from "./helpers.js";

const KEY = "TESTKEY0123456789abcdef0123456789";
const STEAM_ID = "76561197960287930";
const OTHER_ID = "76561198000000001";
const BASE = "http://localhost:4000";
const APP = "http://localhost:5173";

let steamCalls;
let steamAnswer; // what Steam's check_authentication says
let personaName;
let client;

function installSteam() {
  steamCalls = [];
  steamAnswer = () => new Response("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n", { status: 200 });
  personaName = "Gabe";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, options = {}) => {
      const u = new URL(String(url));
      steamCalls.push({ url: u, method: options.method ?? "GET", body: options.body ? Object.fromEntries(new URLSearchParams(options.body)) : null });
      if (u.pathname === "/openid/login") return steamAnswer();
      if (u.pathname === "/ISteamUser/GetPlayerSummaries/v2/") {
        return new Response(JSON.stringify({ response: { players: personaName ? [{ personaname: personaName }] : [] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 404 });
    })
  );
}

// Starts the flow like the button does and returns what Steam would send back for a given Steam ID.
async function start(agent = client) {
  const res = await agent.get("/api/auth/steam/start");
  const login = new URL(res.headers.location);
  const returnTo = login.searchParams.get("openid.return_to");
  return { res, login, returnTo, state: new URL(returnTo).searchParams.get("state") };
}

function assertionFor(returnTo, steamId = STEAM_ID, overrides = {}) {
  const claimed = `https://steamcommunity.com/openid/id/${steamId}`;
  return {
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.op_endpoint": "https://steamcommunity.com/openid/login",
    "openid.claimed_id": claimed,
    "openid.identity": claimed,
    "openid.return_to": returnTo,
    "openid.response_nonce": "2026-10-12T20:00:00Zabc",
    "openid.assoc_handle": "1234567890",
    "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    "openid.sig": "c2lnbmF0dXJl",
    ...overrides,
  };
}

const callback = (agent, state, params) => agent.get("/api/auth/steam/callback").query({ state, ...params });
const row = () => db.prepare("SELECT steam_id, steam_verified, steam_persona FROM users ORDER BY id").all();
const outcome = (res) => {
  const url = new URL(res.headers.location);
  return { origin: url.origin, steam: url.searchParams.get("steam"), reason: url.searchParams.get("reason") };
};

beforeEach(() => {
  resetDb();
  db.exec("DELETE FROM steam_link_attempts");
  client = newClient(app);
  vi.stubEnv("STEAM_API_KEY", KEY);
  vi.stubEnv("PUBLIC_URL", BASE);
  vi.stubEnv("APP_URL", APP);
  vi.spyOn(console, "error").mockImplementation(() => {});
  installSteam();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/auth/steam/start", () => {
  it("sends the visitor to Steam's own sign-in page, asking only which account they are", async () => {
    const { res, login, returnTo } = await start();
    expect(res.status).toBe(302);
    expect(login.origin + login.pathname).toBe("https://steamcommunity.com/openid/login");
    expect(login.searchParams.get("openid.mode")).toBe("checkid_setup");
    expect(login.searchParams.get("openid.realm")).toBe(BASE);
    expect(login.searchParams.get("openid.identity")).toBe("http://specs.openid.net/auth/2.0/identifier_select");
    expect(returnTo).toMatch(new RegExp(`^${BASE}/api/auth/steam/callback\\?state=[A-Za-z0-9_-]{43}$`));
  });

  it("gives a first-time visitor a guest session, as the rest of the site does", async () => {
    expect(db.prepare("SELECT COUNT(*) AS n FROM users").get().n).toBe(0);
    const { res } = await start();
    expect(res.headers["set-cookie"].join(";")).toContain("bv_session=");
    expect(db.prepare("SELECT COUNT(*) AS n FROM users WHERE is_guest = 1").get().n).toBe(1);
  });

  it("stores only a hash of the one-time code", async () => {
    const { state } = await start();
    const stored = db.prepare("SELECT token_hash FROM steam_link_attempts").get().token_hash;
    expect(stored).toHaveLength(64);
    expect(stored).not.toContain(state);
  });

  it("builds the return address from configuration, never from the request's Host header", async () => {
    const res = await client.get("/api/auth/steam/start").set("Host", "evil.example");
    const returnTo = new URL(res.headers.location).searchParams.get("openid.return_to");
    expect(returnTo.startsWith(`${BASE}/`)).toBe(true);
    expect(res.headers.location).not.toContain("evil.example");
  });

  it("is off when the server has no Steam key", async () => {
    vi.stubEnv("STEAM_API_KEY", "");
    expect((await client.get("/api/auth/steam/start")).status).toBe(503);
  });
});

describe("GET /api/auth/steam/callback", () => {
  it("links the Steam account once Steam confirms the response, and says so", async () => {
    const { state, returnTo } = await start();
    const res = await callback(client, state, assertionFor(returnTo));

    expect(res.status).toBe(302);
    expect(outcome(res)).toEqual({ origin: APP, steam: "linked", reason: null });
    expect(row()).toEqual([{ steam_id: STEAM_ID, steam_verified: 1, steam_persona: "Gabe" }]);
  });

  it("asks Steam to confirm exactly what it was sent, with only the mode changed", async () => {
    const { state, returnTo } = await start();
    const params = assertionFor(returnTo);
    await callback(client, state, params);

    const check = steamCalls.find((c) => c.method === "POST");
    expect(check.url.href).toBe("https://steamcommunity.com/openid/login");
    expect(check.body).toEqual({ ...params, "openid.mode": "check_authentication" });
  });

  it("rejects a forged response that Steam does not recognise", async () => {
    const { state, returnTo } = await start();
    steamAnswer = () => new Response("ns:http://specs.openid.net/auth/2.0\nis_valid:false\n", { status: 200 });
    const res = await callback(client, state, assertionFor(returnTo, OTHER_ID));

    expect(outcome(res)).toMatchObject({ steam: "error", reason: "invalid" });
    expect(row()).toEqual([{ steam_id: null, steam_verified: 0, steam_persona: null }]);
  });

  it("only works once: the same address a second time is refused", async () => {
    const { state, returnTo } = await start();
    const params = assertionFor(returnTo);
    await callback(client, state, params);
    steamCalls.length = 0;

    const again = await callback(client, state, params);
    expect(outcome(again)).toMatchObject({ steam: "error", reason: "state" });
    expect(steamCalls).toHaveLength(0);
  });

  it("uses up the code even when the response turns out to be forged", async () => {
    const { state, returnTo } = await start();
    steamAnswer = () => new Response("is_valid:false", { status: 200 });
    await callback(client, state, assertionFor(returnTo));

    steamAnswer = () => new Response("is_valid:true", { status: 200 });
    const retry = await callback(client, state, assertionFor(returnTo));
    expect(outcome(retry).reason).toBe("state");
    expect(row()[0].steam_verified).toBe(0);
  });

  it("refuses a code that belongs to a different visitor", async () => {
    const { state, returnTo } = await start();
    const stranger = newClient(app);
    await createList(stranger, "Theirs"); // a different session
    const res = await callback(stranger, state, assertionFor(returnTo));

    expect(outcome(res).reason).toBe("state");
    expect(steamCalls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(row().every((u) => u.steam_verified === 0)).toBe(true);
  });

  it.each([
    ["no code", () => ({ state: undefined })],
    ["a code of the wrong shape", () => ({ state: "short" })],
    ["a code that was never issued", () => ({ state: "A".repeat(43) })],
  ])("refuses %s without asking Steam", async (_label, make) => {
    const { returnTo } = await start();
    const res = await client.get("/api/auth/steam/callback").query({ ...make(), ...assertionFor(returnTo) });
    expect(outcome(res)).toMatchObject({ steam: "error", reason: "state" });
    expect(steamCalls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("refuses an expired code", async () => {
    const { state, returnTo } = await start();
    db.prepare("UPDATE steam_link_attempts SET expires_at = ?").run(new Date(Date.now() - 1000).toISOString());
    const res = await callback(client, state, assertionFor(returnTo));
    expect(outcome(res).reason).toBe("state");
  });

  it("refuses a visitor with no session", async () => {
    const { state, returnTo } = await start();
    const res = await callback(request(app), state, assertionFor(returnTo));
    expect(outcome(res).reason).toBe("session");
  });

  it.each([
    ["a different return address", (rt) => ({ "openid.return_to": `${rt}&x=1` })],
    ["a return address on another site", (rt) => ({ "openid.return_to": rt.replace("localhost:4000", "evil.example") })],
    ["a response that is not a success", () => ({ "openid.mode": "cancel" })],
    ["a different provider", () => ({ "openid.op_endpoint": "https://evil.example/openid/login" })],
    ["another protocol version", () => ({ "openid.ns": "http://specs.openid.net/auth/1.1" })],
    ["a claimed id on another site", () => ({ "openid.claimed_id": `https://evil.example/openid/id/${STEAM_ID}`, "openid.identity": `https://evil.example/openid/id/${STEAM_ID}` })],
    ["a claimed id that is not a Steam ID", () => ({ "openid.claimed_id": "https://steamcommunity.com/openid/id/123", "openid.identity": "https://steamcommunity.com/openid/id/123" })],
    ["an identity that differs from the claimed id", () => ({ "openid.identity": `https://steamcommunity.com/openid/id/${OTHER_ID}` })],
  ])("refuses %s before asking Steam", async (_label, change) => {
    const { state, returnTo } = await start();
    const res = await callback(client, state, assertionFor(returnTo, STEAM_ID, change(returnTo)));

    expect(outcome(res)).toMatchObject({ steam: "error", reason: "invalid" });
    expect(steamCalls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(row()[0].steam_verified).toBe(0);
  });

  it("refuses a repeated parameter", async () => {
    const { state, returnTo } = await start();
    const res = await client
      .get(`/api/auth/steam/callback?state=${state}&openid.mode=id_res&openid.mode=cancel`)
      .query(assertionFor(returnTo, STEAM_ID, { "openid.mode": undefined }));
    expect(outcome(res).steam).toBe("error");
    expect(row()[0].steam_verified).toBe(0);
  });

  it("says Steam is unavailable, and links nothing, when Steam cannot be reached", async () => {
    const { state, returnTo } = await start();
    steamAnswer = () => new Response("down", { status: 503 });
    const res = await callback(client, state, assertionFor(returnTo));

    expect(outcome(res)).toMatchObject({ steam: "error", reason: "unavailable" });
    expect(row()[0].steam_verified).toBe(0);
    expect(JSON.stringify(console.error.mock.calls)).not.toContain(KEY);
  });

  it("still links when the display name cannot be fetched", async () => {
    personaName = null;
    const { state, returnTo } = await start();
    const res = await callback(client, state, assertionFor(returnTo));
    expect(outcome(res).steam).toBe("linked");
    expect(row()[0]).toMatchObject({ steam_id: STEAM_ID, steam_verified: 1, steam_persona: null });
  });

  it("does not let a second account claim a Steam account that is already connected", async () => {
    const first = await start();
    await callback(client, first.state, assertionFor(first.returnTo));

    const other = newClient(app);
    const second = await start(other);
    const res = await callback(other, second.state, assertionFor(second.returnTo));

    expect(outcome(res)).toMatchObject({ steam: "error", reason: "already_linked" });
    const rows = row();
    expect(rows[0]).toMatchObject({ steam_id: STEAM_ID, steam_verified: 1 });
    expect(rows[1]).toMatchObject({ steam_verified: 0 });
  });

  it("lets an account switch to a different Steam account", async () => {
    const a = await start();
    await callback(client, a.state, assertionFor(a.returnTo, STEAM_ID));
    const b = await start();
    await callback(client, b.state, assertionFor(b.returnTo, OTHER_ID));
    expect(row()).toEqual([{ steam_id: OTHER_ID, steam_verified: 1, steam_persona: "Gabe" }]);
  });

  it("is off when the server has no Steam key", async () => {
    vi.stubEnv("STEAM_API_KEY", "");
    const res = await client.get("/api/auth/steam/callback").query({ state: "A".repeat(43) });
    expect(outcome(res).reason).toBe("disabled");
  });
});

describe("connected state", () => {
  async function connect(agent = client, steamId = STEAM_ID) {
    const { state, returnTo } = await start(agent);
    await callback(agent, state, assertionFor(returnTo, steamId));
  }

  it("is reported by the status endpoint", async () => {
    expect((await client.get("/api/import/steam/status")).body).toEqual({ enabled: true, linked: false, personaName: null });
    await connect();
    expect((await client.get("/api/import/steam/status")).body).toEqual({ enabled: true, linked: true, personaName: "Gabe" });
  });

  it("is never reported to a stranger", async () => {
    await connect();
    expect((await request(app).get("/api/import/steam/status")).body.linked).toBe(false);
  });

  it("can be disconnected, which clears the account but keeps the imported games", async () => {
    await connect();
    const list = await createList(client);
    db.prepare("INSERT INTO list_games (list_id, igdb_id, name) VALUES (?, 1, 'Kept')").run(list.id);

    const res = await client.delete("/api/steam/link");
    expect(res.body).toEqual({ linked: false });
    expect(row()).toEqual([{ steam_id: null, steam_verified: 0, steam_persona: null }]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM list_games").get().n).toBe(1);
  });

  it("frees the Steam account for someone else once disconnected", async () => {
    await connect();
    await client.delete("/api/steam/link");
    const other = newClient(app);
    await connect(other);
    expect(row().filter((u) => u.steam_verified === 1)).toHaveLength(1);
  });

  it("needs a session to disconnect", async () => {
    expect((await request(app).delete("/api/steam/link")).status).toBe(401);
  });

  it("follows a guest into the account they sign in to", async () => {
    // an existing account with no Steam link
    const owner = newClient(app);
    await owner.post("/api/auth/register").send({ email: "owner@example.com", password: "correct horse battery" });
    await owner.post("/api/auth/logout");

    const guest = newClient(app);
    await createList(guest, "Guest list");
    await connect(guest);
    const login = await guest.post("/api/auth/login").send({ email: "owner@example.com", password: "correct horse battery", mergeGuestData: true });
    expect(login.status).toBe(200);

    const accounts = db.prepare("SELECT email, steam_id, steam_verified FROM users").all();
    expect(accounts).toEqual([{ email: "owner@example.com", steam_id: STEAM_ID, steam_verified: 1 }]);
  });
});

describe("OpenID helpers", () => {
  it("builds the login address with every required field", () => {
    const url = new URL(buildLoginUrl({ returnTo: `${BASE}/cb?state=x`, realm: BASE }));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      "openid.ns": "http://specs.openid.net/auth/2.0",
      "openid.mode": "checkid_setup",
      "openid.return_to": `${BASE}/cb?state=x`,
      "openid.realm": BASE,
      "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
      "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    });
  });

  it("reads only the openid.* values, and refuses a repeated one", () => {
    expect(readOpenIdParams({ state: "s", "openid.mode": "id_res", other: "x" })).toEqual({ "openid.mode": "id_res" });
    expect(readOpenIdParams({ "openid.mode": ["id_res", "cancel"] })).toBeNull();
  });

  it("extracts the Steam ID only from a well-formed response for the expected address", () => {
    const rt = `${BASE}/cb?state=x`;
    expect(claimedSteamId(assertionFor(rt), rt)).toBe(STEAM_ID);
    expect(claimedSteamId(assertionFor(rt), `${rt}y`)).toBeNull();
  });
});

describe("addresses", () => {
  it("normalises configured addresses to an origin and rejects nonsense", () => {
    expect(publicUrl({ PUBLIC_URL: "https://vault.example.com/anything?x=1" })).toBe("https://vault.example.com");
    expect(publicUrl({ PORT: "4100" })).toBe("http://localhost:4100");
    expect(() => publicUrl({ PUBLIC_URL: "not a url" })).toThrow(/PUBLIC_URL/);
    expect(() => publicUrl({ PUBLIC_URL: "ftp://example.com" })).toThrow(/http/);
  });

  it("sends visitors back to APP_URL, else the public address, else the dev site", () => {
    expect(appUrl({ APP_URL: "http://localhost:5173/", PUBLIC_URL: "https://x.example" })).toBe("http://localhost:5173");
    expect(appUrl({ PUBLIC_URL: "https://x.example" })).toBe("https://x.example");
    expect(appUrl({ CORS_ORIGIN: "http://localhost:5173,http://localhost:8080" })).toBe("http://localhost:5173");
    expect(appUrl({})).toBe("http://localhost:5173");
  });
});

describe("the sign-in rate limit", () => {
  it("stops one address from starting sign-ins endlessly", async () => {
    const small = express();
    small.get("/start", createSteamLinkLimiter(2), (req, res) => res.json({ ok: true }));
    expect((await request(small).get("/start")).status).toBe(200);
    expect((await request(small).get("/start")).status).toBe(200);
    const blocked = await request(small).get("/start");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Too many Steam sign-in attempts/);
  });
});
