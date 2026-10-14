import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'

const game = (id, name, extra = {}) => ({
  id,
  igdb_id: id * 11,
  name,
  status: 'Backlog',
  hours_played: null,
  cover_url: null,
  hidden: 0,
  ...extra,
})

let games
let calls
let failHide

function mockApi() {
  calls = []
  failHide = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options = {}) => {
      const path = new URL(url, 'http://localhost').pathname
      const method = options.method ?? 'GET'
      const body = options.body ? JSON.parse(options.body) : undefined
      calls.push({ method, path, body })
      const reply = (status, payload) => ({ ok: status < 400, status, json: async () => payload })

      const single = path.match(/^\/api\/lists\/1\/games\/(\d+)\/hidden$/)
      if (method === 'PUT' && single) {
        if (failHide) return reply(500, { error: 'Something went wrong' })
        const target = games.find((g) => g.id === Number(single[1]))
        target.hidden = body.hidden ? 1 : 0
        return reply(200, target)
      }
      if (method === 'PATCH' && path === '/api/lists/1/games') {
        const changed = games.filter((g) => body.ids.includes(g.id))
        for (const g of changed) g.hidden = body.hidden ? 1 : 0
        return reply(200, { updated: changed.length, games: changed })
      }
      const table = {
        '/api/auth/me': { user: null },
        '/api/lists': [],
        '/api/lists/1': { id: 1, name: 'Library', games },
      }
      if (table[path] === undefined) return reply(404, { error: 'Not found' })
      return reply(200, table[path])
    })
  )
}

const confirmHide = (name = /^Hide Games?$/) => fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name }))

async function openList() {
  render(
    <MemoryRouter initialEntries={['/lists/1']}>
      <App />
    </MemoryRouter>
  )
  await screen.findByRole('heading', { name: 'Library' })
}

const hiddenSection = () => document.querySelector('details.hidden-games')

beforeEach(() => {
  games = [game(1, 'Alpha'), game(2, 'Bravo'), game(3, 'Charlie', { hidden: 1, status: 'Completed' })]
  mockApi()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('hidden games', () => {
  it('keeps hidden games out of the main list and puts them in a collapsed section at the bottom', async () => {
    await openList()
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Charlie' })).toBeNull()

    const section = hiddenSection()
    expect(section).not.toBeNull()
    expect(section.open).toBe(false)
    expect(within(section).getByText(/Hidden games \(1\)/)).toBeTruthy()
    expect(section.textContent).toContain('Charlie')

    // It really is the last thing on the page.
    expect(section.parentElement.lastElementChild).toBe(section)
  })

  it('shows no hidden section when nothing is hidden', async () => {
    games = [game(1, 'Alpha')]
    await openList()
    expect(hiddenSection()).toBeNull()
  })

  it('asks first, and cancelling hides nothing', async () => {
    await openList()
    fireEvent.click(screen.getByRole('button', { name: 'Hide Alpha from stats' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toContain('Hide “Alpha”?')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeTruthy()
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0)
  })

  it('hides a game from its card once confirmed and tells the server', async () => {
    await openList()
    fireEvent.click(screen.getByRole('button', { name: 'Hide Alpha from stats' }))
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeTruthy()
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0)
    confirmHide()

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Alpha' })).toBeNull())
    expect(within(hiddenSection()).getByText(/Hidden games \(2\)/)).toBeTruthy()
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'PUT', path: '/api/lists/1/games/1/hidden', body: { hidden: true } })
    )
  })

  it('shows a hidden game again', async () => {
    await openList()
    fireEvent.click(within(hiddenSection()).getByRole('button', { name: /Show/ }))

    expect(await screen.findByRole('button', { name: 'Charlie' })).toBeTruthy()
    expect(hiddenSection()).toBeNull()
    expect(calls).toContainEqual({ method: 'PUT', path: '/api/lists/1/games/3/hidden', body: { hidden: false } })
  })

  it('puts the game back and says so when the server refuses', async () => {
    failHide = true
    await openList()
    fireEvent.click(screen.getByRole('button', { name: 'Hide Alpha from stats' }))
    confirmHide()
    expect(await screen.findByText('Something went wrong')).toBeTruthy()
  })

  it('hides several selected games in one request', async () => {
    await openList()
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alpha' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Bravo' }))
    const bar = screen.getByRole('region', { name: 'Change several games at once' })
    fireEvent.click(within(bar).getByRole('button', { name: 'Hide' }))
    expect(screen.getByRole('alertdialog').textContent).toContain('Hide 2 games?')
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0)
    confirmHide()

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Alpha' })).toBeNull())
    expect(screen.queryByRole('button', { name: 'Bravo' })).toBeNull()
    expect(calls.filter((c) => c.method === 'PATCH')).toEqual([
      { method: 'PATCH', path: '/api/lists/1/games', body: { ids: [1, 2], hidden: true } },
    ])
    expect(within(hiddenSection()).getByText(/Hidden games \(3\)/)).toBeTruthy()
  })

  it('does not count hidden games in the status tabs', async () => {
    await openList()
    fireEvent.click(screen.getByRole('button', { name: 'Completed' }))
    expect(screen.getByText('No games with this status.')).toBeTruthy()
  })
})
