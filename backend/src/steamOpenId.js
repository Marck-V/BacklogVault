import { SteamError } from "./steam.js";

// Steam's sign-in speaks OpenID 2.0. We only use it to learn which Steam account a visitor really controls.
export const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
const OPENID_NS = "http://specs.openid.net/auth/2.0";
const IDENTIFIER_SELECT = "http://specs.openid.net/auth/2.0/identifier_select";
const CLAIMED_ID = /^https:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/;
const REQUEST_TIMEOUT_MS = 10000;

// The address we send the visitor to. return_to carries a one-time `state` token that proves the visitor who comes
// back is the one who left, and realm is the site Steam shows on its sign-in page.
export function buildLoginUrl({ returnTo, realm }) {
  const url = new URL(STEAM_OPENID_ENDPOINT);
  url.search = new URLSearchParams({
    "openid.ns": OPENID_NS,
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": realm,
    "openid.identity": IDENTIFIER_SELECT,
    "openid.claimed_id": IDENTIFIER_SELECT,
  }).toString();
  return url.toString();
}

// Every openid.* value from the callback, or null if any is missing its value or repeated (an attack, not Steam).
export function readOpenIdParams(query) {
  const params = {};
  for (const [key, value] of Object.entries(query ?? {})) {
    if (!key.startsWith("openid.")) continue;
    if (typeof value !== "string") return null;
    params[key] = value;
  }
  return params;
}

// Cheap checks that need no network, done before bothering Steam. Returns the Steam ID the response claims, or null.
export function claimedSteamId(params, expectedReturnTo) {
  if (params["openid.ns"] !== OPENID_NS) return null;
  if (params["openid.mode"] !== "id_res") return null;
  if (params["openid.op_endpoint"] !== STEAM_OPENID_ENDPOINT) return null;
  if (params["openid.return_to"] !== expectedReturnTo) return null;

  const claimed = CLAIMED_ID.exec(params["openid.claimed_id"] ?? "");
  if (!claimed) return null;
  if (params["openid.identity"] !== params["openid.claimed_id"]) return null;
  return claimed[1];
}

// The check that matters: ask Steam itself whether it issued this exact response. Without it anyone could forge a
// callback that says "I am Steam user X".
export async function steamConfirms(params) {
  const body = new URLSearchParams({ ...params, "openid.mode": "check_authentication" });
  let res;
  try {
    res = await fetch(STEAM_OPENID_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/plain" },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SteamError("unavailable", "Steam isn't responding right now. Please try again in a minute.", 502);
  }
  if (!res.ok) throw new SteamError("unavailable", "Steam isn't responding right now. Please try again in a minute.", 502, res.status);

  const text = await res.text().catch(() => "");
  return /^is_valid:true\s*$/m.test(text);
}
