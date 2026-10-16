import { describe, it, expect } from 'vitest'
import { sortGames, formatPlaytime, SORT_OPTIONS } from './sortGames'

const game = (name: string, hours_played: number | null = null, id: string | number = name) => ({ id, name, hours_played })
const names = (games) => games.map((g) => g.name)

describe('SORT_OPTIONS', () => {
  it('offers recently added (the current order), alphabetical, longest and lowest playtime', () => {
    expect(SORT_OPTIONS.map((o) => o.value)).toEqual(['recent', 'alpha', 'playtime-desc', 'playtime-asc'])
    expect(SORT_OPTIONS.map((o) => o.label)).toEqual([
      'Recently added',
      'Alphabetical (A-Z)',
      'Longest playtime',
      'Lowest playtime',
    ])
  })
})

describe('recently added', () => {
  it('keeps the order the server sent, and returns the same array', () => {
    const games = [game('Zelda', 5), game('Alpha', 1), game('Mid', 3)]
    expect(sortGames(games, 'recent')).toBe(games)
  })

  it('treats an unknown key the same way', () => {
    const games = [game('B', 1), game('A', 2)]
    expect(names(sortGames(games, 'nonsense'))).toEqual(['B', 'A'])
  })
})

describe('alphabetical', () => {
  it('sorts A to Z', () => {
    expect(names(sortGames([game('Hades'), game('Celeste'), game('Tunic')], 'alpha'))).toEqual(['Celeste', 'Hades', 'Tunic'])
  })

  it('ignores case, so lower-case names are not pushed to the end', () => {
    expect(names(sortGames([game('banana'), game('Apple'), game('cherry'), game('Blueberry')], 'alpha'))).toEqual([
      'Apple',
      'banana',
      'Blueberry',
      'cherry',
    ])
  })

  it('sorts numbers as numbers, so "Game 2" comes before "Game 10"', () => {
    expect(names(sortGames([game('Game 10'), game('Game 2'), game('Game 1')], 'alpha'))).toEqual(['Game 1', 'Game 2', 'Game 10'])
  })

  it('treats accented letters like their plain versions', () => {
    expect(names(sortGames([game('Zebra'), game('Éclair'), game('Apple')], 'alpha'))).toEqual(['Apple', 'Éclair', 'Zebra'])
  })

  it('does not depend on playtime', () => {
    expect(names(sortGames([game('B', 100), game('A', null), game('C', 5)], 'alpha'))).toEqual(['A', 'B', 'C'])
  })
})

describe('longest playtime', () => {
  it('puts the most played first', () => {
    expect(names(sortGames([game('A', 5), game('B', 500), game('C', 50)], 'playtime-desc'))).toEqual(['B', 'C', 'A'])
  })

  it('sorts decimals correctly', () => {
    expect(names(sortGames([game('A', 1.5), game('B', 12.25), game('C', 1.25)], 'playtime-desc'))).toEqual(['B', 'A', 'C'])
  })

  it('puts games with no hours last', () => {
    expect(names(sortGames([game('A', null), game('B', 2), game('C', undefined)], 'playtime-desc'))).toEqual(['B', 'A', 'C'])
  })

  it('breaks ties alphabetically', () => {
    expect(names(sortGames([game('Zed', 10), game('Alpha', 10), game('Mid', 10)], 'playtime-desc'))).toEqual(['Alpha', 'Mid', 'Zed'])
  })
})

describe('lowest playtime', () => {
  it('puts the least played first', () => {
    expect(names(sortGames([game('A', 5), game('B', 500), game('C', 50)], 'playtime-asc'))).toEqual(['A', 'C', 'B'])
  })

  it('counts a game with no hours as zero, so unplayed games come first', () => {
    expect(names(sortGames([game('A', 0.5), game('B', null), game('C', 3)], 'playtime-asc'))).toEqual(['B', 'A', 'C'])
  })

  it('treats a missing value and an explicit zero as the same, and orders them by name', () => {
    expect(names(sortGames([game('Zed', 0), game('Alpha', null), game('Mid', undefined)], 'playtime-asc'))).toEqual(['Alpha', 'Mid', 'Zed'])
  })

  it('is the exact reverse of longest playtime when no two games tie', () => {
    const games = [game('A', 5), game('B', 500), game('C', 50), game('D', null)]
    expect(names(sortGames(games, 'playtime-asc'))).toEqual(names(sortGames(games, 'playtime-desc')).reverse())
  })
})

describe('every sort', () => {
  it.each(['alpha', 'playtime-desc', 'playtime-asc'])('%s does not change the array it is given', (key) => {
    const games = [game('C', 3), game('A', 1), game('B', 2)]
    const snapshot = JSON.stringify(games)
    sortGames(games, key)
    expect(JSON.stringify(games)).toBe(snapshot)
  })

  it.each(['recent', 'alpha', 'playtime-desc', 'playtime-asc'])('%s handles an empty list', (key) => {
    expect(sortGames([], key)).toEqual([])
  })

  it.each(['alpha', 'playtime-desc', 'playtime-asc'])('%s keeps every game exactly once', (key) => {
    const games = [game('C', 3, 1), game('A', 1, 2), game('B', 2, 3), game('A', 1, 4)]
    expect(sortGames(games, key).map((g) => g.id).sort()).toEqual([1, 2, 3, 4])
  })

  it('sorts the largest allowed list (2,000 games) in well under a second', () => {
    const games = Array.from({ length: 2000 }, (_, i) => game(`Game ${(i * 7919) % 2000}`, (i * 31) % 500, i))
    for (const key of ['alpha', 'playtime-desc', 'playtime-asc']) {
      const start = performance.now()
      sortGames(games, key)
      expect(performance.now() - start).toBeLessThan(500)
    }
  })
})

describe('formatPlaytime', () => {
  it.each([
    [null, 'No playtime'],
    [undefined, 'No playtime'],
    [0, 'No playtime'],
    [1, '1 h'],
    [12.5, '12.5 h'],
    [0.1, '0.1 h'],
    [12.25, '12.3 h'],
    [2891.7, '2,891.7 h'],
  ])('shows %j as %j', (value, expected) => {
    expect(formatPlaytime(value)).toBe(expected)
  })
})
