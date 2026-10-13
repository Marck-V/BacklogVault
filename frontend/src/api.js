export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:4000'
export const EXPORT_BASE = import.meta.env.VITE_EXPORT_BASE ?? 'http://localhost:5000'

async function request(path, options) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...options })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Request failed: ${res.status}`)
  }
  if (res.status === 204) return null
  return res.json()
}

export function searchGames(query) {
  return request(`/api/games/search?q=${encodeURIComponent(query)}`)
}

export function getLists() {
  return request('/api/lists')
}

export function getList(id) {
  return request(`/api/lists/${id}`)
}

export function createList(name) {
  return request('/api/lists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export function deleteList(id) {
  return request(`/api/lists/${id}`, { method: 'DELETE' })
}

export function addGameToList(listId, game) {
  return request(`/api/lists/${listId}/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(game),
  })
}

export function removeGameFromList(listId, gameId) {
  return request(`/api/lists/${listId}/games/${gameId}`, { method: 'DELETE' })
}

export function updateGameEntry(listId, gameId, { status, rating, hoursPlayed, notes }) {
  return request(`/api/lists/${listId}/games/${gameId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, rating, hoursPlayed, notes }),
  })
}

export function bulkUpdateStatus(listId, ids, status) {
  return request(`/api/lists/${listId}/games`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, status }),
  })
}

export function getGameDetails(igdbId) {
  return request(`/api/games/${igdbId}/details`)
}

export function getTimeToBeatStats() {
  return request('/api/stats/time-to-beat')
}

export function setEstimateIncluded(igdbId, included) {
  return request(`/api/stats/time-to-beat/includes/${igdbId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ included }),
  })
}

export function getBreakdown() {
  return request('/api/stats/breakdown')
}

export function refreshFromSteam() {
  return request('/api/steam/refresh', { method: 'POST' })
}

export function getCurrentlyPlaying() {
  return request('/api/stats/currently-playing')
}

export function getMe() {
  return request('/api/auth/me')
}

export function registerAccount(email, password) {
  return request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

export function loginAccount(email, password, mergeGuestData) {
  return request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, mergeGuestData }),
  })
}

export function logoutAccount() {
  return request('/api/auth/logout', { method: 'POST' })
}

// Where the "Connect Steam" button goes: the API sends the visitor on to Steam's own sign-in page.
export const STEAM_CONNECT_URL = `${API_BASE}/api/auth/steam/start`

// Disconnecting also deletes the whole library, and the server insists the request says so on purpose.
export function disconnectSteamAndDeleteLibrary() {
  return request('/api/steam/link', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deleteLibrary: true }),
  })
}

export function getSteamImportStatus() {
  return request('/api/import/steam/status')
}

export function importSteamLibrary(listId) {
  return request('/api/import/steam', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listId: Number(listId) }),
  })
}
