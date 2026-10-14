// Turns the raw IGDB answer for one game into the extra facts the game window shows. IGDB's data is crowd-sourced and
// uneven, so every function accepts missing or odd input and returns an empty result instead of throwing.

// Fields the details query asks IGDB for, kept next to the code that reads them.
export const DETAIL_FIELDS = [
  "name",
  "first_release_date",
  "summary",
  "involved_companies.company.name",
  "involved_companies.developer",
  "age_ratings.organization.name",
  "age_ratings.rating_category.rating",
  "language_supports.language.name",
  "language_supports.language_support_type.name",
  "websites.url",
  "websites.type.type",
  "external_games.uid",
  "external_games.external_game_source",
].join(",");

// IGDB's id for Steam as a source in its external_games table (the same constant the Steam import uses).
export const STEAM_SOURCE_ID = 1;

// Age ratings differ by region. ESRB (North America) and PEGI (Europe) are the two most people know, so they come
// first; if a game has neither, the first rating IGDB lists is shown instead so there is still something to see.
const PREFERRED_ORGANIZATIONS = ["ESRB", "PEGI"];

export function ageRatings(game) {
  const all = (game?.age_ratings ?? [])
    .map((entry) => ({ organization: entry?.organization?.name, rating: entry?.rating_category?.rating }))
    .filter((r) => typeof r.organization === "string" && typeof r.rating === "string" && r.rating !== "");

  const preferred = PREFERRED_ORGANIZATIONS.map((name) => all.find((r) => r.organization === name)).filter(Boolean);
  return preferred.length > 0 ? preferred : all.slice(0, 1);
}

// Languages the game is spoken in (full voice acting), not merely translated: IGDB's "Audio" support type.
export function audioLanguages(game) {
  const names = (game?.language_supports ?? [])
    .filter((entry) => entry?.language_support_type?.name === "Audio")
    .map((entry) => entry?.language?.name)
    .filter((name) => typeof name === "string" && name !== "");
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

// The stores and sites people ask for. Keys are what the website sends back; types are IGDB's website type names.
const STORE_TYPES = [
  { key: "steam", label: "Steam", type: "Steam" },
  { key: "gog", label: "GOG", type: "GOG" },
  { key: "epic", label: "Epic Games Store", type: "Epic" },
  { key: "official", label: "Official site", type: "Official Website" },
];

// Only web addresses are passed on. IGDB is third-party data, and a "javascript:" or "data:" address must never reach a
// link on our page.
function safeWebUrl(value) {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function steamAppId(game) {
  const uid = (game?.external_games ?? []).find((entry) => entry?.external_game_source === STEAM_SOURCE_ID)?.uid;
  return typeof uid === "string" && /^\d{1,10}$/.test(uid) ? uid : null;
}

export function storeLinks(game) {
  const websites = game?.websites ?? [];
  const links = [];
  for (const { key, label, type } of STORE_TYPES) {
    let url = safeWebUrl(websites.find((site) => site?.type?.type === type)?.url);
    // IGDB sometimes knows the Steam app without listing a store page; the store address is predictable from the app id.
    if (!url && key === "steam") {
      const appId = steamAppId(game);
      if (appId) url = `https://store.steampowered.com/app/${appId}`;
    }
    if (url) links.push({ key, label, url });
  }
  return links;
}
