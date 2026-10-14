// Number of reverse proxies between the internet and this API (none locally is 0; Railway's proxy is 1; a CDN in front of that would make it 2).
// Express uses it to find the real visitor address in X-Forwarded-For, which every per-IP rate limit depends on.
// Too low and every visitor looks like the proxy; too high and a visitor could forge their own address.
export function trustProxyHops(value = process.env.TRUST_PROXY) {
  if (value === undefined || value === "") return 0;
  if (!/^\d+$/.test(value)) {
    throw new Error(`TRUST_PROXY must be a whole number of proxy hops, got "${value}"`);
  }
  return Number(value);
}

function originOf(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a full web address such as https://example.com, got "${value}"`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must start with http:// or https://, got "${value}"`);
  }
  return url.origin;
}

// The address the outside world uses to reach this API. Steam sends visitors back here after sign-in, so it comes
// from configuration and never from the request (a forged Host header must not be able to redirect anyone).
export function publicUrl(env = process.env) {
  return originOf(env.PUBLIC_URL || `http://localhost:${env.PORT || 4000}`, "PUBLIC_URL");
}

// Where visitors land after Steam sign-in: the website. Same as publicUrl when one address serves both (the Docker image),
// and the Vite dev server in local development, where the API and the website are on different ports.
export function appUrl(env = process.env) {
  if (env.APP_URL) return originOf(env.APP_URL, "APP_URL");
  if (env.PUBLIC_URL) return originOf(env.PUBLIC_URL, "PUBLIC_URL");
  return originOf((env.CORS_ORIGIN || "http://localhost:5173").split(",")[0].trim(), "CORS_ORIGIN");
}

// Accounts (email and password) are switched off by default: visitors get a library on this device without signing up.
// Set ENABLE_ACCOUNTS=true to offer sign up and sign in. Read on every request so tests and operators can flip it.
export function accountsEnabled(env = process.env) {
  return env.ENABLE_ACCOUNTS === "true";
}
