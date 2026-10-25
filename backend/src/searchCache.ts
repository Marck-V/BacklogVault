// Remembers IGDB search answers for a few minutes, so the same words searched again (by anyone) do not spend IGDB quota.
// In memory only: a restart empties it and costs nothing but a few repeat searches.
const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 500;

const cache = new Map<string, { at: number; games: unknown }>();

// Same search however it is typed: surrounding spaces, repeated spaces and capital letters make no difference.
const keyOf = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

export function cachedSearch(text: string): unknown | undefined {
  const hit = cache.get(keyOf(text));
  if (!hit) return undefined;
  if (Date.now() - hit.at >= TTL_MS) {
    cache.delete(keyOf(text));
    return undefined;
  }
  return hit.games;
}

export function rememberSearch(text: string, games: unknown): void {
  const key = keyOf(text);
  cache.delete(key);
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), games });
}

export function clearSearchCache(): void {
  cache.clear();
}
