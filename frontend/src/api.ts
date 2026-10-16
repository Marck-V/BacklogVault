import type {
  AchievementResult,
  BreakdownResponse,
  BulkResult,
  CurrentlyPlaying,
  DeletedCounts,
  GameDetails,
  GameStatus,
  List,
  ListGame,
  ListWithGames,
  LoginResult,
  Me,
  RefreshResult,
  RestoreSummary,
  SearchResult,
  SteamImportResult,
  SteamImportStatus,
  TimeToBeatStats,
} from '../../shared/api.ts'

export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:4000'

// One call to the API. T is the answer's shape, shared with the backend (see shared/api.ts). A 204 has no body.
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...options })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error || `Request failed: ${res.status}`)
  }
  if (res.status === 204) return null as T
  return (await res.json()) as T
}

const sendJson = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export function searchGames(query: string) {
  return request<SearchResult[]>(`/api/games/search?q=${encodeURIComponent(query)}`)
}

export function getLists() {
  return request<List[]>('/api/lists')
}

export function getList(id: number | string) {
  return request<ListWithGames>(`/api/lists/${id}`)
}

export function createList(name: string) {
  return request<List>('/api/lists', sendJson('POST', { name }))
}

export function deleteList(id: number | string) {
  return request<null>(`/api/lists/${id}`, { method: 'DELETE' })
}

export interface NewGame {
  igdb_id: number
  name: string
  cover_url?: string | null
}

export function addGameToList(listId: number | string, game: NewGame) {
  return request<ListGame>(`/api/lists/${listId}/games`, sendJson('POST', game))
}

export function removeGameFromList(listId: number | string, gameId: number) {
  return request<null>(`/api/lists/${listId}/games/${gameId}`, { method: 'DELETE' })
}

export interface GameEntryUpdate {
  status: GameStatus
  rating?: number | null
  hoursPlayed?: number | null
  notes?: string | null
}

export function updateGameEntry(listId: number | string, gameId: number, { status, rating, hoursPlayed, notes }: GameEntryUpdate) {
  return request<ListGame>(`/api/lists/${listId}/games/${gameId}`, sendJson('PUT', { status, rating, hoursPlayed, notes }))
}

export function bulkUpdateStatus(listId: number | string, ids: number[], status: GameStatus) {
  return request<BulkResult>(`/api/lists/${listId}/games`, sendJson('PATCH', { ids, status }))
}

// Hiding keeps the game saved but leaves it out of every dashboard number; showing it again undoes that.
export function setGameHidden(listId: number | string, gameId: number, hidden: boolean) {
  return request<ListGame>(`/api/lists/${listId}/games/${gameId}/hidden`, sendJson('PUT', { hidden }))
}

export function bulkSetHidden(listId: number | string, ids: number[], hidden: boolean) {
  return request<BulkResult>(`/api/lists/${listId}/games`, sendJson('PATCH', { ids, hidden }))
}

export function getGameDetails(igdbId: number) {
  return request<GameDetails>(`/api/games/${igdbId}/details`)
}

// { status: 'ok', total, unlocked } for a connected Steam account; any other status means there is nothing to show.
export function getGameAchievements(igdbId: number) {
  return request<AchievementResult>(`/api/games/${igdbId}/achievements`)
}

export function getTimeToBeatStats() {
  return request<TimeToBeatStats>('/api/stats/time-to-beat')
}

export function setEstimateIncluded(igdbId: number, included: boolean) {
  return request<{ igdb_id: number; included: boolean }>(`/api/stats/time-to-beat/includes/${igdbId}`, sendJson('PUT', { included }))
}

export function getBreakdown() {
  return request<BreakdownResponse>('/api/stats/breakdown')
}

export function refreshFromSteam() {
  return request<RefreshResult>('/api/steam/refresh', { method: 'POST' })
}

export function getCurrentlyPlaying() {
  return request<CurrentlyPlaying>('/api/stats/currently-playing')
}

// The whole library as a backup file (the browser downloads it, using the cookie it already has).
export const BACKUP_URL = `${API_BASE}/api/library/backup`
// The library as a spreadsheet (a CSV file the browser downloads, using the cookie it already has).
export const EXPORT_CSV_URL = `${API_BASE}/api/library/export.csv`

// The parsed contents of a backup file the visitor chose. The server checks every field, so it is passed on as it is.
export function restoreBackup(backup: unknown) {
  return request<RestoreSummary>('/api/library/restore', sendJson('POST', backup))
}

// Deletes everything about the visitor. The server insists the request says so on purpose.
export function deleteMyData() {
  return request<{ deleted: DeletedCounts }>('/api/auth/me', sendJson('DELETE', { deleteEverything: true }))
}

export function getMe() {
  return request<Me>('/api/auth/me')
}

export function registerAccount(email: string, password: string) {
  return request<LoginResult>('/api/auth/register', sendJson('POST', { email, password }))
}

export function loginAccount(email: string, password: string, mergeGuestData: boolean) {
  return request<LoginResult>('/api/auth/login', sendJson('POST', { email, password, mergeGuestData }))
}

export function logoutAccount() {
  return request<null>('/api/auth/logout', { method: 'POST' })
}

// Where the "Connect Steam" button goes: the API sends the visitor on to Steam's own sign-in page.
export const STEAM_CONNECT_URL = `${API_BASE}/api/auth/steam/start`

// Disconnecting also deletes the whole library, and the server insists the request says so on purpose.
export function disconnectSteamAndDeleteLibrary() {
  return request<{ linked: false; deleted: DeletedCounts }>('/api/steam/link', sendJson('DELETE', { deleteLibrary: true }))
}

export function getSteamImportStatus() {
  return request<SteamImportStatus>('/api/import/steam/status')
}

export function importSteamLibrary(listId: number | string) {
  return request<SteamImportResult>('/api/import/steam', sendJson('POST', { listId: Number(listId) }))
}
