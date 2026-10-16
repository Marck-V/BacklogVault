import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'

const GAMES = [
  { id: 1, igdb_id: 11, name: 'Alpha', status: 'Backlog', hours_played: null, cover_url: null },
  { id: 2, igdb_id: 22, name: 'Bravo', status: 'Backlog', hours_played: null, cover_url: null },
  { id: 3, igdb_id: 33, name: 'Charlie', status: 'Playing', hours_played: null, cover_url: null },
  { id: 4, igdb_id: 44, name: 'Delta', status: 'Backlog', hours_played: null, cover_url: null },
]

let calls
let patchHandler

function mockApi() {
  calls = []
  patchHandler = async (body) => {
    const games = GAMES.filter((g) => body.ids.includes(g.id)).map((g) => ({ ...g, status: body.status }))
    return { status: 200, body: { updated: games.length, games } }
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options = {}) => {
      const path = new URL(url, 'http://localhost').pathname
      const method = options.method ?? 'GET'
      const body = options.body ? JSON.parse(options.body) : undefined
      calls.push({ method, path, body })
      if (method === 'PATCH' && path === '/api/lists/1/games') {
        const { status, body: payload } = await patchHandler(body)
        return { ok: status < 400, status, json: async () => payload }
      }
      const table = {
        '/api/auth/me': { user: null },
        '/api/lists': [],
        '/api/lists/1': { id: 1, name: 'Library', games: GAMES },
        '/api/games/22/details': { developer: 'Studio B' },
      }
      if (table[path] === undefined) return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) }
      return { ok: true, status: 200, json: async () => table[path] }
    })
  )
}

let container: HTMLElement
async function openList(entry = '/lists/1') {
  const view = render(
    <MemoryRouter initialEntries={[entry]}>
      <App />
    </MemoryRouter>
  )
  container = view.container
  await screen.findByRole('heading', { name: 'Library' })
}

const startSelecting = () => fireEvent.click(screen.getByRole('button', { name: 'Select' }))
const box = (name) => screen.getByRole<HTMLInputElement>('checkbox', { name: `Select ${name}` })
const bar = () => screen.getByRole('region', { name: 'Change several games at once' })
const applyButton = (status) => within(within(bar()).getByRole('group')).getByRole<HTMLButtonElement>('button', { name: status })
const patches = () => calls.filter((c) => c.method === 'PATCH')

beforeEach(() => mockApi())

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('select mode', () => {
  it('starts off: no checkboxes, no bar, and clicking a game opens it', async () => {
    await openList()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryByRole('region', { name: 'Change several games at once' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Bravo' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('shows a checkbox on every game and hides the per-game status and Remove buttons', async () => {
    await openList()
    startSelecting()
    expect(screen.getAllByRole('checkbox')).toHaveLength(4)
    expect(container.querySelectorAll('.status-bubble-wrap')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull()
    expect(screen.getByRole('button', { name: 'Done' }).getAttribute('aria-pressed')).toBe('true')
    expect(bar()).toBeTruthy()
  })

  it('keeps every game\'s current status visible, as text you cannot click', async () => {
    await openList()
    startSelecting()
    const pills = [...container.querySelectorAll('.game-card .status-badge.static')]
    expect(pills.map((p) => p.textContent)).toEqual(['Backlog', 'Backlog', 'Playing', 'Backlog'])
    expect(pills.every((p) => p.tagName === 'SPAN')).toBe(true)
    expect(pills[2].className).toContain('status-playing')
  })

  it('shows the status in list view too, and clicking it still picks the row', async () => {
    await openList('/lists/1?view=list')
    startSelecting()
    const pill = container.querySelectorAll('.game-row .status-badge.static')[2]
    expect(pill.textContent).toBe('Playing')
    fireEvent.click(pill)
    expect(box('Charlie').checked).toBe(true)
  })

  it('updates the shown status after a change', async () => {
    await openList()
    startSelecting()
    fireEvent.click(box('Alpha'))
    fireEvent.click(applyButton('Dropped'))
    await waitFor(() => expect(within(bar()).getByText('Moved 1 game to Dropped.')).toBeTruthy())
    expect(container.querySelectorAll('.game-card .status-badge.static')[0].textContent).toBe('Dropped')
  })

  it('picks a game from its checkbox, its card or its title, without opening the details', async () => {
    await openList()
    startSelecting()
    fireEvent.click(box('Alpha'))
    fireEvent.click(container.querySelectorAll('.game-card')[1])
    fireEvent.click(screen.getByRole('button', { name: 'Charlie' }))

    expect(box('Alpha').checked).toBe(true)
    expect(box('Bravo').checked).toBe(true)
    expect(box('Charlie').checked).toBe(true)
    expect(box('Delta').checked).toBe(false)
    expect(within(bar()).getByText('3 games selected')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('unpicks a game when clicked again', async () => {
    await openList()
    startSelecting()
    fireEvent.click(box('Alpha'))
    fireEvent.click(box('Alpha'))
    expect(box('Alpha').checked).toBe(false)
    expect(within(bar()).getByText('0 games selected')).toBeTruthy()
  })

  it('shift-click picks everything between two games, in the order shown', async () => {
    await openList()
    startSelecting()
    fireEvent.click(box('Alpha'))
    fireEvent.click(box('Charlie'), { shiftKey: true })
    expect([box('Alpha'), box('Bravo'), box('Charlie'), box('Delta')].map((b) => b.checked)).toEqual([true, true, true, false])
    expect(within(bar()).getByText('3 games selected')).toBeTruthy()
  })

  it('selects and clears everything that is showing', async () => {
    await openList()
    startSelecting()
    fireEvent.click(within(bar()).getByRole('button', { name: 'Select All (4)' }))
    expect(within(bar()).getByText('4 games selected')).toBeTruthy()
    expect(within(bar()).getByRole<HTMLButtonElement>('button', { name: 'Select All (4)' }).disabled).toBe(true)

    fireEvent.click(within(bar()).getByRole('button', { name: 'Clear' }))
    expect(within(bar()).getByText('0 games selected')).toBeTruthy()
  })

  it('only offers the games in the current tab, and clears the picks when the tab changes', async () => {
    await openList()
    startSelecting()
    fireEvent.click(box('Alpha'))
    fireEvent.click(within(container.querySelector<HTMLElement>('.filter-tabs')!).getByRole('button', { name: 'Playing' }))

    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(within(bar()).getByText('0 games selected')).toBeTruthy()
    expect(within(bar()).getByRole('button', { name: 'Select All (1)' })).toBeTruthy()

    fireEvent.click(within(container.querySelector<HTMLElement>('.filter-tabs')!).getByRole('button', { name: 'All' }))
    expect(box('Alpha').checked).toBe(false)
  })

  it('leaves select mode with Done, forgetting the picks', async () => {
    await openList()
    startSelecting()
    fireEvent.click(box('Alpha'))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryByRole('region', { name: 'Change several games at once' })).toBeNull()

    startSelecting()
    expect(box('Alpha').checked).toBe(false)
  })

  it('works in list view too', async () => {
    await openList('/lists/1?view=list')
    startSelecting()
    fireEvent.click(box('Bravo'))
    expect(container.querySelectorAll('.game-row.selected')).toHaveLength(1)
    expect(within(bar()).getByText('1 game selected')).toBeTruthy()
  })
})

describe('changing the status of the selection', () => {
  it('disables the status buttons until something is picked', async () => {
    await openList()
    startSelecting()
    expect(applyButton('Completed').disabled).toBe(true)
    fireEvent.click(box('Alpha'))
    expect(applyButton('Completed').disabled).toBe(false)
  })

  it('sends one request with every picked id, then updates the page', async () => {
    await openList()
    startSelecting()
    fireEvent.click(box('Alpha'))
    fireEvent.click(box('Bravo'))
    fireEvent.click(applyButton('Completed'))

    await waitFor(() => expect(within(bar()).getByText('Moved 2 games to Completed.')).toBeTruthy())
    expect(patches()).toHaveLength(1)
    expect(patches()[0].body).toEqual({ ids: [1, 2], status: 'Completed' })

    // the page now shows the new statuses without another fetch of the list
    const completed = within(container.querySelector<HTMLElement>('.filter-tabs')!).getByRole('button', { name: 'Completed' })
    fireEvent.click(completed)
    expect(screen.getAllByRole('checkbox').map((b) => b.getAttribute('aria-label')).sort()).toEqual(['Select Alpha', 'Select Bravo'])
    // and the picks were cleared
    expect(within(bar()).getByText('0 games selected')).toBeTruthy()
  })

  it('says "1 game" for a single game', async () => {
    await openList()
    startSelecting()
    fireEvent.click(box('Delta'))
    fireEvent.click(applyButton('Dropped'))
    await waitFor(() => expect(within(bar()).getByText('Moved 1 game to Dropped.')).toBeTruthy())
  })

  it('does not send anything when nothing is picked', async () => {
    await openList()
    startSelecting()
    fireEvent.click(applyButton('Playing'))
    expect(patches()).toHaveLength(0)
  })

  it('blocks a second click while the request is running', async () => {
    let finish
    patchHandler = () => new Promise((resolve) => (finish = resolve))
    await openList()
    startSelecting()
    fireEvent.click(box('Alpha'))
    fireEvent.click(applyButton('Playing'))

    await waitFor(() => expect(applyButton('Playing').disabled).toBe(true))
    fireEvent.click(applyButton('Playing'))
    expect(patches()).toHaveLength(1)

    finish({ status: 200, body: { updated: 1, games: [{ ...GAMES[0], status: 'Playing' }] } })
    await waitFor(() => expect(within(bar()).getByText('Moved 1 game to Playing.')).toBeTruthy())
  })

  it('shows the error and keeps the picks when the server refuses', async () => {
    patchHandler = async () => ({ status: 404, body: { error: 'None of those games are in this list' } })
    await openList()
    startSelecting()
    fireEvent.click(box('Alpha'))
    fireEvent.click(applyButton('Playing'))

    expect((await within(bar()).findByRole('alert')).textContent).toMatch(/None of those games are in this list/)
    expect(box('Alpha').checked).toBe(true)
    expect(applyButton('Playing').disabled).toBe(false)
  })
})
