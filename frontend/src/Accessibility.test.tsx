import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { useState } from 'react'
import App from './App'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'
import StatusBubble from './StatusBubble'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.body.style.overflow = ''
})

function mockFetch(table, calls: string[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options = {}) => {
      const path = new URL(url, 'http://localhost').pathname
      calls.push(`${options.method ?? 'GET'} ${path}`)
      const body = table[`${options.method ?? 'GET'} ${path}`] ?? table[path]
      if (body === undefined) return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) }
      return { ok: true, status: 200, json: async () => body }
    })
  )
  return calls
}

describe('Modal', () => {
  function Harness() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open it
        </button>
        {open && (
          <Modal onClose={() => setOpen(false)} label="Example dialog">
            <button type="button">First</button>
            <button type="button">Last</button>
          </Modal>
        )}
      </>
    )
  }

  it('is announced as a modal dialog and takes focus', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open it' }))
    const dialog = screen.getByRole('dialog', { name: 'Example dialog' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(dialog)
  })

  it('closes on Escape and returns focus to what opened it', () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open it' })
    opener.focus()
    fireEvent.click(opener)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('closes when the dimmed area is clicked, but not when the dialog itself is', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open it' }))
    fireEvent.mouseDown(screen.getByRole('button', { name: 'First' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.mouseDown(document.querySelector<HTMLElement>('.modal-overlay')!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps Tab inside the dialog, wrapping at both ends', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open it' }))
    const first = screen.getByRole('button', { name: 'First' })
    const last = screen.getByRole('button', { name: 'Last' })

    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('stops the page behind it from scrolling, and lets it scroll again afterwards', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open it' }))
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.body.style.overflow).toBe('')
  })
})

describe('ConfirmDialog', () => {
  it('uses the labels it is given and puts the safe choice first', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    render(<ConfirmDialog message="Delete it?" confirmLabel="Delete List" cancelLabel="Keep" onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete List' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep' }))
  })

  it('cancels on Escape and confirms only through its own button', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmDialog message="Sure?" onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

describe('StatusBubble', () => {
  it('opens as a menu you can drive from the keyboard', () => {
    const onChange = vi.fn()
    render(<StatusBubble status="Backlog" onChange={onChange} />)
    const trigger = screen.getByRole('button', { name: 'Backlog' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const items = screen.getAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual(['Playing', 'Completed', 'Dropped'])
    expect(document.activeElement).toBe(items[0])

    fireEvent.keyDown(items[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[0])

    fireEvent.keyDown(items[0], { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('reports the chosen status and closes', () => {
    const onChange = vi.fn()
    render(<StatusBubble status="Backlog" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Backlog' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Completed' }))
    expect(onChange).toHaveBeenCalledWith('Completed')
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('deleting a list', () => {
  it('asks first, and only deletes after the confirmation', async () => {
    const calls = mockFetch({
      '/api/auth/me': { user: null },
      '/api/lists': [{ id: 7, name: 'Weekend Shelf' }],
      '/api/stats/time-to-beat': { game_count: 0, completed_count: 0 },
      '/api/stats/currently-playing': { source: 'manual', steam_linked: false, games: [] },
      '/api/stats/breakdown': { game_count: 0, genres: { items: [], without: 0 }, themes: { items: [], without: 0 }, modes: { items: [], without: 0 } },
      'DELETE /api/lists/7': {},
    })
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Weekend Shelf' }))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/Delete “Weekend Shelf” and every game in it/)).toBeTruthy()
    expect(calls).not.toContain('DELETE /api/lists/7')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(calls).not.toContain('DELETE /api/lists/7')

    fireEvent.click(screen.getByRole('button', { name: 'Delete Weekend Shelf' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete List' }))
    await waitFor(() => expect(calls).toContain('DELETE /api/lists/7'))
  })
})

describe('the list page', () => {
  const GAMES = [
    { id: 1, igdb_id: 11, name: 'Alpha', status: 'Backlog', hours_played: 5, cover_url: null },
    { id: 2, igdb_id: 22, name: 'Bravo', status: 'Playing', hours_played: 50, cover_url: null },
    { id: 3, igdb_id: 33, name: 'Charlie', status: 'Playing', hours_played: 1, cover_url: null },
  ]
  const table = {
    '/api/auth/me': { user: null },
    '/api/lists': [],
    '/api/lists/1': { id: 1, name: 'Library', games: GAMES },
    '/api/games/22/details': { developer: 'Studio B' },
  }

  function Where() {
    const { search } = useLocation()
    return <output data-testid="where">{search}</output>
  }

  function renderList(entry) {
    mockFetch(table)
    return render(
      <MemoryRouter initialEntries={[entry]}>
        <App />
        <Where />
      </MemoryRouter>
    )
  }

  const names = (container) => [...container.querySelectorAll('.game-card h3')].map((el) => el.textContent)

  it('restores the tab, sort and view from the address', async () => {
    const { container } = renderList('/lists/1?status=Playing&sort=playtime-desc&view=list')
    await screen.findByRole('heading', { name: 'Library' })
    expect([...container.querySelectorAll('.game-row-name')].map((el) => el.textContent)).toEqual(['Bravo', 'Charlie'])
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: /Sort by/ }).value).toBe('playtime-desc')
  })

  it('ignores junk in the address instead of breaking', async () => {
    const { container } = renderList('/lists/1?status=Nope&sort=%00&view=wide')
    await screen.findByRole('heading', { name: 'Library' })
    expect(names(container)).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })

  it('writes what you pick into the address, and leaves defaults out', async () => {
    renderList('/lists/1')
    await screen.findByRole('heading', { name: 'Library' })
    expect(screen.getByTestId('where').textContent).toBe('')

    fireEvent.click(within(document.querySelector<HTMLElement>('.filter-tabs')!).getByRole('button', { name: 'Playing' }))
    expect(screen.getByTestId('where').textContent).toBe('?status=Playing')

    fireEvent.change(screen.getByRole('combobox', { name: /Sort by/ }), { target: { value: 'alpha' } })
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(new URLSearchParams(screen.getByTestId('where').textContent).get('view')).toBe('list')

    fireEvent.click(within(document.querySelector<HTMLElement>('.filter-tabs')!).getByRole('button', { name: 'All' }))
    expect(new URLSearchParams(screen.getByTestId('where').textContent).has('status')).toBe(false)
  })

  it('opens a game from its title button, so the keyboard can reach it', async () => {
    renderList('/lists/1')
    await screen.findByRole('heading', { name: 'Library' })
    fireEvent.click(screen.getByRole('button', { name: 'Bravo' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Bravo' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy()
    await within(dialog).findByText('Studio B')
  })

  it('removes a game with a trash-can button that is named after the game and asks first', async () => {
    renderList('/lists/1')
    await screen.findByRole('heading', { name: 'Library' })
    const trash = screen.getByRole('button', { name: 'Remove Bravo from this list' })
    expect(trash.querySelector<HTMLElement>('svg')!.getAttribute('aria-hidden')).toBe('true')
    expect(trash.textContent).toBe('')

    fireEvent.click(trash)
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull() // the click must not also open the game's details
  })

  it('gives the search box a name and the right type', async () => {
    renderList('/lists/1')
    await screen.findByRole('heading', { name: 'Library' })
    const search = screen.getByRole('searchbox', { name: 'Search for a game' })
    expect(search.getAttribute('autocomplete')).toBe('off')
  })
})

describe('page structure', () => {
  it('has a skip link to the main landmark and a top-level heading on the home page', async () => {
    mockFetch({
      '/api/auth/me': { user: null },
      '/api/lists': [],
      '/api/stats/time-to-beat': { game_count: 0, completed_count: 0 },
      '/api/stats/currently-playing': { source: 'manual', steam_linked: false, games: [] },
      '/api/stats/breakdown': { game_count: 0, genres: { items: [], without: 0 }, themes: { items: [], without: 0 }, modes: { items: [], without: 0 } },
    })
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    )
    const skip = await screen.findByRole('link', { name: 'Skip to main content' })
    expect(skip.getAttribute('href')).toBe('#main')
    expect(screen.getByRole('main').id).toBe('main')
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
  })
})
