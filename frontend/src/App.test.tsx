import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import ErrorBoundary from './ErrorBoundary'

const EMPTY_STATS = { game_count: 0, completed_count: 0, total_main_story_seconds: 0, total_completionist_seconds: 0 }

// Stands in for the API: maps a path to a response body (and optionally a status).
function mockApi(routes = {}) {
  const defaults = {
    '/api/auth/me': { user: null },
    '/api/lists': [],
    '/api/stats/time-to-beat': EMPTY_STATS,
    '/api/stats/currently-playing': { source: 'manual', games: [] },
    '/api/stats/breakdown': { game_count: 0, genres: { items: [], without: 0 }, themes: { items: [], without: 0 }, modes: { items: [], without: 0 } },
  }
  const table = { ...defaults, ...routes }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const path = new URL(url, 'http://localhost').pathname
      const entry = table[path]
      if (entry === undefined) return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) }
      const { status = 200, body } = entry && entry.__response ? entry : { body: entry }
      return { ok: status < 400, status, json: async () => body }
    })
  )
}

const respond = (status, body) => ({ __response: true, status, body })

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  )
}

beforeEach(() => {
  document.title = ''
  mockApi()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('unknown pages', () => {
  it('shows a not-found page with a way back, instead of a blank page', async () => {
    renderAt('/nope')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to your lists' }).getAttribute('href')).toBe('/')
  })

  it('treats a path under a real route as unknown too', async () => {
    renderAt('/lists/1/extra/segments')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy()
  })

  it('keeps the site header and the IGDB attribution around it', async () => {
    renderAt('/nope')
    await screen.findByRole('heading', { name: 'Page not found' })
    expect(screen.getByRole('link', { name: 'BacklogVault' })).toBeTruthy()
    expect(screen.getByText(/Game data and cover art provided by/)).toBeTruthy()
  })

  it('shows the not-found page for a list that does not exist', async () => {
    mockApi({ '/api/lists/999': respond(404, { error: 'List not found' }) })
    renderAt('/lists/999')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy()
  })
})

describe('page titles', () => {
  it('names the not-found page in the tab', async () => {
    renderAt('/nope')
    await waitFor(() => expect(document.title).toBe('Page not found · BacklogVault'))
  })

  it('uses just the site name on the home page', async () => {
    renderAt('/')
    await screen.findByText('Your Lists')
    await waitFor(() => expect(document.title).toBe('BacklogVault'))
  })

  it('uses the list name on a list page', async () => {
    mockApi({ '/api/lists/1': { id: 1, name: 'Weekend Shelf', games: [] } })
    renderAt('/lists/1')
    await waitFor(() => expect(document.title).toBe('Weekend Shelf · BacklogVault'))
  })
})

describe('the IGDB attribution', () => {
  it('links to IGDB and opens safely in a new tab', async () => {
    renderAt('/')
    await screen.findByText('Your Lists')
    const link = screen.getByRole('link', { name: 'IGDB.com' })
    expect(link.getAttribute('href')).toBe('https://www.igdb.com')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })
})

describe('an error while rendering a page', () => {
  it('shows a message inside the app instead of a blank screen, and keeps the header', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // A list with no games array makes the list page throw while rendering.
    mockApi({ '/api/lists/1': { id: 1, name: 'Broken', games: null } })
    renderAt('/lists/1')

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'BacklogVault' })).toBeTruthy()
    expect(console.error).toHaveBeenCalledWith('Unhandled UI error:', expect.any(TypeError), expect.any(String))
  })
})

describe('ErrorBoundary', () => {
  function Bomb({ explode }) {
    if (explode) throw new Error('boom')
    return <p>all good</p>
  }

  it('renders its children when nothing goes wrong', () => {
    render(
      <ErrorBoundary resetKey="a">
        <Bomb explode={false} />
      </ErrorBoundary>
    )
    expect(screen.getByText('all good')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the fallback when a child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary resetKey="a">
        <Bomb explode />
      </ErrorBoundary>
    )
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByText('all good')).toBeNull()
  })

  it('stays on the fallback while the reset key is unchanged', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { rerender } = render(
      <ErrorBoundary resetKey="a">
        <Bomb explode />
      </ErrorBoundary>
    )
    rerender(
      <ErrorBoundary resetKey="a">
        <Bomb explode={false} />
      </ErrorBoundary>
    )
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('recovers when the reset key changes, for example after navigating elsewhere', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { rerender } = render(
      <ErrorBoundary resetKey="/lists/1">
        <Bomb explode />
      </ErrorBoundary>
    )
    expect(screen.getByRole('alert')).toBeTruthy()

    rerender(
      <ErrorBoundary resetKey="/">
        <Bomb explode={false} />
      </ErrorBoundary>
    )
    expect(screen.getByText('all good')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
