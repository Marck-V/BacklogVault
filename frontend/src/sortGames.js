export const SORT_OPTIONS = [
  { value: 'recent', label: 'Recently added' },
  { value: 'alpha', label: 'Alphabetical (A-Z)' },
  { value: 'playtime-desc', label: 'Longest playtime' },
  { value: 'playtime-asc', label: 'Lowest playtime' },
]

// Ignores case and accents, and sorts numbers as numbers, so "Game 2" comes before "Game 10".
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
const byName = (a, b) => collator.compare(a.name, b.name)

// A game with no hours logged counts as 0, so unplayed games are the "lowest playtime".
const hours = (game) => game.hours_played ?? 0

// Returns a new, sorted array. "recent" keeps the order the server sent (newest first), and ties are broken by name
// so the result is the same every time.
export function sortGames(games, sortKey) {
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

export function formatPlaytime(hoursPlayed) {
  if (!hoursPlayed) return 'No playtime'
  return `${hoursPlayed.toLocaleString(undefined, { maximumFractionDigits: 1 })} h`
}
