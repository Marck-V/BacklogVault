import type { ListGame } from '../../shared/api.ts'

export type SortKey = 'recent' | 'alpha' | 'playtime-desc' | 'playtime-asc'

export const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'recent', label: 'Recently added' },
  { value: 'alpha', label: 'Alphabetical (A-Z)' },
  { value: 'playtime-desc', label: 'Longest playtime' },
  { value: 'playtime-asc', label: 'Lowest playtime' },
]

// Ignores case and accents, and sorts numbers as numbers, so "Game 2" comes before "Game 10".
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
type Sortable = Pick<ListGame, 'name' | 'hours_played'>

const byName = (a: Sortable, b: Sortable) => collator.compare(a.name, b.name)

// A game with no hours logged counts as 0, so unplayed games are the "lowest playtime".
const hours = (game: Sortable) => game.hours_played ?? 0

// Returns a new, sorted array. "recent" keeps the order the server sent (newest first), and ties are broken by name
// so the result is the same every time.
export function sortGames<T extends Sortable>(games: T[], sortKey: SortKey | string): T[] {
  switch (sortKey) {
    case 'alpha':
      return [...games].sort(byName)
    case 'playtime-desc':
      return [...games].sort((a, b) => hours(b) - hours(a) || byName(a, b))
    case 'playtime-asc':
      return [...games].sort((a, b) => hours(a) - hours(b) || byName(a, b))
    default:
      return games
  }
}

export function formatPlaytime(hoursPlayed: number | null | undefined): string {
  if (!hoursPlayed) return 'No playtime'
  return `${hoursPlayed.toLocaleString(undefined, { maximumFractionDigits: 1 })} h`
}
