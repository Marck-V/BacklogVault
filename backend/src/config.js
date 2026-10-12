// Number of reverse proxies between the internet and this API (for example nginx alone is 1; Caddy then nginx is 2).
// Express uses it to find the real visitor address in X-Forwarded-For, which every per-IP rate limit depends on.
// Too low and every visitor looks like the proxy; too high and a visitor could forge their own address.
export function trustProxyHops(value = process.env.TRUST_PROXY) {
  if (value === undefined || value === "") return 0;
  if (!/^\d+$/.test(value)) {
    throw new Error(`TRUST_PROXY must be a whole number of proxy hops, got "${value}"`);
  }
  return Number(value);
}
