# Security audit: BacklogVault

**Date:** 2026-10-14. **Scope:** the whole repository (Express API, React app, Dockerfile and start-up script, Docker
Compose, GitHub Actions, dependencies, Git history) and the live deployment on Railway
(`backlogvault.up.railway.app`).

**Method:** manual review of every route and every database and IGDB query, targeted searches of the code and the full
Git history, `npm audit` in all three packages, inspection of the built Docker image, automated tests written for each
fix, and a small number of requests to the live site (listed in the appendix). I am not a professional penetration
tester; this is a careful engineering review, not a certification.

## Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Every per-visitor rate limit could be bypassed on Railway with a faked `X-Forwarded-For` header | **High** | **Fixed in code** (not yet deployed); needs one Railway setting and one live check |
| 2 | Data could be lost: no automated server backups, and Railway deletes trial volumes 30 days after the credit runs out on the Free plan | **Medium** | Open: needs a plan decision |
| 3 | Whoever controls your GitHub account controls the live site (automatic deploys); IGDB client secret may still be the one pasted in chat earlier | **Medium** | Open: account settings |
| 4 | In production the API still lets the local development address `http://localhost:5173` call it with cookies | Low | **Fixed** |
| 5 | The IGDB (Twitch) client secret is sent in the address of the token request instead of the request body | Low | **Fixed** |
| 6 | Game search text has no length limit | Low | **Fixed** |
| 7 | Rate-limit counters live in memory, so every deploy or restart resets them | Low | Accepted for one instance |
| 8 | Steam sign-in could also check that the fields we rely on are among the ones Steam signed | Low (hardening) | Open |
| 9 | The old email/password account code still ships, switched off | Info | Planned: removed when Firebase is added |
| 10 | GitHub Actions are pinned to version tags, not exact commits | Info | Accepted (Dependabot updates them) |
| 11 | A game's cover address can be any `https://` address the user chooses | Info | No impact found |

Nothing was found that exposes one visitor's data to another, lets anyone run code on the server, or leaks a secret.

## Findings

### 1. Rate limits could be bypassed on Railway (High, fixed in code)
**What:** every per-visitor limit (game searches and other IGDB lookups, new guest sessions, list changes, Steam imports
and sign-ins, backup restores) counts by the visitor's address. With `TRUST_PROXY=1`, the app read that address from
the `X-Forwarded-For` header. Railway's proxy passes a visitor's own `X-Forwarded-For` through unchanged and reports the
real address in a different header, `X-Real-IP` (Railway documentation, "Specs & Limits").

**Evidence (live, 2026-10-14):** 12 restore requests, each claiming a different made-up address, all got through
(limit is 10 per hour); a normal request afterwards showed 7 of the 10 still unused for the real address.

**Impact:** a script could create unlimited guest accounts (filling the 0.5 to 5 GB volume), use up the site's IGDB
quota (getting the IGDB key throttled or suspended for everyone), and burn through the site-wide daily Steam allowance
(switching Steam features off for everyone). It does not expose anyone's data.

**Fix:** a new setting, `CLIENT_IP_HEADER`. When set (Railway: `X-Real-IP`), the app takes the visitor's address only
from that header, accepts it only if it is a valid IP address (otherwise it uses the connection's own address), and
discards `X-Forwarded-For` entirely so nothing else can be misled by it. It takes priority over `TRUST_PROXY`.
Files: `backend/src/clientIp.js`, `backend/src/config.js`, `backend/src/app.js`.

**Verified locally:** 7 new tests, including one that first reproduces the live problem; breaking the fix on purpose
made tests fail; and in the real Docker image configured like Railway, a faked `X-Forwarded-For` no longer helped (the
third request was refused) while a different real visitor still got through.

**Still to do:** (a) deploy; (b) in Railway Variables add `CLIENT_IP_HEADER=X-Real-IP` and delete `TRUST_PROXY`;
(c) one live check, with your approval first, that Railway replaces a visitor's own `X-Real-IP` with the real address
rather than passing it through. If Railway passed it through, this header could be faked too, and a different approach
would be needed.

### 2. Data durability (Medium, open)
Libraries live in one SQLite file on a Railway volume. Railway's docs say trial volumes are deleted 30 days after the
trial credit expires unless the account is upgraded; the server-side backup script needs a shell on the host, which
Railway does not give by default. Railway lists volume backups as a feature for services with volumes.
**Recommendation:** move to the Hobby plan before the trial ends, turn on Railway's volume backups, and keep your own
copy with Download Backup now and then.

### 3. Account security and the IGDB secret (Medium, open)
Pushing to `main` deploys automatically, so your GitHub account is effectively the production server's key, and the
Railway account holds every secret.
**Recommendation:** turn on two-factor sign-in for GitHub, Railway, Twitch (IGDB) and Steam. Keep Railway's GitHub app
limited to this one repository (it is). Rotate the IGDB client secret in the Twitch developer console if you have not
since it was pasted into a chat early in the project, then update it in Railway and your local `backend/.env`.

### 4. Development CORS address allowed in production (Low, fixed)
`CORS_ORIGIN` defaults to `http://localhost:5173`, so the live API accepts cookie-carrying calls from a page at that
address. An attacker would need a page running on the victim's own computer at that address, so the risk is low.
**Fixed:** in production (`NODE_ENV=production`, which the Docker image sets) no other address is allowed unless
`CORS_ORIGIN` lists it; development keeps the Vite address. 3 tests; checked in the production image (no
`Access-Control-Allow-Origin` for `http://localhost:5173`).

### 5. IGDB secret in the token request's address (Low, fixed)
`igdbClient.js` puts `client_secret` in the query string of the Twitch token request. Addresses are more likely than
request bodies to end up in logs and error messages. No leak was found. **Fixed:** sent as a form body; the test now also checks the address has no query string, and a real
search through the rebuilt image got a fresh Twitch token this way.

### 6. No length limit on search text (Low, fixed)
`/api/games/search?q=` forwards any length of text to IGDB (it is correctly escaped, so this is not an injection).
**Fixed:** more than 100 characters is refused (400) before IGDB is asked, and the search box stops at 100.

### 7. In-memory rate-limit counters (Low, accepted)
Counters reset on every deploy or restart. With one instance and occasional deploys this is acceptable; a shared store
(the database or Redis) would be needed if the site ever ran on more than one instance.

### 8. Steam sign-in hardening (Low, optional)
The callback already does what matters: it asks Steam to confirm the exact response, uses a one-time code tied to the
same visitor, and requires the exact return address and a valid Steam ID. As defence in depth it could also require
that Steam's `openid.signed` list includes `claimed_id`, `identity`, `return_to`, `op_endpoint` and `response_nonce`.

### 9 to 11 (Info)
- The homegrown email/password code is switched off (its endpoints answer 404) but still ships; it goes when Firebase
  Auth replaces it.
- GitHub Actions use version tags such as `actions/checkout@v7` rather than exact commit hashes. Dependabot keeps them
  current; pinning to hashes would be stricter.
- A list owner can set a game's cover to any `https://` address. Only that owner sees it, and the page's content policy
  only loads images from IGDB, so there is no impact; it could be limited to `images.igdb.com`.

## Checked and found sound
- **Database injection:** every SQL statement uses placeholders; none is built by pasting in text.
- **IGDB query injection:** search text is escaped; every other value pasted into an IGDB query is a checked whole
  number or a Steam app number.
- **Access control:** every list and game query is limited to its owner, and another person's list answers 404, the same
  as a list that does not exist. Achievements, exports, backups, Steam actions and Delete My Data act only on the
  signed-in visitor.
- **Sessions:** 256-bit random tokens, stored only as SHA-256 hashes; the cookie is `HttpOnly`, `SameSite=Lax` and
  (on Railway) `Secure`; 30-day sliding expiry; idle guests deleted after 90 days.
- **Cross-site request forgery:** `SameSite=Lax` cookies, JSON-only bodies, and destructive actions (Disconnect Steam,
  Delete My Data) also require an explicit confirmation flag in the request.
- **Cross-site scripting:** React escapes everything it shows, there is no raw HTML anywhere, and the pages send a strict
  Content-Security-Policy (only the site's own scripts and styles, images from IGDB, no framing).
- **Links:** external store links are checked on the server to be `http(s)` addresses and open with
  `noopener noreferrer`; redirects after Steam sign-in go only to the configured address.
- **Uploads:** bodies over the limit are refused at once (413 in about 50 ms), including uploads with no declared size;
  backup files are validated field by field before anything is written, and restoring only ever adds.
- **Static files:** requests that try to climb out of the website folder are refused (tested).
- **Errors:** visitors get a short JSON message, never a stack trace; the Steam key is never logged.
- **CSV export:** values a spreadsheet would run as a formula are neutralised.
- **Secrets:** none in any of the 25 commits in the history; `.env` files are excluded from Git and from the image;
  secrets on Railway live in its Variables.
- **Container:** the image holds only the app, its production packages and the built site (no `.env`, databases or
  tests); base images are pinned by digest; the app runs as an unprivileged user (uid 1000) after the start-up script
  prepares the data folder.
- **Dependencies:** `npm audit` reports 0 known vulnerabilities in the backend, frontend and report tool.
- **Live headers:** HTTPS with HSTS, HTTP redirects to HTTPS, and every security header identical to local (checked
  header by header on 12 kinds of request).

## Appendix: requests sent to the live site during this work
All on 2026-10-14, about 40 in total: a header check of 12 kinds of request (page, app routes, files, API paths),
including one 4.5 MB and one 6 MB upload to the restore endpoint (both refused); one game search; a few page loads; and
13 small requests to the restore endpoint, 12 of them with a made-up `X-Forwarded-For`. From now on, any request to the
live site is described and approved first.
