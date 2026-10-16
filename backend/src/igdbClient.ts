const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const IGDB_BASE_URL = "https://api.igdb.com/v4";

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const params = new URLSearchParams({
    client_id: process.env.IGDB_CLIENT_ID ?? "",
    client_secret: process.env.IGDB_CLIENT_SECRET ?? "",
    grant_type: "client_credentials",
  });

  // The secret goes in the body, not the address: addresses end up in logs and error messages more easily.
  const res = await fetch(TWITCH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Twitch access token: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

// IGDB allows about 4 requests per second and 8 open requests per Client ID, shared by every visitor.
// The 300 ms spacing (about 3.3 per second) leaves headroom for timing jitter so no 1 second window reaches 5.
// All outbound calls go through this queue so the whole site stays under that, however many users there are.
const MAX_CONCURRENT = 8;
const MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 5000;
const minIntervalMs = () => Number(process.env.IGDB_MIN_INTERVAL_MS ?? 300);

let active = 0;
let lastStart = -Infinity;
let pumpTimer: ReturnType<typeof setTimeout> | null = null;
const queue: Array<() => void> = [];

function pump() {
  while (queue.length && active < MAX_CONCURRENT) {
    const wait = lastStart + minIntervalMs() - Date.now();
    if (wait > 0) {
      if (!pumpTimer) {
        pumpTimer = setTimeout(() => {
          pumpTimer = null;
          pump();
        }, wait);
      }
      return;
    }
    lastStart = Date.now();
    active += 1;
    queue.shift()?.();
  }
}

const acquire = () =>
  new Promise<void>((resolve) => {
    queue.push(resolve);
    pump();
  });

function release() {
  active -= 1;
  pump();
}

function retryDelayMs(res: Response, attempt: number): number {
  const seconds = Number(res.headers.get("Retry-After"));
  const requested = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000 * 2 ** attempt;
  return Math.min(requested, MAX_RETRY_DELAY_MS);
}

// IGDB's answer is outside data: T says what the caller expects, and callers still check fields before trusting them.
export async function igdbRequest<T = unknown>(endpoint: string, query: string): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    await acquire();
    let res: Response;
    try {
      const token = await getAccessToken();
      res = await fetch(`${IGDB_BASE_URL}/${endpoint}`, {
        method: "POST",
        headers: {
          "Client-ID": process.env.IGDB_CLIENT_ID ?? "",
          Authorization: `Bearer ${token}`,
          "Content-Type": "text/plain",
        },
        body: query,
      });
    } finally {
      release();
    }

    if (res.status === 429 && attempt < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(res, attempt)));
      continue;
    }
    if (!res.ok) {
      throw new Error(`IGDB request failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as T;
  }
}
