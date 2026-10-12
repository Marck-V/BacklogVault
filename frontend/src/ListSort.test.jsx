import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'

// The order the server sends: newest first.
const GAMES = [
  { id: 1, name: 'Mid Game', status: 'Backlog', hours_played: 5, cover_url: null },
  { id: 2, name: 'alpha Game', status: 'Playing', hours_played: 100, cover_url: null },
  { id: 3, name: 'Zed Game', status: 'Backlog', hours_played: null, cover_url: null },
  { id: 4, name: 'Beta Game', status: 'Playing', hours_played: 0.5, cover_url: null },
]

function mockApi() {
  const table = {
    '/api/auth/me': { user: null },
    '/api/lists': [],
    '/api/lists/1': { id: 1, name: 'Library', games: GAMES },
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const path = new URL(url, 'http://localhost').pathname
      const body = table[path]
      if (body === undefined) return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) }
      return { ok: true, status: 200, json: async () => body }
    })
  )
}

let container
async function openList() {
  const view = render(
    <MemoryRouter initialEntries={['/lists/1']}>
      <App />
    </MemoryRouter>
  )
  container = view.container
  await screen.findByRole('heading', { name: 'Library' })
}

const sortSelect = () => screen.getByRole('combobox', { name: /Sort by/ })
const choose = (value) => fireEvent.change(sortSelect(), { target: { value } })
const gridOrder = () => [...container.querySelectorAll('.game-card h3')].map((el) => el.textContent)
const listOrder = () => [...container.querySelectorAll('.game-row-name')].map((el) => el.textContent)
// The status tabs share their names with each card's status bubble, so look inside the tab bar.
const tab = (name) => within(container.querySelector('.filter-tabs')).getByRole('button', { name })

beforeEach(() => {
  mockApi()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the sort menu', () => {
  it('is a drop-down next to the Grid and List buttons', async () => {
    await openList()
    const toolbar = sortSelect().closest('.list-toolbar')
    expect(toolbar).toBeTruthy()
    expect(within(toolbar).getByRole('button', { name: 'Grid' })).toBeTruthy()
    expect(within(toolbar).getByRole('button', { name: 'List' })).toBeTruthy()
    expect(sortSelect().tagName).toBe('SELECT')
  })

  it('offers the sort choices, starting on the current order', async () => {
    await openList()
    expect([...sortSelect().options].map((o) => o.textContent)).toEqual([
      'Recently added',
      'Alphabetical (A-Z)',
      'Longest playtime',
      'Lowest playtime',
    ])
    expect(sortSelect().value).toBe('recent')
  })
})

describe('sorting the grid', () => {
  it('starts in the order the server sent', async () => {
    await openList()
    expect(gridOrder()).toEqual(['Mid Game', 'alpha Game', 'Zed Game', 'Beta Game'])
  })

  it('sorts alphabetically, ignoring case', async () => {
    await openList()
    choose('alpha')
    expect(gridOrder()).toEqual(['alpha Game', 'Beta Game', 'Mid Game', 'Zed Game'])
  })

  it('sorts by longest playtime, with unplayed games last', async () => {
    await openList()
    choose('playtime-desc')
    expect(gridOrder()).toEqual(['alpha Game', 'Mid Game', 'Beta Game', 'Zed Game'])
  })

  it('sorts by lowest playtime, with unplayed games first', async () => {
    await openList()
    choose('playtime-asc')
    expect(gridOrder()).toEqual(['Zed Game', 'Beta Game', 'Mid Game', 'alpha Game'])
  })

  it('goes back to the original order when you choose Recently added again', async () => {
    await openList()
    choose('alpha')
    choose('recent')
    expect(gridOrder()).toEqual(['Mid Game', 'alpha Game', 'Zed Game', 'Beta Game'])
  })

  it('never drops or repeats a game', async () => {
    await openList()
    for (const value of ['alpha', 'playtime-desc', 'playtime-asc', 'recent']) {
      choose(value)
      expect([...gridOrder()].sort()).toEqual(['Beta Game', 'Mid Game', 'Zed Game', 'alpha Game'])
    }
  })
})

describe('sorting the list view', () => {
  it('sorts the rows the same way', async () => {
    await openList()
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(listOrder()).toEqual(['Mid Game', 'alpha Game', 'Zed Game', 'Beta Game'])

    choose('playtime-desc')
    expect(listOrder()).toEqual(['alpha Game', 'Mid Game', 'Beta Game', 'Zed Game'])
  })

  it('keeps your choice when you switch between Grid and List', async () => {
    await openList()
    choose('alpha')
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(sortSelect().value).toBe('alpha')
    expect(listOrder()).toEqual(['alpha Game', 'Beta Game', 'Mid Game', 'Zed Game'])

    fireEvent.click(screen.getByRole('button', { name: 'Grid' }))
    expect(gridOrder()).toEqual(['alpha Game', 'Beta Game', 'Mid Game', 'Zed Game'])
  })
})

describe('together with the status tabs', () => {
  it('sorts only the games the tab shows', async () => {
    await openList()
    fireEvent.click(tab('Playing'))
    expect(gridOrder()).toEqual(['alpha Game', 'Beta Game']) // server order, filtered

    choose('playtime-asc')
    expect(gridOrder()).toEqual(['Beta Game', 'alpha Game'])
  })

  it('keeps the sort when you change tab', async () => {
    await openList()
    choose('alpha')
    fireEvent.click(tab('Backlog'))
    expect(gridOrder()).toEqual(['Mid Game', 'Zed Game'])
    fireEvent.click(tab('All'))
    expect(gridOrder()).toEqual(['alpha Game', 'Beta Game', 'Mid Game', 'Zed Game'])
  })
})

describe('showing the playtime', () => {
  const playtimes = () => [...container.querySelectorAll('.game-playtime')].map((el) => el.textContent)

  it('stays out of the way for the other sorts', async () => {
    await openList()
    expect(playtimes()).toEqual([])
    choose('alpha')
    expect(playtimes()).toEqual([])
  })

  it('shows each game\'s hours when sorting by playtime, so the order makes sense', async () => {
    await openList()
    choose('playtime-desc')
    expect(playtimes()).toEqual(['100 h', '5 h', '0.5 h', 'No playtime'])
  })

  it('shows them in the list view too', async () => {
    await openList()
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    choose('playtime-asc')
    expect([...container.querySelectorAll('.game-row-playtime')].map((el) => el.textContent)).toEqual([
      'No playtime',
      '0.5 h',
      '5 h',
      '100 h',
    ])
  })
})
