# BacklogVault: Metrics and Engineering Log

Purpose: a factual record of what was built, what was measured, and how it works, so resume and interview claims can be defended.

**Rules this file follows**
- A number appears under "Measured" only if a command produced it. The command is listed so you can re-run it.
- Anything not yet measured is listed under "Not yet measured" with the command that will produce it. Do not put those on a resume until you have the real number.
- Last updated: 2026-10-11. Re-run the commands and update the numbers whenever the code changes.

---

## Improvement log (before and after)

One row per improvement, newest last. Every row needs a **before**, an **after**, and the **evidence** (a command you can re-run). Add a row each time something is improved, and record the "before" number *before* making the change.

| Date | Improvement | Before | After | Evidence |
|---|---|---|---|---|
| 2026-10-08 | Automated tests | 0 tests | 58 tests at 95.6% line coverage (grew to 106 tests at 94.8% when accounts were added on 10-11) | `cd backend && npm run test:coverage` |
| 2026-10-08 | Test coverage of the IGDB client (Twitch token caching) | 21% of lines | 100% (fully covered files are hidden from the coverage table) | coverage report, 6 tests in `igdbClient.test.js` |
| 2026-10-08 | Search query injection | user text was interpolated straight into the IGDB query; repeated `?q=` was stringified | input escaped; blank or repeated `q` returns 400; 5 regression tests | `backend/test/games.test.js`, `igdbQuery.test.js` |
| 2026-10-08 | Dependency vulnerabilities | 4 (1 critical) | 0 | `cd backend && npm audit` |
| 2026-10-08 | Running the app | 3 processes started by hand on 3 host ports (4000, 5000, 5173) | one command (`docker compose up`), 3 images, **1** published port (8080) | `docker compose ps` |
| 2026-10-08 | Docker image size (multi-stage builds) | 1.68 GB API, 1.54 GB C#, 1.8 GB web (the builder stage, i.e. what a single-stage build would ship) | 355 MB, 392 MB, 94 MB (**79%, 75%, 95% smaller**) | `docker images` |
| 2026-10-11 | Data isolation between users | any visitor could read, change, delete and export everyone's data | per-user ownership on every query; other users get 404/401; the C# export is scoped too | 48 auth tests, live two-user check, CI smoke test |
| 2026-10-11 | Invalid requests creating accounts | each invalid `POST /api/lists` created a guest user row | 0 rows created | 4 tests in `auth.test.js` |
| 2026-10-11 | Login brute-force protection | unlimited attempts | 10 per 15 minutes per IP, then 429 | 13 live requests through nginx, plus a unit test |
| 2026-10-11 | Verification on every push | manual, local only | 5 automated CI jobs, about 88 s, all green on the first run | `gh run list` |
| 2026-10-11 | CI isolation check | a negated command (`! curl ... \| grep`) that could never fail under `set -e` | an explicit `if ...; then exit 1; fi`, run against the real stack | `.github/workflows/ci.yml` |
| 2026-10-11 | CI deprecation warnings | Node 20 deprecation and `ubuntu-latest` migration notices on the jobs | none (2 older frontend lint warnings remain); run time about 86 s | `gh run view <id>` |
| 2026-10-11 | Public IGDB search: burst from one client | 100 rapid requests, **all 100 accepted**, **100 calls to IGDB in 139 ms** (about 720 per second against a reported limit of 4 per second) | **60 accepted, 40 rejected with 429** (60 per minute per IP); **60 calls to IGDB**, spaced at least 289 ms apart, **at most 4 in any 1-second window** | before/after measured with the same 100-request burst; `igdbLimiter.test.js`, `igdbThrottle.test.js` |
| 2026-10-11 | IGDB outbound limit and retries | no cap on concurrent or per-second calls, and no handling of 429 | one queue for the whole site: 300 ms apart, at most 8 open; 429 retried up to 2 times honoring `Retry-After` (capped at 5 s) | 7 tests in `igdbThrottle.test.js` |
| 2026-10-11 | Dashboard when IGDB is down | **500 with no data**; counts from our own database (such as games completed) were lost too | **200 with the counts intact**, hour totals shown as "—" with a note | before: measured with IGDB mocked to fail; after: tests and the browser |
| 2026-10-11 | IGDB attribution | none | "Game data and cover art provided by IGDB.com" in the footer | `frontend/src/App.jsx` |
| 2026-10-11 | Export service coupling | 2 services read the same SQLite file; the export container mounted the data volume; **14 lines** of session-checking code were duplicated in C#; 1 NuGet package; the pair could only run on one machine with one disk | only the API touches the database; the export container has **0 mounts**; **0** duplicated lines; **0** NuGet packages; the service runs on any host | `docker inspect gamebacklogtracker-export-1`, `export-service/Program.cs` |
| 2026-10-11 | CSV export correctness | **3 of 3** awkward names mangled or unsafe: a comma silently replaced with a space, a name with a line break split into two records, a `=SUM(...)` value written raw (spreadsheet formula injection); quotes unescaped | **0 of 3**: values are quoted per RFC 4180, a standard CSV parser reads back exactly 3 records, and formula-like values get a leading apostrophe (visible in the cell, a deliberate trade-off) | the same 3 names sent through the full stack before and after; `CsvExportTests.cs` |
| 2026-10-11 | C# test coverage | 0 C# tests, and CI did not run any | 19 C# tests (quoting, formula neutralisation, record building), run in CI | `dotnet test export-service.tests` |
| 2026-10-11 | Export image size | 392 MB | 340 MB (**13% smaller**) because the SQLite native library is gone | `docker images` |
| 2026-10-11 | Export when the API is down | not applicable (it read the file directly) | a new dependency, handled gracefully: signed-in export returns a clean **502**, a missing cookie still gets **401**, health stays ok, and it recovers by itself | stopped the API container and requested the export |
| 2026-10-12 | Per-IP limits behind two proxies (Caddy then nginx) | with `TRUST_PROXY=1` the API saw the proxy's address for every visitor (172.18.0.5 instead of 203.0.113.7), so the per-IP limits were shared by the whole site: in the real containers, after visitor A used up the login allowance, a different visitor B was refused too (**429**) | the hop count is configurable (`TRUST_PROXY_HOPS`) and validated at startup; with 2 hops visitor A is limited at the 11th attempt (429) and visitor B is still served (**401**); a forged address does not buy extra attempts when the count matches the real chain | both settings run on the real containers; `proxyChain.test.js` (3), `config.test.js` (12) |
| 2026-10-12 | Crash on an error inside an async handler | an async Express 4 handler that throws made the process exit with code 1 and nothing answered afterwards (demonstrated); register and login had no protection and there was no global error handler; malformed JSON got an HTML error page | errors reach one JSON handler: a 500 with `Something went wrong` (no internals), the app keeps serving, malformed JSON is a JSON 400, an oversized body a JSON 413, an unknown API route a JSON 404 | `errorHandling.test.js` (6); I also confirmed the test run fails on the original bug pattern, so the tests would catch a regression |
| 2026-10-12 | Abuse limits on writes | **300 of 300** list creations from one client accepted; **100 anonymous clients created 100 guest accounts**; **90,000-character** list and game names accepted (HTTP 201) | through nginx on the real containers: 300 attempts stored **50** (70 refused by the cap, 180 rate limited); 100 anonymous clients created **10** guest accounts (90 refused); 90,000-character names get **400** with a clear message; normal input still works | same scenarios before and after; `abuseLimits.test.js` (3), `limits.test.js` (40) |

**Planned measurements for deployment** (record the before and after of each when we get there): time from `git push` to live, response time (median and 95th percentile) from outside the server, uptime over the first weeks, monthly cost, backup restore time, TLS grade, and security headers.

---

## 1. Measured (re-run to confirm)

### Testing (backend)
| Metric | Value | How to reproduce |
|---|---|---|
| Automated tests | **193 Node tests + 19 C# tests, 0 failing** (Node: 15 files) | `cd backend && npm test`, and `dotnet test export-service.tests` |
| Tests before this work | **0** | (none existed) |
| Line coverage (Node) | **95.8%** (341/356) | `cd backend && npm run test:coverage` |
| Statement coverage | 95.4% | same |
| Branch coverage | 91.1% | same |
| Function coverage | 96.9% | same |
| Coverage history | 84.7% lines (52 tests) to 95.6% (58 tests, after testing the IGDB client) to 94.8% (106 tests, after adding accounts) to 95.2% (123 tests, after IGDB protection) to 95.3% (129 tests, after the library route) to 95.8% (193 tests, after the pre-deployment fixes) | earlier measurements |
| Suite runtime | about 2.2 s (0.5 s before accounts existed; password hashing is the slowest part) | "Duration" line in `npm test` output |
| External network calls during tests | **0** (IGDB and Twitch are mocked or stubbed) | tests pass offline |
| `npm audit` | **0 vulnerabilities** | `cd backend && npm audit` |

Tests per file (Node): `limits.test.js` 40, `auth.test.js` 38, `lists.test.js` 32, `config.test.js` 12, `games.test.js` 11, `authUnit.test.js` 10, `igdbLimiter.test.js` 9, `igdbThrottle.test.js` 7, `errorHandling.test.js` 6, `igdbClient.test.js` 6, `library.test.js` 6, `stats.test.js` 6, `igdbQuery.test.js` 4, `abuseLimits.test.js` 3, `proxyChain.test.js` 3. C#: `CsvExportTests.cs` 19.

Coverage dipped slightly (95.6% to 94.8%) when accounts were added because the new code has a few defensive branches (a race on duplicate email, the migration branch for old databases) that tests do not trigger. Say that if asked; do not hide it.

### Size of the codebase (non-blank lines, excludes dependencies, build output, lockfiles)
| Area | Lines |
|---|---|
| Backend source (Node/Express, JavaScript) | 773 |
| Backend scripts | 13 |
| Backend tests | 1369 (about 1.8 lines of test per line of source) |
| Frontend JS/JSX (React) | 967 |
| Frontend CSS | 894 |
| C# export service | 89 (Program.cs 50, CsvExport.cs 39; was 71 lines. It grew because it now has proper CSV quoting and typed models; the database and session code is gone) |
| C# tests | 74 |
| TypeScript report CLI | 99 |
| Docker + compose + nginx config | 107 |
| CI workflow YAML | 112 |

Counts include comments. They are a rough size indicator, not a quality measure.

### Docker (measured 2026-10-08 on Docker Desktop 4.94 / engine 29.8.2, Windows 11, 30 GB RAM host)
| Metric | Value | How to reproduce |
|---|---|---|
| Final image sizes | API **355 MB**, C# export **340 MB** (was 392 MB before the export service stopped using SQLite), web (nginx) **94 MB**; **789 MB** total | `docker images` |
| Size if shipped single-stage (builder stage image) | API 1.68 GB, C# 1.54 GB, web 1.8 GB | `docker build --target deps ./backend`, `--target build ./frontend`, `--target build ./export-service`, then `docker images` |
| Reduction from multi-stage builds | API **78.9%**, C# **73.8%** (1.3 GB builder stage to 340 MB; builder re-measured after the change), web **94.8%** (1 - final/builder) | computed from the rows above; builder sizes from `docker build --target ...` |
| First build | 37 s (a failed earlier attempt had already pulled some base layers, so this is not a true cold start) | `docker compose build` |
| No-cache rebuild, base images already local | **14 s** | `docker compose build --no-cache` |
| Cached rebuild, nothing changed | **4 s** | `docker compose build` |
| Fresh start to all services healthy | **8 s** | `docker compose up -d --wait` |
| Restart (volume kept) to healthy | **7 s** | `docker compose down` then `up -d --wait` |
| Idle memory (single snapshot) | web 16 MiB, C# 25 MiB, API 40 MiB (about **81 MiB** total) | `docker stats --no-stream` |
| API runs as | non-root user `node` (uid 1000) | `docker compose exec api id` |
| Host ports published | **1** (8080, nginx). API and C# service are reachable only inside the compose network | `docker compose ps` |
| End-to-end checks passed through nginx | The full smoke script in `ci.yml` passes against the real stack (2026-10-11): SPA and route fallback, health checks, an empty visitor sees nothing and gets 401 on export, guest creation, Node-writes/C#-reads through the shared volume, user B cannot see user A's list (404) or export rows, guest upgrade keeps the library. Earlier (2026-10-08): real IGDB search with env-supplied credentials | the commands are in the `docker-stack` job of `ci.yml` |
| Login rate limit through nginx | 9 wrong logins return 401, then **429** with `Retry-After` (limit 10 requests per 15 minutes per IP); no proxy warnings in the API log | 13 repeated `POST /api/auth/login` requests |
| Data persists across container restart | yes (row still present after `down` and `up`) | same restart test |

Sizes are Docker's reported disk usage (decimal MB/GB). Single snapshots, not averages: re-run a few times before quoting a precise figure.

### CI on GitHub (first run, 2026-10-11, private repo `Marck-V/BacklogVault`, commit `cf51aea`)
| Metric | Value | How to reproduce |
|---|---|---|
| Result | **All 5 jobs passed on the first run**; the Docker smoke test passed on GitHub's runner too | `gh run list`, or the repo's Actions tab |
| Wall-clock for the whole pipeline | about **88 s** (jobs run in parallel; first start 21:06:45, last finish 21:08:13) | `gh run view <id> --json jobs` |
| Per job | Backend tests 16 s, Frontend lint and build 10 s, TS typecheck 13 s, C# build 22 s, Docker stack **87 s** | same |
| Docker job steps | Build all images 65 s (no layer cache on a fresh runner), start and healthy 7 s, smoke test under 1 s, tear down 11 s | `gh run view <id> --json jobs --jq '.jobs[].steps'` |
| Test run as CI saw it | 7 files passed, 3.98 s | the "Run npm test" step log |
| Second run (after bumping actions and pinning `ubuntu-24.04`, commit `b265060`) | All 5 passed again; about **86 s** wall-clock; Docker 86 s, C# build 21 s, backend tests 18 s, TS typecheck 16 s, frontend 12 s. Node 20 and `ubuntu-latest` warnings no longer appear | `gh run list` |
| Third run (IGDB protection, commit `6a5f4a3`) | All 5 passed; about **80 s** wall-clock; Docker 79 s, C# build 21 s, TS typecheck 17 s, backend tests 13 s, frontend 13 s. Only the 2 old lint annotations | `gh run list` |
| Fourth run (export service as an API client, commit `2453adf`) | All 5 passed; about **72 s** wall-clock; Docker 71 s, C# build plus tests 25 s, TS typecheck 20 s, frontend 19 s, backend tests 15 s. The new C# test step ran on GitHub: **19 passed, 0 failed**. Node tests: 129 passed. Only the 2 old lint annotations | `gh run list` |
| Runs measured | **4**. Wall-clock 88 s, 86 s, 80 s, 72 s: consistent and trending down, but four samples are still not a reliable average, and I have not measured why the Docker job got faster (it could be run-to-run variation) | see section 3 |

### Accounts and security (verified 2026-10-11)
| Property | Result | How it was verified |
|---|---|---|
| Accounts are optional | A visitor can browse, search and add games with no account. The first valid write quietly creates a **guest** session | `auth.test.js`, and by hand in a browser |
| Browsing creates no data | 0 user rows are created by visitors who only read, and 0 by invalid requests | tests that count rows in `users` |
| Guest to account | "Create account" upgrades the guest **in place**, so the library carries over with no migration step; the session is rotated on upgrade | tests, and the browser flow (list kept after sign-up) |
| Password storage | scrypt (N=32768, r=8, p=1), random 16-byte salt per password, constant-time comparison; plaintext never stored | tests inspect the stored hash |
| Sessions | 256-bit random token in an `HttpOnly`, `SameSite=Lax` cookie; the database stores only the token's SHA-256 hash; 30-day sliding expiry; new session on login and register | tests inspect the cookie flags and the table |
| Authorization | Every list, game, stats and export query is scoped to the signed-in user; another user's list returns **404**, exactly like a list that does not exist | 6 isolation tests plus a live check with two users |
| Export service | The C# service no longer opens the database or checks sessions itself. It forwards the session cookie to the API's `GET /api/library`, which does the check; a missing or forged cookie gets **401**, and an API outage gets a clean **502** | live checks with two users, an API-stopped test, and the CI smoke script |
| Login abuse | 10 attempts per 15 minutes per IP, then 429. Unknown emails run the same password-hashing work as wrong passwords (a dummy hash), which is meant to hide which emails exist; I did not measure response times to confirm it | rate-limit unit test, and 13 live requests through nginx |
| Cleanup | Guests unused for 90 days and expired sessions are purged daily; their lists and games cascade-delete | `purgeStale` tests |
| Browser flow | Guest, create list, upgrade to account, sign out (UI returns to the empty visitor state), wrong password shows an error, sign in restores the library | driven in the in-app browser against a throwaway database |
| Layout | Header has no horizontal overflow at 1280 px and 375 px wide | measured in the browser; I could not capture screenshots in this session, so I have not looked at it visually |

### Architecture facts
- **17** REST routes in the Node API (4 of them auth routes, 1 the library route the export uses), **2** in the C# service.
- **3 languages:** JavaScript (API and UI), C# (export service), TypeScript (report CLI).
- **5 CI jobs** run on every push: backend tests, frontend lint and build, TS typecheck, C# build and its 19 tests, Docker stack smoke test. All 5 have passed on GitHub on every run (see the CI table above), including the C# test step (19 tests).
- Verified locally: lint has 0 errors and 2 warnings; `tsc --noEmit` is clean; `dotnet build` has 0 errors.

---

## 2. Work log

| Step | What changed | Why it matters |
|---|---|---|
| Testability refactor | Split `server.js` into `app.js` (builds the Express app) and `server.js` (calls `listen`). Added a `DB_PATH` env var to `db.js`. | Tests import the app without opening a port, and run against an in-memory database instead of your real data. |
| Test suite | Vitest + Supertest, 52 tests, then 58. | Locks in behaviour: validation, duplicate handling, cascade delete, server-side completion date, stats deduplication. |
| Bug fix | IGDB search interpolated raw user text into the query (`search "${q}"`). Added `escapeIgdbString` and input checks (blank or repeated `q` now returns 400). | Prevents users from altering the query sent to IGDB. Covered by 5 tests. |
| Closing a coverage gap | The first measurement showed `igdbClient.js` at 21% because other tests mock it. Added 6 tests that stub `fetch`. | Token caching and refresh now have tests. Line coverage went from 84.7% to 95.6%. |
| CI | `.github/workflows/ci.yml` and a root `.gitignore`. | Every push is checked automatically. Secrets and databases cannot be committed by accident. |
| Config for containers | Frontend API and export URLs are now `VITE_API_BASE` / `VITE_EXPORT_BASE` (defaults unchanged). C# reads `DB_PATH` and `EXPORT_URL`. | The same code runs on localhost and in containers. |
| Dependency security | `npm audit fix` in `backend/`. | Vulnerabilities went from 4 (1 critical) to 0 with no code changes and no test regressions. |
| Docker | Dockerfiles for 3 services, nginx config, `docker-compose.yml`, `.env.example`. | One command starts the whole stack. **Built, run, and checked end to end** (numbers in section 1). |
| First real Docker build | Failed once, fixed, then succeeded. | See bug 6 below. A written-but-never-built config had a bug that only an actual build exposed. |
| Guest-first accounts | New `users` and `sessions` tables and an owner on every list (additive migration, existing data untouched). New auth routes, session middleware, ownership checks on every route. A C# export that validates the session. A sign-in dialog, guest banner and header in React. 48 new auth tests. | Satisfies "no forced accounts, but save your library online if you want". Also closes the gap that anyone could read or delete anyone's data. |
| Safety backup before migrating | Copied the real `backlog.db` (1 list, 4 games) to `backlog.pre-auth.bak` using SQLite's backup API before changing the schema. | Existing data predates users, so it needed protecting. |
| CI smoke test extended | Cookie jars, a no-session check, a two-user isolation check, and a guest-upgrade check. | CI now proves isolation across both the Node and C# services, not just that they start. |

### Bugs and risks found
1. IGDB query injection through the search box. **Fixed and tested.**
2. `?q=a&q=b` produced an array and was stringified into the query. **Fixed and tested.**
3. `npm audit` reported 4 vulnerabilities (1 critical in `proxy-addr`; 3 moderate in `body-parser` and `qs`) in Express's dependency tree. **Fixed with `npm audit fix` (2026-10-08):** 4 packages bumped at patch level (express 4.22.2 to 4.22.3, proxy-addr 2.0.8, qs 6.16.0, body-parser 1.20.8). `npm audit` now reports 0 vulnerabilities and all 58 tests still pass. Re-check with `cd backend && npm audit`.
4. The IGDB client secret was pasted into a chat session. **Rotate it** in the Twitch developer console.
5. The site had no authentication or data ownership, so anyone could read or delete anything. **Addressed on 2026-10-11** with guest-first accounts (see "Accounts and security"). Still open for a public deployment: HTTPS, password reset, and the items in section 3.
6. First `docker compose build` failed: `frontend/.dockerignore` excluded `nginx.conf`, which the Dockerfile copies (`"/nginx.conf": not found`). My own error in the config I wrote before Docker was available. **Fixed**, and the build then passed. Lesson: a `.dockerignore` entry removes the file from the build context entirely.
7. Cosmetic: npm prints a warning that `better-sqlite3`'s install script is not covered by `allowScripts`. The module installed and works (API healthy, database reads and writes), so it is harmless today, but a future npm release could start blocking it.
8. Found while reviewing my own tests: an invalid `POST /api/lists` (empty name) created a guest account before validating, so a bot could fill the `users` table with bad requests. **Fixed** (validate first, then create the guest) and covered by 4 tests.
9. Found while reviewing my own CI script: `! curl ... | grep -q ...` under `set -e` can never fail the step (negated commands are exempt from exit-on-error), so the "user B cannot see user A's data" check was vacuous. **Fixed** with an explicit `if ...; then exit 1; fi` and then run against the real stack.
10. Design risk caught before shipping: the C# export service reads the whole database, so once users existed it would have exported **everyone's** data. It now validates the session cookie and filters by user, and is covered by a live two-user check and the CI smoke test.
11. Latent bug, not fixed: the dashboard's time-to-beat query uses `limit 500`, so with more than 500 distinct active games the totals would undercount silently.
12. GitHub's first CI run passed but raised annotations (not failures): (a) `actions/checkout@v4`, `setup-node@v4` and `setup-dotnet@v4` target the deprecated Node 20 and are being forced onto Node 24, and newer majors exist (checkout v7, setup-node v7, setup-dotnet v6 as of 2026-10-11); (b) the `ubuntu-latest` label starts moving to Ubuntu 26 on **2026-10-19**, which could change the runner image under the workflow. **Fixed (2026-10-11, commit `b265060`):** actions bumped to checkout v7, setup-node v7, setup-dotnet v6, and jobs pinned to `ubuntu-24.04`. The next run passed all 5 jobs and the deprecation warnings disappeared. The only annotations left are the 2 frontend lint warnings.
13. **Fixed (2026-10-11):** the IGDB search and details routes were public and unthrottled. Now a per-IP limit (60 per minute, shared across IGDB-backed routes) rejects bursts with 429, and a site-wide queue keeps calls to IGDB under its reported limit, with 429 retry and backoff. Before: 100 rapid requests caused 100 calls to IGDB in 139 ms. After: 60 accepted, 40 rejected, at most 4 calls in any 1-second window. The 60-per-minute figure is my estimate, not tuned from real traffic. Not done: a session requirement on search (it would not stop a bot, which can create a guest session), and a per-user limit.
14. **Fixed (2026-10-11):** the dashboard stats route used to return a 500 with no data if IGDB failed. It now returns the counts from our own database and marks the hour totals unavailable; the page shows “—” with a note. Verified with tests and in the browser with deliberately invalid IGDB credentials.
15. **Partly addressed (2026-10-11):** an IGDB attribution now appears in the footer. Still open: I could not read IGDB's official terms, so whether the site counts as non-commercial, and what the rules are on caching or storing IGDB data, are unconfirmed. Confirm at api-docs.igdb.com before launch and before building the planned IGDB cache.
16. **My own slip, logged for honesty (2026-10-11):** while checking that `app.js` still loaded, I ran a command that imported it, and importing opens the real `backend/backlog.db`, so the account migration was applied to your real database earlier than planned. It is the same additive migration the server runs on first start. I checked afterwards: all 4 game rows are identical to the pre-migration backup, there are 0 users and 0 sessions, and your one list is still unowned. Lesson: set `DB_PATH` to a throwaway database for any ad-hoc script that touches the app.
17. **Found by measuring before the rewrite (2026-10-11), fixed:** the old export corrupted awkward game names (see the CSV correctness row in the improvement log) and shared a database file between two services, which tied them to one machine. Both fixed by making the C# service an API client with proper CSV quoting. New trade-off: export now depends on the API being up (handled with a 502). I had said the service would get smaller; it actually grew from 71 to 89 lines, because correct CSV handling takes code. What shrank is the risky part (duplicated session logic, database access).
18. **Fixed (2026-10-12):** behind Caddy then nginx, `TRUST_PROXY=1` made the API see every visitor as the proxy (demonstrated: `req.ip` was 172.18.0.5 at 1 hop and 203.0.113.7 at 2), so the per-IP limits were shared by the whole site. The hop count is now `TRUST_PROXY_HOPS`, validated at startup, and verified on the real containers (see the improvement log). **Deploy to-do:** it must equal the real number of proxies. Set it to 2 when Caddy is added in front of nginx; too high would let a visitor forge their address, too low recreates the lockout. Confirm on the first deploy.
19. **Fixed (2026-10-12):** an async Express 4 handler that throws used to kill the process (demonstrated: exit code 1, no response afterwards). `/api/auth/register` and `/api/auth/login` are now wrapped so errors go to a global handler that returns a JSON 500 without internals. Details and tests are in the improvement log.
20. **Fixed (2026-10-12):** no abuse limits on writes (300 list creations, 100 guest accounts and 90,000-character names were all accepted). Now: 50 lists per user, 2,000 games per list, name and notes length limits, a type check on every field, a per-IP write limit of 120 per minute, and a per-IP cap of 10 new guest sessions per hour. These numbers are my estimates and a shared network (a household or school) shares one IP's allowance, so tune them from real use.
21. **Pre-deployment audit, should fix (found 2026-10-12):** no graceful shutdown (no SIGTERM handler, so `docker stop` waits about 10 seconds and then kills the process; the database is never closed explicitly), and the compose file has no `init: true`.
22. **Pre-deployment audit, should fix (found 2026-10-12):** hardening gaps. The API sends `X-Powered-By: Express` and malformed JSON gets an HTML error page (measured: HTTP 400, `text/html`) instead of JSON. nginx has no security headers (Content-Security-Policy, nosniff, frame, referrer) and no gzip or cache headers (confirmed by grep of `nginx.conf`).
23. **Pre-deployment audit, should fix (found 2026-10-12):** production Docker settings. No log rotation (Docker's default logs grow without limit on a small disk), no memory limits, and the base images use floating tags (`node:24`, `nginx:alpine`) so builds can change over time.
24. **Pre-deployment audit, polish (found 2026-10-12):** the browser tab title is still `frontend`, unknown URLs render a blank page (no catch-all route), there is no React error boundary, and `README.md` is 11 lines and out of date (nothing on Docker, accounts, tests, CI or architecture).
25. **Pre-deployment audit, needed before sharing publicly (found 2026-10-12):** no privacy note or terms page, no way to delete an account, no password reset or email verification, and IGDB's terms are unconfirmed. Backups are not set up yet either (a script and a schedule are part of the deploy work).

---

## 3. Not yet measured or verified (do not claim these yet)

| Item | Why it is pending | How to get the real number |
|---|---|---|
| A truly cold Docker build | The 37 s first build had some base layers pulled by an earlier failed attempt | `docker system prune -a` (this deletes all unused images), then `time docker compose build` |
| Repeatable Docker numbers | Sizes and times above are single measurements | Run the build and start commands 3 times and take the median before quoting exact figures |
| Typical CI duration | Only one run so far | After several pushes, take the median of `gh run list --json startedAt,updatedAt`. The Docker build (65 s) could likely be shortened with a build cache, which would be a measurable improvement to record |
| Deployment, uptime, response time | Not deployed | After deploying: the hosting dashboard and `curl -w "%{time_total}"` |
| Password reset and email verification | Not built (needs outbound email). A forgotten password currently means a lost account, and emails are not verified | Build before a public launch; then record the flow and tests |
| HTTPS in production | Local and Docker runs use plain HTTP, so the cookie `Secure` flag is off (`COOKIE_SECURE=false`) | Deploy behind HTTPS, set `COOKIE_SECURE=true` and re-test sign-in |
| Account deletion and data export on request | Not built | Needed for a public site holding personal data |
| Rate limiter is per process | It keeps counts in memory, so with several API instances each would count separately | Move the counter to a shared store (for example Redis) when running multiple instances |
| Your existing local library | Pre-accounts lists have no owner, so they are invisible until claimed. Backed up at `backend/backlog.pre-auth.bak` | Create your account, then run `cd backend && npm run claim-legacy -- you@example.com` |
| CSRF protection | Relies on `SameSite=Lax` cookies, a strict CORS origin allowlist and JSON-only bodies; no CSRF tokens | Get a security review before relying on this publicly |
| Frontend automated tests | The account UI was verified by driving a browser by hand, not by automated UI tests | Add component or end-to-end tests |
| Tuning of the new limits | 10 new guests per hour per IP, 120 writes per minute per IP, 50 lists, 2,000 games and the field lengths are my estimates | Watch for legitimate users hitting 429 or 409 after launch and adjust in `limits.js` and `writeLimiters.js` |
| IGDB limits and tuning | The 4 requests per second and 8 open requests limits come from secondary summaries, not IGDB's own page. The 60 requests per minute per IP and 300 ms spacing are my estimates, not tuned from real traffic | Confirm IGDB's limits in its docs, then review the numbers against real usage after launch (watch for 429s in the logs) |
| IGDB terms confirmed in writing | I could only read secondary summaries, not api-docs.igdb.com. Commercial-use, caching and attribution rules are unverified | Read the official docs, and email or ask IGDB support for confirmation if the site might ever carry ads or payments |
| Mutation check on the tests | I tried to break the escaping and date logic on purpose to confirm the tests fail. The tooling blocked that run, I reverted the edits, and never completed it | Manual: remove `escapeIgdbString(...)` in `app.js`, run `npm test`, expect failures, then put it back |

---

## 4. Resume wording

**Safe to use now (each is backed by a number above):**
- Wrote 58 automated tests (Vitest, Supertest) for a Node/Express REST API, reaching 95.6% line and 89.3% branch coverage. The suite runs offline in under a second because the third-party IGDB API is mocked.
- Refactored the API for testability by separating app construction from server startup and making the database path injectable, so tests run against an in-memory SQLite database.
- Found and fixed a query-injection flaw where user search text was interpolated into a third-party API query, and added regression tests.
- Built a multi-language system: Node/Express API, React frontend, a C# (ASP.NET Core) CSV export service reading the shared SQLite database, and a TypeScript reporting CLI.
- Containerised a 3-service stack (Node API, C# service, React behind nginx) with Docker Compose and multi-stage builds, cutting image sizes by 75-95% versus single-stage builds (API 1.68 GB to 354 MB). Only the nginx port is published, containers run as non-root, and secrets are injected at runtime.
- Verified the stack end to end through the reverse proxy, including two containers in different languages sharing one SQLite database file through a Docker volume, with data surviving restarts.
- Cleared 4 dependency vulnerabilities (1 critical) with `npm audit fix` and confirmed no regressions with the test suite.
- Designed and built guest-first authentication: visitors use the app with no sign-up, a guest session is created lazily on the first write, and "Create account" upgrades it in place so the library carries over. Passwords use scrypt with per-user salts, session tokens are random and stored only as SHA-256 hashes in an HttpOnly SameSite cookie, and logins are rate limited.
- Added per-user data isolation across a Node API and a separate C# service (every query scoped by owner, other users' data returns 404/401), verified with 48 automated auth tests plus a live two-user check and a CI smoke test.
- Set up GitHub Actions CI with 5 parallel jobs (backend tests, frontend lint and build, TypeScript typecheck, C# build, and a Docker Compose smoke test that boots the full stack and verifies user data isolation). The whole pipeline passed on its first run in about 88 seconds.
- Caught and fixed two bugs in my own work during review (a request that created guest accounts before validating, and a CI check that could never fail).

**Only after you have run it and have the number:**
- "Deployed to <host>." Needs a live URL.

---

## 5. How it works (study notes)

### 5.1 Why the tests are built this way
- **App/server split.** Importing `server.js` would start a listener as a side effect. `app.js` only builds and exports the Express app, so Supertest drives it in memory.
- **In-memory database.** `vitest.config.js` sets `DB_PATH=:memory:`. `db.js` is a module singleton, and Vitest gives each test file its own module registry, so each file gets a fresh database. `resetDb()` empties the tables before each test.
- **Two mocking levels.** Route tests mock our own `igdbClient.js` (`vi.mock`), so they test our routing and logic only. `igdbClient.test.js` tests the real client by stubbing the global `fetch`, so the Twitch token logic is verified separately.
- **`vi.resetModules()` in the client tests.** The token cache is a module-level variable. Without a reset, one test's cached token leaks into the next.
- **Fake timers only for `Date`.** This lets the test jump forward 59.5 minutes to prove the token refreshes inside the 60-second safety buffer, without waiting.
- **Behaviour over implementation.** Tests assert on HTTP responses and database effects (status codes, cascade delete, stamped dates), so they survive internal refactors.
- **Remaining uncovered lines (4.4% of lines):** the `/api/health` handler (`app.js:13`), the migration branch that only runs on an old database (`db.js:32`), the re-throw of non-duplicate database errors (`listsRoutes.js:55`), and the `listen()` bootstrap in `server.js`.

### 5.2 CI (`.github/workflows/ci.yml`)
- Jobs run in parallel and each is independent, so a failing C# build does not hide a failing test.
- `npm ci` installs exactly what the lockfile says and fails if it is out of sync. That is why it is used instead of `npm install` in CI.
- `permissions: contents: read` gives the workflow least privilege. `concurrency` cancels outdated runs on the same branch.
- The Docker job builds all images, starts the stack, and sends real requests through nginx. It creates a list and a game through the Node API, then checks the C# CSV endpoint returns them. That proves the two containers share the database file correctly.

### 5.3 Docker design
```
browser -> nginx :8080 (only published port)
              |-- /            static React bundle (SPA fallback to index.html)
              |-- /api/*   ->  api:4000     (Node, writes SQLite)
              '-- /export/* -> export:5000  (C#, asks the API for the user's library, writes CSV)
                                  only the api container mounts the data volume "backlog-data" at /data
```
- **Multi-stage builds.** The Node builder stage is the full image with compilers, because `better-sqlite3` is a native module. The runtime stage is `node:24-slim` and only copies `node_modules`, so the toolchain is not shipped. The C# image builds with the SDK and runs on the much smaller ASP.NET runtime image. The frontend ends as nginx plus static files, with no Node at all.
- **Same-origin through nginx.** The browser only talks to one origin, so no CORS and no hardcoded `localhost` URLs. The frontend is built with empty `VITE_*` values, which makes it use relative URLs. I confirmed the bundle contains zero `localhost` references in that mode.
- **Why no database container.** The app uses SQLite, which is a file. A named volume holds it. Adding Postgres only to fill a compose slot would be a larger migration that has to be defended in an interview.
- **Secrets stay out of images.** The IGDB credentials come from the environment at runtime (root `.env`, git-ignored), never `COPY`ed in. Compose fails fast with a clear message if they are missing.
- **Least privilege.** The API runs as the unprivileged `node` user. `/data` is created and owned by that user in the image, so a fresh named volume inherits it. The export container has no volumes at all (`docker inspect` shows an empty mount list).
- **SQLite and the shared-file problem (resolved).** The database is in WAL mode, which uses extra `-wal` and `-shm` files, so two containers had to share one volume, run as the same uid, and stay on one machine. Making the export service call the API removed that coupling: only the API touches the file, and the export service can run on any host. Use a named volume, not a Windows bind mount, because WAL's shared memory does not work reliably across the Windows/Linux file boundary.
- **Startup order.** The API has a healthcheck, and `export` waits for it with `depends_on: condition: service_healthy`, so the database file exists before the C# service starts.

### 5.4 What actually happened on the first Docker run
I had predicted four risks before Docker was available. Real outcomes:
1. **`better-sqlite3` install on Node 24:** worked. npm printed an `allowScripts` warning, but the module loaded and the database worked.
2. **Permission errors on `/data`:** did not occur. The `chown` in the image plus a fresh volume was enough, and the uid 1000 export container could read the WAL database.
3. **.NET image with uid 1000:** worked with no home-directory problem.
4. **`dotnet/sdk:10.0` and `aspnet:10.0` tags:** both exist and pulled fine.
5. **The thing that did fail was one I did not predict:** `.dockerignore` excluded `nginx.conf` (bug 6). Predictions about environment risks were wrong in the good direction; the real bug was a plain config mistake. That is a useful interview point: write the config, but only a real build proves it.

### 5.5 Questions you should be ready for
- *Why mock IGDB?* Tests must be fast, free, offline, and deterministic. IGDB needs secrets, has rate limits, and its data changes.
- *Does 95% coverage mean it is bug-free?* No. It means 95% of lines ran. I found coverage gaps (the client was 21%) and wrote tests to close them. Assertion quality matters more than the percentage.
- *Why `npm ci` in CI?* Reproducible installs from the lockfile.
- *Why nginx in front?* One origin for the browser, static file serving, and the services stay unexposed.
- *Why SQLite and a shared volume, and what would you change at scale?* Fine for single-user and low traffic. At scale I would move to a client-server database (Postgres) so multiple API instances can write safely, since SQLite allows one writer at a time.

### 5.6 Accounts: how it works and why it was built this way

**The requirement:** nobody is forced to sign up, but people who want their library saved online can.

**The design: lazy guest accounts that upgrade in place.**
```
first visit        GET  /api/lists            -> []  (no session, no user row created)
first valid write  POST /api/lists            -> server creates a guest user + session cookie
later              any request                -> cookie identifies the guest, data is theirs
"Create account"   POST /api/auth/register    -> the SAME user row gets an email + password hash
                                                 (library carries over; session token is replaced)
other device       POST /api/auth/login       -> optionally merges that device's guest lists in
```

**Why guest accounts instead of keeping guest data in the browser (localStorage)?**
- One data model: every request has a user, so every route and every test works the same for guests and members. With browser-only storage there would be two code paths, and dashboard stats would have to be computed from data the server never sees.
- Upgrading is a one-row update, not an import step.
- Cost: the server stores guest data. Mitigations: guests are only created on a valid write, and guests unused for 90 days are purged daily. The trade-off in the other direction (localStorage) would be zero server data for guests but more frontend complexity and no way to use the C# export or server-side stats.

**Sessions, in plain terms**
- The browser holds a random 256-bit token. The server stores only its SHA-256 hash, so a leaked database does not leak usable sessions.
- The cookie is `HttpOnly` (JavaScript, and therefore XSS, cannot read it) and `SameSite=Lax` (not sent on cross-site POSTs, which blocks classic CSRF).
- Why a server-side session table instead of a JWT? It can be revoked instantly (logout deletes the row, the old cookie stops working), and nothing sensitive is stored in the browser. The cost is one database lookup per request.
- Sliding expiry: each hour of activity pushes the 30-day expiry forward, so an active guest is not silently logged out and orphaned. The write is limited to once an hour so ordinary reads do not become writes.
- The token is replaced when a guest registers or when anyone logs in. That prevents session fixation (an attacker planting a known session id before login).

**Passwords:** scrypt is deliberately slow and memory-hungry, which makes offline guessing expensive. Each password gets its own random salt so identical passwords produce different hashes. Comparison uses `timingSafeEqual`. It ships in Node, so there is no native module to compile in Docker. When the email is unknown, login still hashes against a dummy value, so response time does not reveal which emails have accounts. (Registration does say when an email is taken. Hiding that needs email verification, which is not built.)

**Authorization (the part that matters most):** every query that touches lists or games includes the owner. A list you do not own returns 404, the same as a list that does not exist, so the API never confirms that someone else's id exists. This closes IDOR (insecure direct object reference), where a user changes an id in a URL to reach someone else's data. The C# export service no longer touches the database: it forwards the session cookie to the API (`GET /api/library`), so the session check and owner filter exist in exactly one place.

**Things I would say honestly in an interview**
- It is session-cookie auth I built to learn the mechanics. For a production product with sensitive data I would consider a managed identity provider (Auth0, Cognito) or an established library, and I would add email verification and password reset.
- CSRF protection relies on SameSite cookies and a strict CORS allowlist, not tokens.
- The rate limiter lives in memory, so it needs a shared store once there are several API instances.

**Likely questions**
- *Why 404 instead of 403 for someone else's list?* So the API does not reveal which ids exist.
- *Why hash the session token if it is random?* Defence in depth: a database leak should not hand out live sessions.
- *What happens to a guest who clears cookies?* They lose access to that library; it is purged after 90 days. That is exactly why the UI offers "Create account" and warns guests before signing out.
- *How would this scale?* Move SQLite to Postgres (users and sessions tables move as is), keep sessions in the database or Redis, and use a shared rate-limit store.

### 5.7 Protecting a shared third-party API (the IGDB hardening)

**The problem:** the whole site shares one IGDB Client ID, so IGDB's limit (reported as about 4 requests per second and 8 open at once) is shared by every visitor. A public search route with no limits lets one visitor, or a bot, use up that budget for everyone, and could get the credentials suspended.

**Two layers, because they solve different problems**
- **Per-client limit (the door):** `express-rate-limit` allows 60 requests per minute per IP across every route that spends IGDB quota, and answers 429 with `Retry-After`. It protects fairness: no single client can take the whole budget. Behind nginx it needs `TRUST_PROXY=1`, otherwise every visitor looks like the proxy's IP.
- **Site-wide queue (the pipe):** every outbound IGDB call goes through one queue that spaces call starts 300 ms apart and keeps at most 8 open. Even if 1,000 different visitors each stay under their own limit, the total going to IGDB stays under IGDB's. It protects the shared resource.

**Why 300 ms and not exactly 250 ms:** 4 per second is a 250 ms gap, but my first measurement showed 5 calls inside one 1-second window because of timing jitter (the request is recorded a few milliseconds after the slot is granted). Measuring before trusting the design caught it. 300 ms gives margin.

**429 handling:** if IGDB still says "slow down", the client waits for the `Retry-After` header (or 1 s, then 2 s) and retries up to 2 times, with the wait capped at 5 s so a user's request never hangs for minutes.

**Graceful degradation:** the dashboard needs IGDB only for the hour totals. If IGDB fails, the route still returns the counts that come from our own database and flags the totals as unavailable, instead of failing the whole page. The general rule: separate what depends on a third party from what does not, and let the second part survive.

**Likely questions**
- *Why not just cache IGDB results?* It would cut calls a lot, and it is on the roadmap, but IGDB's rules on caching and storing data are unconfirmed, so the rules come first.
- *Why not require login for search?* A bot can create a guest session for free, so it would not stop abuse. Rate limiting does.
- *Is 60 per minute the right number?* It is an estimate. Tune it from real traffic, and watch for 429s.

### 5.8 Removing the shared database between services (the export rewrite)

**Before:** the C# export service opened the same SQLite file as the Node API and re-implemented the session check and the ownership filter. Two codebases had to agree on the database layout and on the security rules. This is a well-known smell, the "shared database" between services.

**After:**
```
browser -> nginx -> C# /export/csv  --(forwards the session cookie)-->  Node GET /api/library -> SQLite
                          |                                                    |
                          '---- builds the CSV from the returned JSON <--------'
```
The API is the only thing that touches the data and the only thing that understands sessions. The C# service depends on the API's **contract** (the shape of the JSON), not on its storage.

**What it bought:** the export service no longer needs a disk, a shared volume, or a matching uid, so it can run on any host. 14 lines of duplicated session logic and the SQLite package are gone. Security rules now live in exactly one place, which is easier to review and test.

**What it cost (say this honestly):** one extra network hop, a new dependency (export fails if the API is down, so it returns a clean 502), and slightly more C# code overall (71 to 89 lines) because I added correct CSV quoting and typed models.

**CSV details worth knowing**
- RFC 4180 quoting: a value with a comma, quote or line break is wrapped in quotes and embedded quotes are doubled. The old code replaced commas with spaces, which silently changed your data, and split a name containing a line break into two records.
- CSV (formula) injection: a value starting with `=`, `+`, `-` or `@` can be run as a formula when the file is opened in a spreadsheet. A leading apostrophe makes it plain text. The trade-off is that the apostrophe shows in the cell.
- The service only forwards a cookie that matches the expected token format, and only to the API address in its configuration, so a crafted cookie cannot inject headers and a user cannot make it call somewhere else.

**Likely questions**
- *Why not just do the export in Node?* It would be about 15 lines. The C# service is there to show a second language and a clean service boundary; the design lesson (depend on contracts, not databases) is what carries over.
- *Why forward the cookie instead of a service-to-service token?* It is simplest and keeps one login system. For a larger system, a dedicated internal credential would limit what the export service can do.
- *What if the API is slow?* The call has a 10 second timeout and returns a 502 instead of hanging.

### 5.9 Pre-deployment hardening: three bugs that only show up in production

**1. The proxy chain.** A rate limiter needs to know who the visitor is. Behind a reverse proxy the connection comes from the proxy, so the visitor's address travels in the `X-Forwarded-For` header, and each proxy appends the address it saw. Express's `trust proxy` setting says how many proxies to believe. With Caddy then nginx in front, the API has to skip two hops to reach the visitor. At 1 hop it stopped at Caddy, so every visitor looked like the same address and one person's failed logins locked everyone out. The opposite mistake is also dangerous: trust too many hops and a visitor can invent their own address in the header and dodge every limit. The number has to match reality, which is why it is a validated setting and not a guess.

**2. Async errors in Express 4.** Express 4 does not catch a rejected promise from an `async` handler, so the rejection goes unhandled and modern Node exits. A one-line wrapper (`asyncHandler`) forwards the error to Express's error handling instead, and one global handler turns every failure into a JSON response that never leaks internals. The tests prove it both ways: a failing handler returns a 500 and the app keeps serving, and the test runner itself fails if an unhandled rejection ever escapes.

**3. Unbounded writes.** Anything that stores user input needs three kinds of bound: how big one value can be (field lengths), how many one account can hold (50 lists, 2,000 games), and how fast one address can create things (per-IP rate limits, with a stricter one for creating new guest accounts). Without them a bot can fill a small server's disk with junk. Validation also checks types, not just presence (an `igdb_id` of `"1"` or a negative number is refused).

**Likely questions**
- *How do you choose limits like 50 lists?* They are estimates sized for a real person, logged as assumptions to tune from real traffic. The point is that a limit exists and is tested, not the exact number.
- *Why not rate limit by user instead of by IP?* Guests are free to create, so a bot would just make new ones. IP is the only identity available before a session exists, and per-user limits (the list and game caps) cover the rest.
- *What is the downside of per-IP limits?* People sharing a network (a household, a school) share one allowance, which is why the numbers need tuning after launch.
