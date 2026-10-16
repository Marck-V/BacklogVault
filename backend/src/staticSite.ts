import express from "express";
import path from "path";
import type { Response } from "express";

// The website's own security headers. The API's JSON keeps helmet's defaults; pages get this stricter set, which allows
// exactly what the React app needs: its own scripts and styles, and cover art from IGDB. (helmet also adds HSTS and its
// other headers to every response, pages included.)
export const SITE_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://images.igdb.com; connect-src 'self'; " +
    "font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

// Serves the built React app (the "dist" folder) from the API, so the whole site is one service:
// - /assets/* are hashed build files that never change: cached for a year. A missing one is a real 404, never cached.
// - every other file (index.html, the favicon, the Steam button) is re-checked on each visit, so a deploy shows at once.
// - any other page address (for example /lists/4) gets index.html, so React Router can show it.
export function siteRouter(dir: string) {
  const router = express.Router();
  const noCache = (res: Response) => res.set("Cache-Control", "no-cache");

  router.use((req, res, next) => {
    res.set(SITE_HEADERS);
    next();
  });

  router.use("/assets", express.static(path.join(dir, "assets"), { index: false, immutable: true, maxAge: "1y" }));
  router.use("/assets", (req, res) => {
    noCache(res);
    res.status(404).type("text/plain").send("Not found");
  });

  router.use(express.static(dir, { index: false, cacheControl: false, setHeaders: noCache }));

  // Express 5 path syntax: "/{*rest}" matches any address, including "/".
  router.get("/{*rest}", (req, res) => {
    noCache(res);
    res.sendFile(path.join(dir, "index.html"));
  });

  return router;
}
