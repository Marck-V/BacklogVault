import net from "net";

// Makes req.ip the visitor's real address as reported by the host's proxy in `header` (see config.js), so every per-IP
// rate limit counts real visitors. An address that is missing or not a valid IP falls back to the connection's own
// address. X-Forwarded-For is dropped: on such a host it is whatever the visitor typed, and nothing may rely on it.
export function useClientIpHeader(header) {
  return (req, res, next) => {
    const raw = req.headers[header];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (net.isIP(value)) Object.defineProperty(req, "ip", { value, configurable: true, enumerable: true });
    delete req.headers["x-forwarded-for"];
    next();
  };
}
