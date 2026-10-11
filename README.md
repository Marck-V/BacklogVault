# Game Backlog Tracker

## Setup

1. `cd backend && cp .env.example .env` and fill in `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` (from your Twitch Developer app).
2. `cd backend && npm run dev` — starts API on http://localhost:4000
3. `cd frontend && npm run dev` — starts UI on http://localhost:5173

## How IGDB auth works

IGDB sits on Twitch's identity platform. The backend uses your Client ID + Secret to request a short-lived app access token from Twitch (`client_credentials` grant), caches it in memory, and refreshes it automatically when it expires. The token never reaches the frontend.
