# BacklogVault

**A game backlog tracker: keep track of what you want to play, what you are playing and what you have finished, and
see how much time your backlog really adds up to.**

### [Try it live → backlogvault.up.railway.app](https://backlogvault.up.railway.app)

No sign-up needed: open the site and start a list. Your library is saved to your browser's session on the server, and
you can download a backup of it at any time.

---

## What it does

- **Lists for every kind of backlog.** Search the [IGDB](https://www.igdb.com) game database, add games with their cover
  art, and track each one as Backlog, Playing, Completed or Dropped. Add a rating, hours played and notes. Filter by
  status, sort by name or playtime, switch between a grid and a list, select several games to change them at once, and
  hide games you never want counted.
- **A dashboard that does the maths.** Total time left across your backlog (main story and 100%), games completed,
  hours played, and a breakdown of your library by genre, theme and game mode. Endless games with absurd
  crowd-sourced estimates are left out of the totals automatically, and you can choose to count any of them anyway.
- **Everything about a game in one place.** Developer, release date, time to beat, age ratings (ESRB and PEGI),
  languages with full voice acting, and links to its Steam, GOG, Epic and official pages.
- **Steam, if you want it.** Sign in with your Steam account (on Steam's own site) to import your library with your
  hours played, see what you played in the last two weeks, refresh your hours, and see how many achievements you have
  unlocked in each game.
- **Your data stays yours.** Download a backup and restore it on another device, export a spreadsheet, or delete
  everything with one button. A [privacy page](https://backlogvault.up.railway.app/privacy) explains what is stored.

## How it is built

| | |
|---|---|
| **Language** | TypeScript end to end, in strict mode, with the API's response types shared between the backend and the frontend |
| **Frontend** | React 19, React Router, Vite |
| **Backend** | Node.js 24 and Express, running the TypeScript source directly (no build step); SQLite through better-sqlite3 |
| **External APIs** | IGDB (game data, through Twitch OAuth), Steam Web API and Steam OpenID sign-in |
| **Packaging** | One multi-stage Docker image that builds the React app and the API together and runs as an unprivileged user |
| **Hosting** | Railway, deployed from this repository on every push to `main`, with HTTPS and a persistent volume for the database |
| **Tests** | 712 automated tests: Vitest and Supertest for the API (490), Vitest and Testing Library for the website (222) |
| **CI** | GitHub Actions on every push: type checks, linting, both test suites, the production build, and a smoke test that starts the real Docker container and checks that two visitors cannot see each other's data |

```
Browser ──► one container (Node + Express) ──┬── /          the built React app
                                             └── /api/*  ──► the API ──► SQLite (on a volume)
                                                                  ├──► IGDB (credentials stay on the server)
                                                                  └──► Steam (API key stays on the server)
```

The API is the only thing that touches the database and the only thing that understands sessions; the browser never
sees an API key.

### Engineering highlights

- **Shared API types.** `shared/api.ts` describes every answer the API sends. The backend builds its responses against
  it and the website reads them through it, so a change on one side that would break the other fails the type check
  instead of failing in the browser.
- **Guest-first sessions.** A visitor gets a library the moment they first save something, through a random session
  token in an `HttpOnly` cookie; only a hash of the token is stored. Every query is scoped to its owner, and another
  person's list answers exactly like one that does not exist.
- **Protecting shared quotas.** IGDB and Steam limit how much the whole site may call them. A site-wide queue spaces IGDB
  calls under its rate limit and retries politely, Steam calls stop at a daily budget below Steam's cap, and per-visitor
  rate limits stop any one visitor from using it all up.
- **Steam sign-in done properly.** OpenID 2.0 with a one-time code tied to the visitor, an exact return-address check,
  and confirmation from Steam itself before an account is trusted. Steam data is only read for the person who
  connected, and only when they ask, as Steam's API terms require.
- **Security review.** A full audit of the codebase and the live deployment is in [SECURITY_AUDIT.md](SECURITY_AUDIT.md),
  including a rate-limit bypass found on the live site and fixed (the host's proxy passed visitors' own
  `X-Forwarded-For` headers through, so the app now reads the address the proxy itself reports).
- **Measured, not guessed.** [PROJECT_METRICS.md](PROJECT_METRICS.md) is the build log: what changed, what was measured
  before and after, and what was not verified.

## Run it yourself

You need an IGDB client ID and secret: create an application in the
[Twitch developer console](https://dev.twitch.tv/console).

### With Docker

Create a file named `.env` in the repository root:

```bash
IGDB_CLIENT_ID=your-client-id
IGDB_CLIENT_SECRET=your-client-secret
# Optional: a Steam Web API key (https://steamcommunity.com/dev/apikey) turns on Connect Steam
STEAM_API_KEY=
```

Then:

```bash
docker compose up --build
```

and open http://localhost:8080.

### Without Docker

```bash
# The API, on http://localhost:4000 (put the same three variables in backend/.env)
cd backend && npm install && npm run dev

# The website, on http://localhost:5173
cd frontend && npm install && npm run dev
```

### Tests and checks

```bash
cd backend && npm run typecheck && npm test
cd frontend && npm run typecheck && npm run lint && npm test
```

IGDB and Steam are mocked in every test, so the suites run offline with no credentials.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET` | required | Twitch credentials for IGDB |
| `STEAM_API_KEY` | empty (Steam features off) | Steam Web API key. Keep it on the server only |
| `PUBLIC_URL`, `APP_URL` | localhost addresses | Where Steam sends people back after sign-in, and where they land on the website. Set both to the real address when deployed |
| `DATA_COUNTRY`, `CONTACT_EMAIL` | empty | Shown on the privacy page (they are built into the website, so they must be set when it is built) |
| `CLIENT_IP_HEADER` | empty | A header the host's proxy uses for the visitor's real address (Railway: `X-Real-IP`). Every per-visitor rate limit depends on it |
| `TRUST_PROXY` | `0` | Number of proxies in front of the app that append to `X-Forwarded-For`. Ignored when `CLIENT_IP_HEADER` is set |
| `COOKIE_SECURE` | `false` | Set to `true` when the site is served over HTTPS |
| `ENABLE_ACCOUNTS` | `false` | Email and password accounts. Off: the site is guests-only for now, with managed sign-in planned |
| `CORS_ORIGIN` | the Vite address in development, none in production | Other origins allowed to call the API with cookies |
| `DB_PATH`, `PORT` | `backend/backlog.db`, `4000` | Where the SQLite file lives, and the API's port |
| `STEAM_DAILY_CALL_LIMIT` | `90000` | Site-wide cap on Steam Web API calls per day (Steam allows 100,000) |
| `*_RATE_LIMIT` | sensible defaults | Per-visitor limits on searches, changes, new sessions, Steam imports and restores |

### Deploying

The repository deploys to [Railway](https://railway.com) as it is: Railway builds the root `Dockerfile` and runs it as one
container. Attach a volume at `/data` (the database lives there), set the variables above (on Railway:
`CLIENT_IP_HEADER=X-Real-IP` and `COOKIE_SECURE=true`), and use `/api/health` as the health check path. Every push to
`main` then redeploys.

## Project layout

```
backend/            Express API (TypeScript), SQLite access, tests
frontend/           React website (TypeScript), tests
shared/api.ts       The API's response types, used by both sides
ts-report/          A small TypeScript command-line report over the database
Dockerfile          One image for the whole site
docker-compose.yml  Runs that image locally with a data volume
.github/            CI workflow and Dependabot
```

## Status and limits

- **Guests only, for now.** Libraries are tied to a session on the device that made them, and idle libraries are deleted
  after 90 days. Moving between devices works with Download Backup and Restore From Backup. Sign-in through a managed
  provider is the next feature.
- **One instance.** SQLite keeps hosting simple and cheap; running several copies of the API would mean moving to
  Postgres.
- **Third-party data.** Game data comes from IGDB and is free for non-commercial use. Steam features use the Steam Web
  API.

---

Game data and cover art are provided by [IGDB.com](https://www.igdb.com). BacklogVault is not affiliated with or endorsed
by Valve or [Steam](https://store.steampowered.com). Steam and the Steam logo are trademarks of Valve Corporation.
