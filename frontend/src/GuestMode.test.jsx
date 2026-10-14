import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import App from './App'

let calls
let me
let lists
let handlers

function mockApi() {
  calls = []
  me = { user: null, accountsEnabled: false }
  lists = []
  handlers = {}
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options = {}) => {
      const method = options.method ?? 'GET'
      const path = new URL(url, 'http://localhost').pathname
      const body = options.body ? JSON.parse(options.body) : undefined
      calls.push({ method, path, body })

      const custom = handlers[`${method} ${path}`]
      if (custom) {
        const result = await custom(body)
        return { ok: (result.status ?? 200) < 400, status: result.status ?? 200, json: async () => result.body }
      }
      const table = {
        '/api/auth/me': me,
        '/api/lists': lists,
        '/api/stats/time-to-beat': { game_count: 0, completed_count: 0, total_main_story_seconds: 0, total_completionist_seconds: 0 },
        '/api/stats/currently-playing': { source: 'manual', steam_linked: false, games: [] },
        '/api/stats/breakdown': { game_count: 0, genres: { items: [], without: 0 }, themes: { items: [], without: 0 }, modes: { items: [], without: 0 } },
      }
      if (method !== 'GET' || table[path] === undefined) return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) }
      return { ok: true, status: 200, json: async () => table[path] }
    })
  )
}

function Where() {
  const { pathname, search } = useLocation()
  return <div data-testid="where">{pathname + search}</div>
}

async function openHome(entry = '/') {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <App />
      <Where />
    </MemoryRouter>
  )
  await screen.findByRole('heading', { name: 'Your data' })
}

const backupFile = (content, name = 'backup.json') => new File([typeof content === 'string' ? content : JSON.stringify(content)], name, { type: 'application/json' })
const chooseFile = (file) => fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } })
const requests = (method, path) => calls.filter((c) => c.method === method && c.path === path)
const GOOD_BACKUP = { app: 'BacklogVault', format: 1, lists: [{ name: 'Weekend', games: [{ igdb_id: 1, name: 'Hades' }] }] }

beforeEach(() => {
  localStorage.clear()
  mockApi()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('with accounts switched off', () => {
  it('shows no sign in, sign up or guest label anywhere in the header', async () => {
    await openHome()
    const header = document.querySelector('.site-header')
    expect(within(header).queryByRole('button', { name: /Sign In/ })).toBeNull()
    expect(within(header).queryByRole('button', { name: /Create Account/ })).toBeNull()
    expect(within(header).queryByText('Guest')).toBeNull()
  })

  it('shows them when the server says accounts are on', async () => {
    me = { user: null, accountsEnabled: true }
    await openHome()
    const header = document.querySelector('.site-header')
    expect(await within(header).findByRole('button', { name: /Sign In/ })).toBeTruthy()
    expect(within(header).getByRole('button', { name: /Create Account/ })).toBeTruthy()
  })

  it('follows the server, not the page: a guest with accounts on still sees the account prompts', async () => {
    me = { user: { id: 1, email: null, isGuest: true }, accountsEnabled: true }
    lists = [{ id: 1, name: 'Mine' }]
    await openHome()
    expect(await screen.findByText(/You're using BacklogVault as a guest/)).toBeTruthy()
    expect(screen.queryByText(/Your library is saved on this device. If you clear/)).toBeNull()
  })
})

describe('telling people where their library lives', () => {
  beforeEach(() => {
    me = { user: { id: 1, email: null, isGuest: true }, accountsEnabled: false }
    lists = [{ id: 1, name: 'Mine' }]
  })

  it('warns on the home page that the library is saved on this device, and about the 90 days', async () => {
    await openHome()
    const note = await screen.findByRole('note')
    expect(note.textContent).toMatch(/saved on this device/)
    expect(note.textContent).toMatch(/clear your browser data or switch devices/)
    expect(note.textContent).toMatch(/not opened for 90 days is deleted/)
    expect(note.textContent).toMatch(/Accounts are under construction: once they are live, your library will be saved and tied to your account/)
    expect(within(note).getByRole('link', { name: 'Download Backup' }).getAttribute('href')).toMatch(/\/api\/library\/backup$/)
  })

  it('can be dismissed, and stays dismissed on the next visit', async () => {
    await openHome()
    fireEvent.click(within(await screen.findByRole('note')).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('note')).toBeNull()
    expect(localStorage.getItem('bv_device_notice_dismissed')).toBe('1')

    cleanup()
    await openHome()
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('is not shown to someone with no games yet', async () => {
    lists = []
    await openHome()
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('still says it in Your data after the notice is dismissed', async () => {
    localStorage.setItem('bv_device_notice_dismissed', '1')
    await openHome()
    const section = screen.getByRole('heading', { name: 'Your data' }).closest('section')
    expect(section.textContent).toMatch(/saved on this device, in this browser/)
    expect(section.textContent).toMatch(/not been opened for 90 days is deleted/)
    expect(section.textContent).toMatch(/Accounts are under construction/)
  })
})

describe('the Your data section', () => {
  it('is there even for someone with no library, who is exactly who needs to restore a backup', async () => {
    await openHome()
    const section = screen.getByRole('heading', { name: 'Your data' }).closest('section')
    expect(within(section).getByRole('link', { name: 'Download Backup' })).toBeTruthy()
    expect(within(section).getByRole('button', { name: 'Restore From Backup' })).toBeTruthy()
    expect(within(section).getByRole('button', { name: 'Delete My Data' })).toBeTruthy()
    expect(within(section).getByRole('link', { name: 'How we handle your data' }).getAttribute('href')).toBe('/privacy')
  })

  it('downloads the backup as a file', async () => {
    await openHome()
    const link = screen.getByRole('link', { name: 'Download Backup' })
    expect(link.hasAttribute('download')).toBe(true)
    expect(link.getAttribute('href')).toMatch(/\/api\/library\/backup$/)
  })

  it('says a registered account is saved to the account, not to the device', async () => {
    me = { user: { id: 2, email: 'a@example.com', isGuest: false }, accountsEnabled: true }
    await openHome()
    const section = screen.getByRole('heading', { name: 'Your data' }).closest('section')
    expect(await within(section).findByText(/saved to your account/)).toBeTruthy()
    expect(section.textContent).not.toMatch(/90 days/)
    expect(section.textContent).not.toMatch(/under construction/)
  })
})

describe('restoring a backup', () => {
  const summary = { lists_created: 1, lists_matched: 0, games_added: 3, games_already_there: 0, games_skipped: 0, games_over_limit: 0 }

  it('sends the file to the server and says what came back', async () => {
    handlers['POST /api/library/restore'] = () => ({ body: summary })
    await openHome()
    chooseFile(backupFile(GOOD_BACKUP))

    const status = await screen.findByText(/Restored 3 games/)
    expect(status.closest('[role="status"]').textContent).toContain('into 1 new list')
    expect(requests('POST', '/api/library/restore')[0].body).toEqual(GOOD_BACKUP)
  })

  it('keeps the summary on screen even when the first restore creates the library and rebuilds the page', async () => {
    handlers['POST /api/library/restore'] = () => {
      me = { user: { id: 9, email: null, isGuest: true }, accountsEnabled: false } // a guest now exists
      lists = [{ id: 1, name: 'Weekend' }]
      return { body: summary }
    }
    await openHome()
    chooseFile(backupFile(GOOD_BACKUP))
    expect(await screen.findByText(/Restored 3 games/)).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Weekend')).toBeTruthy()) // the new library is showing
    expect(screen.getByText(/Restored 3 games/)).toBeTruthy() // and the message is still there
  })

  it('refreshes the lists and who is signed in afterwards', async () => {
    handlers['POST /api/library/restore'] = () => ({ body: summary })
    await openHome()
    const listsBefore = requests('GET', '/api/lists').length
    const meBefore = requests('GET', '/api/auth/me').length
    chooseFile(backupFile(GOOD_BACKUP))

    await screen.findByText(/Restored 3 games/)
    await waitFor(() => expect(requests('GET', '/api/lists').length).toBeGreaterThan(listsBefore))
    expect(requests('GET', '/api/auth/me').length).toBeGreaterThan(meBefore)
  })

  it('explains games that were already there, skipped, or over the limits', async () => {
    handlers['POST /api/library/restore'] = () => ({
      body: { lists_created: 0, lists_matched: 2, games_added: 1, games_already_there: 4, games_skipped: 2, games_over_limit: 5 },
    })
    await openHome()
    chooseFile(backupFile(GOOD_BACKUP))
    const status = (await screen.findByText(/Restored 1 game/)).closest('[role="status"]')
    expect(status.textContent).toContain('4 were already in your library, so they were left as they are')
    expect(status.textContent).toContain('5 games did not fit within the list limits')
    expect(status.textContent).toContain('2 entries in the file could not be used and were skipped')
  })

  it('refuses a file that is not JSON, without sending anything', async () => {
    await openHome()
    chooseFile(backupFile('this is not json'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/isn't a BacklogVault backup/)
    expect(requests('POST', '/api/library/restore')).toHaveLength(0)
  })

  it('refuses a file over 4 MB without reading or sending it', async () => {
    await openHome()
    chooseFile(new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'huge.json'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/too large/)
    expect(requests('POST', '/api/library/restore')).toHaveLength(0)
  })

  it("shows the server's reason when it refuses the file", async () => {
    handlers['POST /api/library/restore'] = () => ({ status: 400, body: { error: "That doesn't look like a BacklogVault backup file." } })
    await openHome()
    chooseFile(backupFile({ some: 'other file' }))
    expect((await screen.findByRole('alert')).textContent).toBe("That doesn't look like a BacklogVault backup file.")
    expect(screen.queryByText(/Restored/)).toBeNull()
  })

  it('shows progress and blocks a second restore while one is running', async () => {
    let finish
    handlers['POST /api/library/restore'] = () => new Promise((resolve) => (finish = () => resolve({ body: summary })))
    await openHome()
    chooseFile(backupFile(GOOD_BACKUP))

    const busy = await screen.findByRole('button', { name: 'Restoring…' })
    expect(busy.disabled).toBe(true)
    finish()
    await screen.findByText(/Restored 3 games/)
    expect(screen.getByRole('button', { name: 'Restore From Backup' }).disabled).toBe(false)
  })

  it('does nothing when the file chooser is cancelled', async () => {
    await openHome()
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [] } })
    expect(requests('POST', '/api/library/restore')).toHaveLength(0)
  })
})

describe('deleting my data', () => {
  beforeEach(() => {
    me = { user: { id: 1, email: null, isGuest: true }, accountsEnabled: false }
    lists = [{ id: 1, name: 'Mine' }]
  })

  async function openDialog() {
    await openHome()
    fireEvent.click(screen.getByRole('button', { name: 'Delete My Data' }))
    return screen.getByRole('alertdialog')
  }

  it('warns, in plain words, that everything goes and cannot come back, and offers a backup first', async () => {
    const dialog = await openDialog()
    expect(within(dialog).getByText(/permanently deletes every list and game/)).toBeTruthy()
    expect(within(dialog).getByText(/Steam connection/)).toBeTruthy()
    expect(within(dialog).getByText('It cannot be undone.')).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: 'Download a backup first' }).getAttribute('href')).toMatch(/\/api\/library\/backup$/)
    expect(requests('DELETE', '/api/auth/me')).toHaveLength(0)
  })

  it('does nothing when cancelled or when Escape is pressed', async () => {
    const dialog = await openDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Delete My Data' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(requests('DELETE', '/api/auth/me')).toHaveLength(0)
  })

  it('asks the server to delete everything on purpose, then confirms on the home page', async () => {
    handlers['DELETE /api/auth/me'] = () => ({ body: { deleted: { lists: 1, games: 5 } } })
    const dialog = await openDialog()
    me = { user: null, accountsEnabled: false } // what the server will say once the session is gone
    lists = []
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete My Data' }))

    expect((await screen.findByRole('status')).textContent).toContain('Your data was deleted.')
    expect(requests('DELETE', '/api/auth/me')[0].body).toEqual({ deleteEverything: true })
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/'))
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('shows an error and keeps everything when the server fails', async () => {
    handlers['DELETE /api/auth/me'] = () => ({ status: 500, body: { error: 'Something went wrong' } })
    const dialog = await openDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete My Data' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Something went wrong')
    expect(screen.getByText('Mine')).toBeTruthy()
  })
})

describe('the privacy page matches', () => {
  async function privacy() {
    render(
      <MemoryRouter initialEntries={['/privacy']}>
        <App />
      </MemoryRouter>
    )
    await screen.findByRole('heading', { level: 1, name: 'Privacy and Steam data' })
  }

  it('says there are no accounts, how the library is tied to the device, and the 90 days', async () => {
    await privacy()
    expect(await screen.findByText(/BacklogVault has no accounts/)).toBeTruthy()
    expect(screen.getByText(/starts you with an empty library/)).toBeTruthy()
    expect(screen.getByText(/has not been opened for 90 days is deleted automatically/)).toBeTruthy()
    expect(screen.queryByText(/email address and a scrambled/)).toBeNull()
  })

  it('describes the one cookie and promises no tracking', async () => {
    await privacy()
    expect(screen.getByText('bv_session')).toBeTruthy()
    expect(screen.getByText(/not used for tracking or advertising/)).toBeTruthy()
  })

  it('points to the self-serve delete button, and to backup and restore', async () => {
    await privacy()
    expect(screen.getByText(/deletes everything we hold about you at once/)).toBeTruthy()
    expect(screen.getByText('Download Backup')).toBeTruthy()
    expect(screen.getByText('Restore From Backup')).toBeTruthy()
  })

  it('mentions email and passwords only when accounts are on', async () => {
    me = { user: null, accountsEnabled: true }
    await privacy()
    expect(await screen.findByText(/email address and a scrambled/)).toBeTruthy()
    expect(screen.getByText(/You can use BacklogVault without an account/)).toBeTruthy()
    expect(screen.queryByText(/has no accounts/)).toBeNull()
  })
})
