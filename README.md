# BacklogVault

A game backlog tracker. Keep lists of the games you want to play, are playing and have finished, with cover art,
developer and release date, time-to-beat estimates (main story and 100%), ratings, hours and notes. Game data comes
from [IGDB](https://www.igdb.com).

Nobody has to sign up to use it. You start as a guest, and creating an account later keeps your library and lets you
open it anywhere.

> **Status:** runs locally and in Docker Compose. It is not deployed yet. This repository is also a portfolio project:
> [PROJECT_METRICS.md](PROJECT_METRICS.md) records what was built, what was measured, and why, with before and after numbers.

## Features

- **Lists and games:** create lists, search IGDB, add games, filter by status (Backlog, Playing, Completed, Dropped),
  switch between grid and list views.
- **Details per game:** developer, release date, time to beat, rating, hours played and notes.
- **Dashboard:** counts, total time left across your backlog (main story and 100%), games completed, and what you are
  playing now.
- **Guest-first accounts:** guests are created on the first save and upgraded in place when they register, so the
  library carries over. Logging in on another device can merge a guest's lists in.
- **CSV export** of your whole library, produced by a separate C# service.
- **Steam import** (optional, needs a Steam Web API key): paste your Steam profile and your owned games are added to a
  list as Backlog with your hours played. Games are matched to IGDB by Steam app ID, and anything IGDB does not list
  (soundtracks, tools, demos) is reported instead of failing. Re-running it is safe.

## How it fits together

```
Browser --> nginx :8080 --+-- /          static React app
                          |-- /api/*  -> Node/Express API -> SQLite file (Docker volume)
                          |                    |
                          |                    '-> IGDB (via a Twitch OAuth token kept on the server)
                          '-- /export/* -> C# service -> asks the API for your library -> CSV
```

- The **API is the only thing that touches the database and the only thing that understands sessions**. The C# export
  service depends on the API's JSON, not on its storage, so it can run anywhere.
- The browser never sees the IGDB credentials: the API proxies every IGDB request.

| Part | Technology |
|---|---|
| Frontend | React 19, React Router, Vite |
| API | Node.js, Express 4, better-sqlite3 (SQLite) |
| Export service | C# / ASP.NET Core minimal API |
| Reporting CLI | TypeScript (`ts-report/`), prints backlog stats from the local database |
| Packaging | Docker Compose (API, export service, nginx), multi-stage builds |
| Tests | Vitest and Supertest (API), Vitest and Testing Library (frontend), xUnit (C#) |
| CI | GitHub Actions, 5 parallel jobs including a Docker smoke test |

## Run it

You need an IGDB API client: create an application in the [Twitch developer console](https://dev.twitch.tv/console)
to get a client ID and secret. The API fetches and refreshes the access token itself.

### With Docker (everything together)

```bash
cp .env.example .env        # then put your IGDB client ID and secret in .env
docker compose up --build
```

Open http://localhost:8080. Only that port is published; the API and export service are reachable only inside the
Docker network.

### Without Docker (three terminals)

```bash
# API on http://localhost:4000
cd backend && cp .env.example .env     # add your IGDB credentials
npm install && npm run dev

# Frontend on http://localhost:5173
cd frontend && npm install && npm run dev

# Export service on http://localhost:5000 (needs the API running)
cd export-service && dotnet run
```

### Configuration

| Variable | Used by | Default | Purpose |
|---|---|---|---|
| `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET` | API | required | Twitch credentials for IGDB |
| `PORT` | API | `4000` | Port the API listens on |
| `DB_PATH` | API | `backend/backlog.db` | SQLite file location (`:memory:` in tests) |
| `TRUST_PROXY` | API | `0` | Number of reverse proxies in front of the API. Per-IP limits depend on it. Compose sets it from `TRUST_PROXY_HOPS` (1 for nginx, 2 with Caddy in front) |
| `COOKIE_SECURE` | API | `false` | Set `true` when served over HTTPS |
| `CORS_ORIGIN` | API | `http://localhost:5173` | Comma-separated origins allowed to call the API (local development only) |
| `AUTH_RATE_LIMIT_MAX` | API | `10` per 15 min | Login and register attempts per IP |
| `STEAM_API_KEY` | API | empty (feature off) | [Steam Web API key](https://steamcommunity.com/dev/apikey); turns on the Steam import. Keep it on the server only |
| `IMPORT_RATE_LIMIT` | API | `5` per hour | Steam imports per IP |
| `IGDB_ROUTE_RATE_LIMIT` | API | `60` per min | IGDB-backed requests per IP |
| `IGDB_MIN_INTERVAL_MS` | API | `300` | Minimum gap between calls to IGDB, site-wide |
| `WRITE_RATE_LIMIT`, `GUEST_RATE_LIMIT` | API | `120` per min, `10` per hour | Changes per IP, new guest sessions per IP |
| `API_BASE_URL` | Export service | `http://localhost:4000` | Where to fetch a user's library |
| `EXPORT_URL` | Export service | `http://localhost:5000` | Address the service listens on |
| `VITE_API_BASE`, `VITE_EXPORT_BASE` | Frontend build | localhost URLs | Empty in Docker, so the app uses relative URLs behind nginx |

## Tests

```bash
cd backend && npm test                 # API tests; `npm run test:coverage` adds a coverage table
cd frontend && npm test                # pages, routing, error boundary
dotnet test export-service.tests       # CSV formatting
cd ts-report && npm install && npm run report   # prints stats from backend/backlog.db (read-only)
```

IGDB is mocked or stubbed in every test, so the suites run offline without credentials. The GitHub Actions workflow
(`.github/workflows/ci.yml`) runs them on every push, builds all three images, starts the stack and checks that
users cannot see each other's data through both the API and the CSV export.

## Security and reliability notes

- **Accounts:** passwords are hashed with scrypt and a per-user salt. Session tokens are random, stored only as
  hashes, and sent in an `HttpOnly`, `SameSite=Lax` cookie. Every query is scoped to the signed-in user, and someone
  else's list looks exactly like one that does not exist.
- **Abuse limits:** per-IP rate limits (login, IGDB-backed routes, writes, new guest sessions), caps on lists per user
  and games per list, and length and type checks on every field.
- **IGDB protection:** one site-wide queue keeps calls under IGDB's rate limit, retries on 429, and the dashboard
  still shows your own counts if IGDB is down.
- **Errors:** failures in async handlers return a JSON error instead of crashing the process; the API shuts down
  cleanly on SIGTERM.
- **Browser and container hardening:** a strict Content-Security-Policy and other headers from nginx, compression and
  caching, log rotation and memory limits, and base images pinned by digest with Dependabot updates.

## Known limitations

- **Not deployed yet.** There is no public URL.
- **No password reset, email verification or account deletion yet**, so a forgotten password means a lost account.
- **IGDB terms:** IGDB is free for non-commercial use. I could not read its official terms, so what it allows for
  caching and commercial use is unconfirmed. Check [api-docs.igdb.com](https://api-docs.igdb.com/) before launching
  anything beyond a personal project.
- **Steam import is not tied to a Steam sign-in.** Anyone can type in any public profile, but Steam's API terms say
  data should be retrieved as requested by the user it belongs to, and require a privacy policy that says what is
  stored. Verifying ownership with Steam's OpenID sign-in, and writing that policy, are needed before a public launch.
  Only games, names and hours are stored; the profile itself is not.
- **SQLite means one API instance.** Scaling out would mean moving to Postgres.
- **Local data from before accounts existed** has no owner. `cd backend && npm run claim-legacy -- you@example.com`
  assigns it to an account.

## Project layout

```
backend/           Express API, SQLite access, auth, limits, tests (test/)
frontend/          React app, nginx config, tests (src/*.test.jsx)
export-service/    C# CSV export service
export-service.tests/   xUnit tests for the CSV code
ts-report/         TypeScript CLI for local stats
docker-compose.yml API + export service + nginx
.github/           CI workflow and Dependabot config
PROJECT_METRICS.md Measurements, before/after log, design notes
```

Game data and cover art are provided by [IGDB.com](https://www.igdb.com).
