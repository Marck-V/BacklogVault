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
| 2026-10-12 | API shutdown | Docker had to **force-kill** the API: stop took **3,673 ms** and the exit code was **137**; there was no SIGTERM handler and the database was never closed explicitly (nginx and the C# service already exited cleanly in under 1 s) | the API finishes in-flight requests, closes the database and exits **0** in **724 ms**, logging `SIGTERM received, shutting down` and `Shutdown complete`; an 8 s watchdog forces an exit if a connection hangs | `docker compose stop api`, then `docker inspect` for the exit code; `shutdown.test.js` (6 unit tests, plus 1 real-process test that runs in CI on Linux) |
| 2026-10-12 | First-visit page weight | HTML + JS + CSS sent uncompressed: **265,862 bytes** (JS 251,288) | gzip on (level 6): **82,374 bytes**, **69.0% smaller** (JS 78,397, CSS 3,519, HTML 458, which is below the 1 KB compression threshold) | `curl --compressed -w '%{size_download}'` through nginx, before and after |
| 2026-10-12 | Repeat visits | no caching headers, only an ETag | hashed build files cached for 1 year (`immutable`); the page itself must be re-checked (`no-cache`) so a new deploy is picked up; a conditional request for the JS returns **304** | `curl -I` and a conditional `curl` |
| 2026-10-12 | Browser security headers | **0 of 5** (Content-Security-Policy, nosniff, frame, referrer, permissions) on pages; the API sent `X-Powered-By: Express`; nginx disclosed its version in the `Server` header | all 5 on pages, `X-Powered-By` removed, nginx version hidden, helmet's headers on the API, nosniff on the export service. Verified in a real browser: the app works, IGDB covers load, and an off-host image and an inline script are both **blocked**, with no violations from the app itself | headers via `curl -I`; browser console and a `securitypolicyviolation` listener; `headers.test.js` (5) |
| 2026-10-12 | Production Docker settings | logs unbounded; no memory limits; floating base-image tags (`node:24`, `nginx:alpine`, ...) | logs capped at 3 files of 10 MB per service; memory ceilings of 384, 256 and 64 MB (idle use measured at 22, 18 and 16 MiB); `no-new-privileges` on all 3; **6 of 6** base images pinned by digest, with Dependabot proposing weekly updates (8 update entries: npm x3, NuGet, Docker x3, GitHub Actions) | `docker inspect` for log options, memory and security options; `docker stats --no-stream`; `.github/dependabot.yml` |
| 2026-10-12 | Unknown URLs | an unknown path such as `/nope` showed only the header and footer, a blank page with no way back (measured in a browser) | a not-found page with a link home, also used when a list does not exist; the header, footer and IGDB attribution stay | real browser on the dev server and through nginx; 4 tests in `App.test.jsx` |
| 2026-10-12 | Page titles and metadata | the tab said `frontend` on every page; no meta description; Vite's default favicon | `BacklogVault` on the home page, `<list name> · BacklogVault` on a list, `Page not found · BacklogVault`; description, theme color and Open Graph tags added; a BacklogVault favicon | browser `document.title` and `<head>`; 3 tests |
| 2026-10-12 | Errors while rendering | no error boundary: an error in any component would blank the whole page | an error boundary shows a message and a reload button inside the app (header kept) and clears itself on navigation | 5 tests, including a list page that really throws while rendering |
| 2026-10-12 | Frontend tests | **0** | **13**, run in CI (the frontend job now runs lint, tests and build) | `cd frontend && npm test` |
| 2026-10-12 | Frontend lint warnings and dead files | **2** warnings (a constant exported from a component file, an effect missing a dependency); **4** unused Vite template files | **0** warnings and **0** unused template files | `cd frontend && npm run lint` |
| 2026-10-12 | Frontend dependency vulnerabilities | **5 high-severity advisories** (react-router, postcss, nanoid, source-map-js), present in the lockfile I had already committed because the frontend had never been re-audited | **0** after `npm audit fix` (only compatible updates; react-router 7.18.4); lint, build and tests still pass | `cd frontend && npm audit` |
| 2026-10-12 | README and setup docs | an 11-line README whose setup step pointed at a `backend/.env.example` that did not exist; a leftover Vite template README in `frontend/` | a full README (features, architecture, run with and without Docker, configuration table, tests, security notes, limitations) and a real `backend/.env.example` | `README.md` |
| 2026-10-12 | CI smoke test reliability | the Docker smoke test depended on a race: with no health check on the web container, `up --wait` returned while nginx was still starting, and it failed once in 7 runs (**1 of 7**) with a connection reset on its first request | the web container has a health check (`up --wait` now waits for it, so `docker compose ps` shows `healthy`) and the smoke script waits up to 30 s for nginx and the export service; **3 of 3** runs passed (1 run plus 2 re-runs of the same commit). A small sample, so I list it as watch-for-recurrence | CI logs; `docker inspect gamebacklogtracker-web-1 --format '{{.State.Health.Status}}'` |
| 2026-10-12 | Getting a Steam library into a list | the only way was to search for each game, click it and pick a list, one game at a time | paste a profile link, a 17-digit ID or a custom name and the whole library is added as Backlog with hours played, in one request; unmatched items are reported, not dropped, and re-running is safe | **99 backend and 14 frontend tests**, and the real error paths checked in a browser against the real Steam API. **First real import (2026-10-12): 239 games added to one list in a single action**, where the alternative was 239 separate search-and-add rounds. Of those, 202 have hours played from Steam and 37 have none (owned but unplayed); all 239 have an IGDB cover; 0 duplicates; 0 errors and 0 mentions of the key in the server log; the API container held 88.7 MiB afterwards (ceiling 384 MiB). Still to record: how many Steam items were owned and unmatched, and the duration (see section 3) |
| 2026-10-12 | Matching Steam games to IGDB correctly | not applicable (new) | every lookup filters on IGDB's Steam source (`external_game_source = 1`). I found this by probing the real IGDB: without the filter, the same ID matched other stores' games (app 730 also matched an unrelated game from another source), and the older `category = 1` filter I would have used from memory returns **nothing** now | live probe of the `external_games` endpoint; a test asserts every query carries the filter |
| 2026-10-12 | Steam API key exposure | not applicable (new) | the key stays on the server: **0** occurrences in the server log, in any API response, or in the browser's network traffic (the browser never calls Steam). the failure modes are tested (Steam HTTP errors, a timeout, and a failed network call whose own error message contains the URL, and therefore the key) | checks in the browser run plus `steamClient.test.js` and `steamImport.test.js` |
| 2026-10-12 | Safety limits on the import | not applicable (new) | 5 imports per hour per IP; library capped at 20,000 apps; the list's 2,000-game cap respected with the most-played games kept first; one database transaction, so an IGDB failure part-way leaves **0** games half-imported; every call to Steam has a 10-second timeout | tests for each limit |
| 2026-10-12 | Finding games in a big library | a list could only be viewed in the order games were added; with a 239-game Steam import there was no way to see the most played, the least played, or an A-Z view | a **Sort by** drop-down beside the Grid/List buttons: Recently added (the old order, still the default), Alphabetical (A-Z), Longest playtime, Lowest playtime; it works with both views and with the status tabs, and while sorting by playtime each game shows its hours. Games with no hours count as 0, so unplayed games are the lowest playtime. Case and accents are ignored and numbers sort as numbers ("Game 2" before "Game 10") | **50 new frontend tests** (35 for the sorting rules, 15 through the page). Real browser with a **2,000-game list (the maximum)**: all 4 options gave the correct order. The sort function takes about **1.7 ms** (alphabetical) and **0.6 ms** (playtime) for 2,000 games (median of 30); updating the page takes about **100 to 300 ms** in a development build, almost all of it React redrawing 2,000 cards |
| 2026-10-12 | Pages wider than a phone screen | at 375 px wide a list page scrolled sideways: the page container measured **410 px in grid view and 428 px in list view**. Separately, with a 102-character title that has no spaces, the Home page's scrollable width reached **1,300 px** because the "Currently Playing" labels could not wrap it | **0 overflow in all 18 combinations I tried**: 6 screen widths (320, 360, 375, 414, 768, 1280 px) times grid view, list view and the home page, using a list that includes unbroken names of 102 and 150 characters; the game-details window and the sign-in dialog also fit at 320 px. Desktop is unchanged (page 1040 px, centred; the sort menu still beside the Grid/List buttons) | real-browser sweep on a dev server with throwaway data; **6 guard tests** that check the CSS rules are still there, and I confirmed they fail when a rule is deleted |
| 2026-10-12 | Dashboard "time remaining" for a big Steam library | a real imported library of 239 games showed **87,143 hours** to beat the main stories and **447,831 hours** to finish everything. The cause was not wrong matching (see bug 32): a few games with absurd crowd-sourced times on IGDB dominated the sum (Content Warning alone 216,228 h) | with games over 200 h main story or 500 h 100% left out: **3,734 h and 8,082 h**, and the dashboard says **25 games were left out and 70 have no estimate**. Also new: a "Total hours played" card (from the hours stored per game, counted once per game across lists) | re-ran the dashboard's exact IGDB query against the real library and compared rules offline; **5 new backend tests + 3 frontend tests**; the real dashboard was not re-checked in a browser after the change. Follow-up: the "left out" note is now a button that opens the list of excluded games with a checkbox each; ticking one counts it in the totals, saved per user in a new `time_estimate_includes` table (also carried over when a guest merges into an account). Only tested with mocks, not clicked through in a real browser |
| 2026-10-12 | Dashboard: genres, Steam recent play, new look | the "Currently Playing" widget only showed games you set to Playing by hand (so empty for an imported library), there was no genre view, and the dashboard was a plain row of boxes | a **genre donut with a legend** (top 7 genres + Other, from IGDB, cached in memory so repeat visits only ask about new games, 500 games per IGDB query); the widget now shows **what you played in the last two weeks on Steam with hours** once you have imported (falls back to hand-set Playing games for everyone else or if Steam is down); a darker slate theme with teal and pink accents and bordered cards, and the old light-page colours (status badges, delete button) fixed for dark | **17 new backend tests and 6 new frontend tests**; genre endpoint run against the real IGDB with 5 games; layout measured in a real browser at 1200 px (5 stat cards in one row, two panels side by side) and 375 px (stacked, no sideways scroll). The Steam recent-play path is only tested with fake Steam answers, not against your real account, and I have not seen the new look rendered (the browser pane cannot take screenshots) |
| 2026-10-12 | Refreshing recent play on demand | the Steam recently played list was cached for 10 minutes with no way to update it sooner | a **Refresh from Steam** button on the dashboard (shown once a Steam account is linked) that re-reads the last two weeks of play right away, shows Updated / an error, and is limited to one refresh per 30 seconds per user; the endpoint is built so more small Steam lookups can be added to it later. Also fixed: a game with no cover showed its title twice (now shows its initial) | **4 new backend tests + 5 new frontend tests** (bypasses the cache, cooldown, needs login and a linked account, reports a Steam failure); not tried against the real Steam API or clicked in a real browser |
| 2026-10-12 | Interface review (Vercel Web Interface Guidelines) | a hand review of the frontend found about 40 issues: deleting a whole list had no confirmation, game cards could not be opened with the keyboard, pop-ups were not announced as dialogs and did not close on Escape or keep focus, no reduced-motion rules, cover images had no size (layout shift) and all loaded at once, filters were lost on refresh | **all fixed except list virtualization**: one shared `Modal` (dialog role, Escape, Tab kept inside, focus restored, page scroll locked) used by all three pop-ups; list delete now asks first; game titles are real buttons; the status menu works with arrow keys and Escape; tab, sort and view are kept in the address; labels, names, `…` and curly quotes, tabular numbers, reduced motion, focus rings, safe-area padding, skip link and a main landmark; covers are lazy with reserved space (measured 4:3 box before load) | **16 new tests** (dialog behaviour, keyboard menu, delete confirmation, address state, landmarks); real-browser check: dialog opens/closes with Escape and focus returns, no sideways scroll at 320 px on list, grid and home views. **Not done:** a 2,000-game list still renders every row (lazy images only), because the CSS shortcut (`content-visibility`) would clip the status menu; **not tested** with a real screen reader or the Tab key in a real browser |
| 2026-10-12 | Dashboard card and cover spacing | the hour cards split the word "hours" across two lines ("ho / urs") and the recently played covers left a gap on the right | the page container is 1,200 px instead of 1,126 px (hour cards 200 px wide instead of 179); each hour value is a big number with a small "hours" beside it that can only drop to its own line as a whole word; the covers sit in a 3-column grid that fills the box edge to edge | real-browser measurement with 5-digit hours ("11,738" and "hours" on one line, inside the card at 900 and 1,200 px), covers at x = 587 / 764 / 940 in a panel ending at 1,101 px, and 3 per row with no sideways scroll at 375 px; the layout guard test now expects 1,200 px |
| 2026-10-12 | Telling the card title from its number | in the top cards the title and the number were both bright and bold, so neither stood out | title on top in small bold capitals (13 px, still near-white, so it stays readable); the number below it at 36 px, weight 800, in the card's own accent colour (teal, blue, purple, green, pink) with a white "hours" beside it; each title reserves two lines so all five numbers start at the same height | real-browser measurement at 1,200 px: all five titles at y = 311 and all five numbers at y = 357, "11,738 hours" on one line, no overflow; frontend tests still pass (113). Not checked at other widths after this change |
| 2026-10-12 | Changing many games' status at once | the only way to change a status was one game at a time (a 239-game Steam library would be 239 menu clicks) | a **Select** button on every list page: tick games (click, or shift-click for a range), **Select All** for what is showing, then one click on Backlog / Playing / Completed / Dropped changes them all in a single request (`PATCH /api/lists/:id/games`); the bar shows the count, announces the result and stays on screen while scrolling; picks clear when the status tab changes | **21 new backend tests** (only status changes, completion date set once and never re-stamped, other people's lists are 404, bad ids and the 2,000-id cap are rejected) and **15 new frontend tests** (click, shift-range, tabs, list view, busy and error states); real browser against a real server: shift-click picked games 2 to 5, one request moved all 4 to Completed, and a fresh read of the list showed 4 Completed with dates, with the bar in view and no sideways scroll at 375 px. Not tested with a screen reader; no bulk delete (only status). Follow-up the same day after feedback: the corner checkbox over the cover looked bad, so it is now hidden (still there for keyboard and screen readers) and a picked game gets a blue ring, blue tint and glow; each game shows its current status as a non-clickable pill while selecting (+3 tests). Measured: the pill is within 2 px of the real status button's height, and cards are shorter in select mode because Remove is hidden |

**Planned measurements for deployment** (record the before and after of each when we get there): time from `git push` to live, response time (median and 95th percentile) from outside the server, uptime over the first weeks, monthly cost, backup restore time, TLS grade, and security headers.

---

## 1. Measured (re-run to confirm)

### Testing (backend)
| Metric | Value | How to reproduce |
|---|---|---|
| Automated tests | **350 Node tests passing + 1 that runs only on Linux and in CI, 19 C# tests and 131 frontend tests; 0 failing** (Node: 21 files) | `cd backend && npm test`, `dotnet test export-service.tests`, `cd frontend && npm test` |
| Tests before this work | **0** | (none existed) |
| Line coverage (Node) | **96.2%** (482/501) | `cd backend && npm run test:coverage` |
| Statement coverage | 95.4% | same |
| Branch coverage | 91.7% | same |
| Function coverage | 95.6% | same |
| Coverage history | 84.7% lines (52 tests) to 95.6% (58 tests, after testing the IGDB client) to 94.8% (106 tests, after adding accounts) to 95.2% (123 tests, after IGDB protection) to 95.3% (129 tests, after the library route) to 95.8% (193 tests, after the pre-deployment fixes) to 95.2% (205 tests, after the hardening items; then 96.2% with 304 tests after the Steam import; the real-process shutdown test is skipped locally on Windows, so `server.js` is not counted as covered) | earlier measurements |
| Suite runtime | about 2.2 s (0.5 s before accounts existed; password hashing is the slowest part) | "Duration" line in `npm test` output |
| External network calls during tests | **0** (IGDB and Twitch are mocked or stubbed) | tests pass offline |
| `npm audit` | **0 vulnerabilities** | `cd backend && npm audit` |

Tests per file (Node): `steamImport.test.js` 51, `steamClient.test.js` 48, `limits.test.js` 40, `auth.test.js` 38, `lists.test.js` 32, `config.test.js` 12, `games.test.js` 11, `authUnit.test.js` 10, `igdbLimiter.test.js` 9, `igdbThrottle.test.js` 7, `shutdown.test.js` 7 (6 unit tests plus 1 real-process test that runs only on Linux and in CI), `errorHandling.test.js` 6, `igdbClient.test.js` 6, `library.test.js` 6, `stats.test.js` 6, `headers.test.js` 5, `igdbQuery.test.js` 4, `abuseLimits.test.js` 3, `proxyChain.test.js` 3. C#: `CsvExportTests.cs` 19.

Coverage dipped slightly (95.6% to 94.8%) when accounts were added because the new code has a few defensive branches (a race on duplicate email, the migration branch for old databases) that tests do not trigger. Say that if asked; do not hide it.

### Size of the codebase (non-blank lines, excludes dependencies, build output, lockfiles)
| Area | Lines |
|---|---|
| Backend source (Node/Express, JavaScript) | 1049 |
| Backend scripts | 13 |
| Backend tests | 2002 (about 1.9 lines of test per line of source) |
| Frontend JS/JSX (React) | 1832, of which 644 are tests (1188 without tests) |
| Frontend CSS | 1012 |
| C# export service | 94 (Program.cs 55, CsvExport.cs 39) |
| C# tests | 74 |
| TypeScript report CLI | 99 |
| Docker + compose + nginx config | 107 |
| CI workflow YAML | 112 |

Counts include comments. They are a rough size indicator, not a quality measure.

### Docker (measured 2026-10-08 on Docker Desktop 4.94 / engine 29.8.2, Windows 11, 30 GB RAM host)
| Metric | Value | How to reproduce |
|---|---|---|
| Final image sizes | API **355 MB**, C# export **340 MB**, web (nginx) **94 MB**; **789 MB** total (unchanged by the hardening work; re-measured 2026-10-12) | `docker images` |
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
| Fifth run (pre-deployment fixes, commit `a6f331f`) | All 5 passed; about **92 s** wall-clock; Docker 91 s, C# build plus tests 20 s, backend tests 19 s, TS typecheck 18 s, frontend 9 s. Node tests: **193 passed**; C# tests: **19 passed**. Only the 2 old lint annotations | `gh run list` |
| Sixth run (hardening, commit `e3775c9`) | All 5 passed; about **79 s** wall-clock; Docker 74 s, backend tests 25 s, C# build plus tests 20 s, TS typecheck 21 s, frontend 10 s. Node tests: **205 of 205 passed**, which includes the Linux-only real-process shutdown test that was skipped on the Windows development machine, so that test is now confirmed on a Linux runner. C# tests: 19 passed. Only the 2 old lint annotations. No Dependabot pull requests yet (it runs on its own weekly schedule) | `gh run list` |
| Seventh run (frontend polish, commit `d6aeab3`) | **Failed.** The Docker smoke test's very first request got `Connection reset by peer` (job took 113 s). The other 4 jobs passed, including the frontend job running its new 13 tests. The container logs showed nginx was still running its startup scripts: the web container had no health check, so `docker compose up --wait` treated "running" as "ready". A real race that had passed six times by luck | `gh run view 38277031711 --log-failed` |
| Eighth run (race fix, commit `e138c70`) | All 5 passed; about **80 s** wall-clock; Docker 80 s. Backend: **205 of 205** tests; frontend: **13 of 13**; C#: 19. No annotations at all, since the 2 old lint warnings are gone. I then re-ran the same commit **twice more** and both passed | `gh run list` |
| Runs measured | **8 distinct runs: 7 passed, 1 failed** (the race above, now fixed), plus 2 passing re-runs of the fix. Wall-clock for the passing runs: 88 s, 86 s, 80 s, 72 s, 92 s, 79 s, 80 s. A spread of about 20 s, almost all in the Docker job. The earlier "trending down" reading was wrong; the variation looks like noise, and I have not measured what drives it | see section 3 |

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
- **19** REST routes in the Node API (4 auth routes, 1 library route for the export, 2 for the Steam import), **2** in the C# service.
- **3 languages:** JavaScript (API and UI), C# (export service), TypeScript (report CLI).
- **5 CI jobs** run on every push: backend tests, frontend lint, tests and build, TS typecheck, C# build and its 19 tests, Docker stack smoke test. All 5 have passed on GitHub on every run (see the CI table above), including the C# test step (19 tests).
- Verified locally: frontend lint has 0 warnings (was 2) and 0 errors; `tsc --noEmit` is clean; `dotnet build` has 0 errors; `npm audit` reports 0 vulnerabilities in the backend, frontend and ts-report, and `dotnet list package --vulnerable` finds none.

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
21. **Fixed (2026-10-12):** the API ignored SIGTERM, so Docker force-killed it after 3,673 ms (exit 137) without closing the database. It now shuts down cleanly in 724 ms with exit 0 (details in the improvement log). I did not add `init: true` to compose, because the process now handles the signal itself.
22. **Fixed (2026-10-12):** the API sent `X-Powered-By: Express` (now removed by helmet, which also adds its standard headers) and nginx had no security headers, no compression and no caching (all added; see the improvement log). Malformed JSON already gets a JSON error from the blocker fixes. **Still to do at deploy time:** HSTS (`Strict-Transport-Security`) belongs on the HTTPS layer, so it goes in the Caddy config.
23. **Fixed (2026-10-12):** log rotation, memory ceilings, `no-new-privileges`, and base images pinned by digest, with Dependabot to propose updates. Watch for container OOM kills after launch (`docker inspect` shows `OOMKilled`), because the ceilings are sized from idle usage.
24. **Fixed (2026-10-12):** the tab title was `frontend`, unknown URLs rendered a blank page, there was no React error boundary, and the README was 11 lines and out of date (with a broken setup step). All fixed; details are in the improvement log. I also removed 4 unused template files and cleared the 2 old lint warnings.
25. **Partly addressed (2026-10-12):** the README is now accurate. Still open before sharing publicly: a privacy note, account deletion, password reset and email verification, backups, and confirming IGDB's terms.
26. **Found while adding frontend tests (2026-10-12), fixed:** `npm audit` in `frontend/` reported 5 high-severity advisories that were already in the committed lockfile, including `react-router`, a runtime dependency. I had audited the backend after earlier work but never re-audited the frontend. Fixed with `npm audit fix`. Lesson: audit every package, and consider an audit step in CI (see the pending list).
27. **Found by a CI failure (2026-10-12), fixed:** the Docker smoke test failed once with `Connection reset by peer` on its first request. Cause: the web container had no health check, so `docker compose up --wait` returned while nginx was still running its startup scripts (the CI container logs showed exactly that). It had passed six times before only because nginx usually wins the race. I could not reproduce it locally (0 failures in 8 attempts on this fast machine), so the diagnosis rests on the CI log and on how `--wait` works. Fixed two ways: a real health check on the web container, and a wait loop in the smoke test (up to 30 s) for nginx and the C# service, which has no health check of its own. The fixed commit passed 3 times in a row (one run plus 2 re-runs). Three passes is encouraging, not proof, so watch for a recurrence.
28. **Found by a test while building the Steam import (2026-10-12), fixed:** the profile-link parser accepted trailing junk, so `.../id/bad name` was read as the profile `bad` and could import the wrong person's library. The profile segment must now end at a path boundary, and the case is covered by a test. A second test of mine was flawed (Node's `AbortSignal.timeout` ignores fake timers); I rewrote it to control the signal.
29. **Open compliance question (2026-10-12):** Steam's Web API terms say data should be retrieved only as requested by the Steam user it belongs to, and that you must post a privacy policy covering what you store. The import currently trusts whatever profile is typed in. Mitigations so far: it only reads libraries a user has made public, the page says to import your own library, and only game names and hours are stored. **Not done:** verifying ownership with Steam's OpenID sign-in, and the privacy policy. Both are needed before a public launch. I could only read secondary summaries of the terms, not the page itself.
30. **Partly known (2026-10-12):** one real library imported 239 games with covers on all of them and no duplicates or errors. Still unknown: what share of the owned Steam items matched (the number of items owned and left unmatched is in the import summary, which I have not seen) and how long the import took. The code paces IGDB at 300 ms per batch of 200, so a library this size needs about two IGDB calls, but the real duration is unmeasured.
31. **Fixed (2026-10-12):** list pages scrolled sideways on phone-width screens (410 px wide in grid view and 428 px in list view at 375 px; it was not caused by the sort menu, the widths were identical with it hidden). **Cause:** the page container has automatic side margins inside a flex column, so it sized itself to the widest unbreakable thing inside it (in list view a row measured 364 px of non-wrapping content) instead of to the screen. **Fix:** the container is now pinned to the screen width (`width: 100%`), text boxes may shrink, the toolbar and list rows wrap on small screens, and `overflow-wrap: anywhere` breaks very long words. A second problem showed up while testing: a title with no spaces overflowed its label on the Home page; the same rule fixes it. **Limit:** the layout was verified by hand in a real browser, and CI only guards that the CSS rules still exist, because jsdom cannot lay out a page.
32. **Fixed, with a judgment call (2026-10-12):** the dashboard showed 87k and 447k hours for a 239-game Steam library. **I checked the import first:** all 239 ids were found on IGDB, there were no duplicates and no missing covers, 221 are plain main games, 6 are expanded editions, and only 6 are bundles, mods or forks (for example Halo: The Master Chief Collection, tModLoader), so Steam games are being matched to the right IGDB entries. **The real cause:** IGDB's time-to-beat numbers are submitted by players, and games with no ending (VRChat 50,005 h, Bloons TD 6 99,999 h, Content Warning 216,228 h) have a few submissions of nonsense that a plain sum adds in. **Fix:** a game over 200 h (main story) or 500 h (100%) is left out of both sums and counted in `games_left_out`; games with no data are counted in `games_without_estimate`. **Limits:** the 200/500 thresholds are my choice, not an IGDB rule, and were picked by looking at one library; a long RPG over 200 h would also be left out, which the note on the dashboard makes visible. The query still asks IGDB for at most 500 rows, so a library of more than 500 games would silently total only part of it (not fixed).
33. **Known limits of the Steam recent-play widget (2026-10-12):** (a) it only turns on after an import, because the Steam account is saved on the user at import time, so a library imported before this change needs one re-import (nothing is duplicated); (b) the Steam account is whatever profile the visitor typed in, with no proof they own it, so someone could point the widget at another person's public profile (it only reads public game data, but the Steam OpenID sign-in check is still on the pending list); (c) results are cached 10 minutes per user in memory, and the genre cache is in memory too, so both reset on restart and are per server instance; (d) Steam returns an empty list both for "nothing played lately" and for a private profile, so the widget cannot tell the user which one it is.

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
| Frontend test depth | 131 frontend tests cover routing, multi-select, dialogs and keyboard use, the Steam refresh button, the genre chart, the recently played panel, the dashboard's hours-played card and left-out note, the not-found page, page titles, the IGDB attribution, the error boundary, the Steam import panel, list sorting and (as a guard on the CSS text only) the rules that keep pages inside the screen width. The sign-in flows, dashboard, status changes and the real page layout were checked by hand in a browser, not by automated tests | Add tests for those flows (Testing Library with a mocked API), and consider a browser-based layout check in CI |
| Content-Security-Policy upkeep | The policy was verified against the current pages only. It is strict (`script-src 'self'`, `style-src 'self'`, images only from this site and `images.igdb.com`), so a future inline script or style, or a new image host, will be blocked | Update `frontend/security-headers.conf` when the app starts using something new, and check the browser console after each frontend change |
| Steam import with a real library: remaining numbers | One real library has been imported (239 games, see the improvement log), but I do not have the count of Steam items owned or left unmatched, nor how long it took, because the server does not record them. The 239 comes from the database, not from the import summary | Read the summary the app showed (owned, matched, unmatched) and add those numbers here. Consider logging counts and duration for each import (with no profile identifier) so future runs can be measured without asking |
| Steam ownership check and privacy policy | See item 29. Right now anyone can type any public profile | Add Steam OpenID sign-in so the user proves the profile is theirs, and write a privacy policy that says what is stored and where |
| Automated layout checks | The overflow fix was verified by sweeping real screen widths in a browser by hand. CI cannot measure layout: the 6 guard tests only check that the CSS rules exist | Add a browser-based test (for example Playwright) that loads a few pages at 320 and 375 px and fails if the page scrolls sideways |
| README screenshots | The README has no screenshots, because screenshots would not render in the tools I had here | Take a few yourself (dashboard, a list, the not-found page) and add them near the top of `README.md` |
| Dependency audit in CI | CI does not run `npm audit`, which is why 5 high-severity frontend advisories sat unnoticed until I audited by hand | Add an audit step (for example `npm audit --audit-level=high`), accepting that new advisories can turn CI red. Dependabot's security updates also help |
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

### 5.10 Production hardening: shutdown, headers, caching and container settings

**Graceful shutdown.** `docker stop` sends SIGTERM and, after a grace period, SIGKILL. A Node process running as the container's main process ignores SIGTERM unless it installs a handler, so the API was always killed (exit 137). Now the handler stops accepting new connections, waits for in-flight requests, closes the database (which also flushes SQLite's write-ahead log), and exits 0. A watchdog forces exit after 8 seconds so one stuck connection cannot hang it. The logic lives in a small function that takes the server, database and `exit` as parameters, which is why it can be unit tested with fakes.

**Security headers, and what each one does**
- `Content-Security-Policy` is a whitelist of where the page may load scripts, styles and images from. It is the main defence against cross-site scripting: even if an attacker injects a script tag, the browser refuses to run it. Ours allows only this site's own files and cover images from `images.igdb.com`.
- `X-Content-Type-Options: nosniff` stops the browser guessing that a file is something else (for example running an uploaded text file as a script).
- `X-Frame-Options: DENY` (and `frame-ancestors 'none'`) stops other sites embedding yours in a hidden frame (clickjacking).
- `Referrer-Policy` limits how much of your URL is sent to other sites when someone clicks away.
- Removing `X-Powered-By` and the nginx version is minor hiding, not real protection, but it removes free information for scanners.
- Strict-Transport-Security (HSTS) tells browsers to use only HTTPS. It is sent by the HTTPS layer, so it goes in the Caddy config at deploy time.

**An nginx gotcha worth knowing.** nginx passes `add_header` down from the server block to a location only if that location sets no `add_header` of its own. The caching location sets one, so the security headers would have silently vanished there. The fix is a shared snippet file that every static location includes. I only found this class of problem because I checked the real response headers on several paths.

**Caching strategy.** Build tools put a content hash in each file name (`index-BTxV8_Pn.js`), so a changed file always has a new name. That means a file with that name can be cached for a year (`immutable`), while `index.html`, which refers to those names, must be re-checked every time (`no-cache`) so a deploy is picked up immediately. A repeat visit then costs one tiny conditional request that returns 304.

**Compression.** nginx's default gzip level is its lowest. Level 6 is the usual balance of CPU and size: 92 KB became 78 KB for the JS bundle. Tiny responses are not compressed because the overhead is not worth it.

**Container settings.** Log rotation stops container logs filling a small disk. A memory ceiling means a runaway process is killed instead of taking the whole server down; it is a ceiling, not a reservation, so idle containers do not use it. `no-new-privileges` stops a compromised process gaining extra rights. Pinning base images by digest makes builds reproducible, and Dependabot proposes updates so the pins do not go stale.

**Likely questions**
- *Why is your CSP so strict, and how do you know it does not break the app?* The built page has no inline scripts or styles, so a strict policy is possible. I loaded the app through nginx in a browser, checked the console for violations, and used deliberate negative controls (an off-site image and an inline script) to prove the policy blocks things.
- *Pinning by digest means you stop getting security patches. How do you handle that?* Dependabot opens weekly pull requests that bump the digest, and CI tests each one before it merges.
- *What would you add next?* HSTS at the HTTPS layer, a Content-Security-Policy report endpoint to learn about violations in production, and dependency scanning in CI.

### 5.11 Frontend polish and why each piece matters

**A not-found route.** React Router only renders a route that matches. With no `path="*"` route, an unknown URL matches nothing, so the page was just the header and footer. A catch-all route gives users a way back, and the same page is reused when the API says a list does not exist (`List not found`), so a deleted list or a stale bookmark does not show a raw error line.

**An error boundary.** React unmounts the whole tree when a component throws while rendering, so one bug would blank the screen. An error boundary is the only way to catch render errors (it has to be a class component because the hooks API has no equivalent). It sits around the routes, so the header and footer survive. A `resetKey` (the URL) lets it recover when the user navigates away, using `getDerivedStateFromProps`, which is the recommended pattern; my first version used `setState` in `componentDidUpdate`, which the linter flagged because it forces a second render. Boundaries do not catch errors in event handlers or async code, so those are still handled where they happen (for example the API errors shown in each page).

**Page titles.** The browser tab, history list and bookmarks use `document.title`. A small `usePageTitle` hook sets it per page. It matters for usability and for how the link looks when shared.

**How the frontend tests work.** Each test renders the real `App` inside a `MemoryRouter` (a router that keeps the URL in memory, so no browser is needed) with `fetch` replaced by a fake API that returns canned JSON. That tests routing, titles and error handling without a server. The error-path test returns a list whose `games` field is `null`, which makes the real list page throw while rendering, so it checks the whole chain: the error happens, the boundary catches it, and the header survives.

**Likely questions**
- *Why a class component in a hooks codebase?* Error boundaries have no hooks equivalent yet.
- *What does an error boundary not catch?* Errors in event handlers, in async code such as a failed `fetch`, and during server rendering.
- *How do you test components that call an API?* Mock `fetch` at the boundary, render with a memory router, and assert on what the user sees.

### 5.12 How the Steam import works, and why it is built this way

**The flow**
```
paste a profile -> parse it -> (custom name? ask Steam for the ID) -> ask Steam for the owned games
   -> ask IGDB which games those Steam app IDs are (in batches of 200) -> one transaction adds the new ones to the list
   -> return a summary: imported, already there, did not fit, could not be matched
```
Everything happens on the server. The browser sends only what you typed and your session cookie, and never talks to Steam.

**Matching Steam to IGDB.** Steam identifies a game by an app ID, IGDB by its own ID. IGDB's `external_games` table links them, and it answers with the game's name and cover in the same query, so one lookup per 200 games does the whole job. Two things I only learned by trying the real API: the same ID appears under other stores, so the lookup must filter on the Steam source (ID 1), and the older `category` field no longer returns anything. Games IGDB does not list (soundtracks, tools, demos, betas) cannot be matched, so they are counted and a sample is shown, not silently dropped.

**Why one request instead of a background job.** A library of a thousand games needs one Steam call and about five IGDB calls, spaced 300 ms apart by the site-wide IGDB queue, so it finishes in seconds. A job queue would be more machinery than the problem needs. If libraries took minutes, that decision would change.

**Choices worth explaining**
- *Everything imports as Backlog.* Steam cannot say whether you finished a game, and guessing would put wrong data in your list. Hours played come from Steam, so you can see which are untouched.
- *Most played first.* The list holds at most 2,000 games. If a library is bigger, the games you actually play are kept.
- *One transaction.* The inserts all happen together at the end, after every IGDB call has succeeded, so a failure part-way leaves the list unchanged.
- *Existing entries are never changed.* If you already track a game, your status, rating and notes survive, which also makes re-running an import safe.
- *Two Steam apps for one game* (a base game and an edition) merge into one entry with the hours added up.

**Keeping the Steam key secret.** Steam requires the key in the URL, and a failed network call can put the whole URL in its error message. So the Steam client never rethrows or logs the original error, the visitor gets a fixed friendly message, and the server logs only the kind of failure and the HTTP status. The key itself never reaches the browser. Tests check this for HTTP errors, a timeout, and a failed call whose message contains the key.

**Input handling.** The profile box accepts a link, a 17-digit ID or a custom name, and only characters Steam allows get through to a URL. A bug I found with a test: a link with trailing junk was being read as a shorter valid name. Only integer app IDs from Steam's own answer are put into the IGDB query, never text from the user or from Steam, so there is nothing to inject.

**What I would say honestly in an interview**
- It is feature-flagged: without a key the panel does not appear and the API answers 503.
- Steam's terms say data should be fetched as requested by the user it belongs to, and require a privacy policy. Proper ownership verification is Steam's OpenID sign-in (you are sent to Steam, which tells us your ID), which I have not built yet. Today it trusts the typed profile, reads only public libraries, and stores only names and hours.
- I tested the error paths against the real Steam API (a missing profile, a library that is not visible) and the success path with fakes. Matching quality on a real library is not measured yet.

**Likely questions**
- *Why not use Steam's OpenID?* It is the right answer for ownership and is the next step; it needs a redirect flow, a callback and a public return address, which is a feature in itself.
- *What happens if IGDB or Steam is down?* Clear messages (502), nothing is changed, and you can retry.
- *How do you stop one person burning the API quota?* 5 imports per hour per IP, a 20,000-app cap, the shared IGDB rate queue, and the usual write limits.
