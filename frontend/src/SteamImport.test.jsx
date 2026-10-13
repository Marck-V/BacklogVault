import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import SteamImport from './SteamImport'

const SUMMARY = {
  steamId: '76561197960287930',
  owned: 120,
  matched: 100,
  imported: 90,
  alreadyInList: 10,
  skippedOverCap: 0,
  unmatched: 20,
  unmatchedSample: ['Some Soundtrack', 'Some Demo'],
}

// Stands in for the API. `handlers` maps "METHOD path" to a body or a function returning a Response-like object.
function mockApi(handlers) {
  const fetchMock = vi.fn(async (url, options = {}) => {
    const key = `${options.method ?? 'GET'} ${new URL(url, 'http://localhost').pathname}`
    const handler = handlers[key]
    if (handler === undefined) return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) }
    const result = typeof handler === 'function' ? await handler(options) : handler
    return { ok: result.status === undefined || result.status < 400, status: result.status ?? 200, json: async () => result.body }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const notConnected = { 'GET /api/import/steam/status': { body: { enabled: true, linked: false, personaName: null } } }
const connected = { 'GET /api/import/steam/status': { body: { enabled: true, linked: true, personaName: 'Gabe' } } }

function show(props = {}) {
  const onImported = vi.fn()
  render(
    <MemoryRouter>
      <SteamImport listId="7" onImported={onImported} {...props} />
    </MemoryRouter>
  )
  return onImported
}

async function renderConnected(handlers = {}, props = {}) {
  const fetchMock = mockApi({ ...connected, ...handlers })
  const onImported = show(props)
  await screen.findByRole('heading', { name: 'Import from Steam' })
  await screen.findByText('Gabe')
  return { fetchMock, onImported }
}

async function renderNotConnected(handlers = {}) {
  const fetchMock = mockApi({ ...notConnected, ...handlers })
  show()
  await screen.findByRole('heading', { name: 'Import from Steam' })
  return { fetchMock }
}

const importButton = () => screen.getByRole('button', { name: /^Import|Importing/ })
const posts = (fetchMock) => fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('when it is available', () => {
  it('stays hidden if the server has no Steam key', async () => {
    mockApi({ 'GET /api/import/steam/status': { body: { enabled: false } } })
    const { container } = render(
      <MemoryRouter>
        <SteamImport listId="7" />
      </MemoryRouter>
    )
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('stays hidden if the status check fails', async () => {
    mockApi({ 'GET /api/import/steam/status': { status: 500, body: { error: 'down' } } })
    const { container } = render(
      <MemoryRouter>
        <SteamImport listId="7" />
      </MemoryRouter>
    )
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })
})

describe('before connecting', () => {
  it("offers Valve's sign-in button, which goes to the sign-in route", async () => {
    await renderNotConnected()
    const connect = screen.getByRole('link', { name: 'Sign in through Steam' })
    expect(connect.getAttribute('href')).toMatch(/\/api\/auth\/steam\/start$/)
    const image = connect.querySelector('img')
    expect(image.getAttribute('src')).toBe('/sits_01.png')
    expect([image.getAttribute('width'), image.getAttribute('height')]).toEqual(['180', '35'])
    expect(screen.getByText(/we never see your password/)).toBeTruthy()
  })

  it('has no way to type in a profile, and no import button, until an account is connected', async () => {
    await renderNotConnected()
    expect(screen.queryByLabelText('Steam profile')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Import/ })).toBeNull()
  })
})

describe('telling the user what we do with their Steam data', () => {
  it.each([
    ['before connecting', renderNotConnected],
    ['once connected', renderConnected],
  ])('says what is stored and when Steam is read, with a link to the privacy page, %s', async (_label, render) => {
    await render()
    expect(screen.getByText(/We store your Steam ID, your Steam display name and the hours you have played/)).toBeTruthy()
    expect(screen.getByText(/only when you ask/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'How we use your Steam data' }).getAttribute('href')).toBe('/privacy')
  })
})

describe('once connected', () => {
  it('shows who is connected and explains the import', async () => {
    await renderConnected()
    expect(screen.getByText('Gabe')).toBeTruthy()
    expect(screen.getByText(/Game details/)).toBeTruthy()
    expect(screen.getByText(/added as Backlog, with your hours played/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Sign in through Steam' })).toBeNull()
  })

  it('sends only the list, never a profile, with the cookie', async () => {
    const { fetchMock } = await renderConnected({ 'POST /api/import/steam': { body: SUMMARY } })
    fireEvent.click(importButton())
    await screen.findByRole('status')

    const call = posts(fetchMock)[0]
    expect(JSON.parse(call[1].body)).toEqual({ listId: 7 })
    expect(call[1].credentials).toBe('include')
  })

  it('does not read Steam until the button is pressed', async () => {
    const { fetchMock } = await renderConnected({ 'POST /api/import/steam': { body: SUMMARY } })
    expect(posts(fetchMock)).toHaveLength(0)
  })
})

describe('importing', () => {
  it('shows a summary and refreshes the list', async () => {
    const { onImported } = await renderConnected({ 'POST /api/import/steam': { body: SUMMARY } })
    fireEvent.click(importButton())

    const summary = await screen.findByRole('status')
    expect(summary.textContent).toContain('Imported 90 games')
    expect(summary.textContent).toContain('from 120 on Steam (100 matched to IGDB)')
    expect(summary.textContent).toContain('10 were already in this list')
    expect(onImported).toHaveBeenCalledTimes(1)
  })

  it('uses the singular for one game', async () => {
    await renderConnected({
      'POST /api/import/steam': { body: { ...SUMMARY, owned: 1, matched: 1, imported: 1, alreadyInList: 1, unmatched: 0, unmatchedSample: [] } },
    })
    fireEvent.click(importButton())
    const summary = await screen.findByRole('status')
    expect(summary.textContent).toContain('Imported 1 game ')
    expect(summary.textContent).toContain('1 was already in this list')
  })

  it('lists the items that could not be matched, with a count of any that are not shown', async () => {
    await renderConnected({ 'POST /api/import/steam': { body: SUMMARY } })
    fireEvent.click(importButton())
    await screen.findByRole('status')

    expect(screen.getByText("20 Steam items couldn't be matched")).toBeTruthy()
    expect(screen.getByText('Some Soundtrack')).toBeTruthy()
    expect(screen.getByText('and 18 more')).toBeTruthy()
  })

  it('mentions games that did not fit in the list', async () => {
    await renderConnected({ 'POST /api/import/steam': { body: { ...SUMMARY, skippedOverCap: 5 } } })
    fireEvent.click(importButton())
    const summary = await screen.findByRole('status')
    expect(summary.textContent).toContain('5 games did not fit')
    expect(summary.textContent).toContain('The most played came first')
  })

  it('leaves out the notes that do not apply', async () => {
    await renderConnected({
      'POST /api/import/steam': { body: { ...SUMMARY, alreadyInList: 0, skippedOverCap: 0, unmatched: 0, unmatchedSample: [] } },
    })
    fireEvent.click(importButton())
    const summary = await screen.findByRole('status')
    expect(summary.textContent).not.toContain('already in this list')
    expect(summary.textContent).not.toContain('did not fit')
    expect(screen.queryByText(/couldn't be matched/)).toBeNull()
  })

  it("shows the server's message when the import fails, and does not refresh the list", async () => {
    const message = "We couldn't see that profile's games. Set Game details to Public and try again."
    const { onImported } = await renderConnected({ 'POST /api/import/steam': { status: 422, body: { error: message } } })
    fireEvent.click(importButton())

    expect((await screen.findByText(message)).className).toBe('error')
    expect(screen.queryByRole('status')).toBeNull()
    expect(onImported).not.toHaveBeenCalled()
  })

  it('says so when Steam lookups are paused for the day', async () => {
    const message = 'Steam lookups are paused for today because this site has used its daily allowance. Please try again tomorrow.'
    await renderConnected({ 'POST /api/import/steam': { status: 503, body: { error: message } } })
    fireEvent.click(importButton())
    expect((await screen.findByRole('alert')).textContent).toBe(message)
  })

  it('clears an earlier error or summary when you try again', async () => {
    let calls = 0
    await renderConnected({
      'POST /api/import/steam': () => (++calls === 1 ? { status: 502, body: { error: 'Steam is down.' } } : { body: SUMMARY }),
    })
    fireEvent.click(importButton())
    await screen.findByText('Steam is down.')

    fireEvent.click(importButton())
    await screen.findByRole('status')
    expect(screen.queryByText('Steam is down.')).toBeNull()
  })

  it('shows progress and blocks a second click while importing', async () => {
    let finish
    const { fetchMock } = await renderConnected({
      'POST /api/import/steam': () => new Promise((resolve) => (finish = () => resolve({ body: SUMMARY }))),
    })
    fireEvent.click(importButton())

    const busyButton = await screen.findByRole('button', { name: 'Importing…' })
    expect(busyButton.disabled).toBe(true)
    fireEvent.click(busyButton)
    expect(posts(fetchMock)).toHaveLength(1)

    finish()
    await screen.findByRole('status')
    expect(screen.getByRole('button', { name: 'Import my library' }).disabled).toBe(false)
  })
})

describe('disconnecting', () => {
  const lists = { 'GET /api/lists': { body: [] }, 'GET /': { body: {} } }

  function showAt(entry = '/lists/7') {
    return render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/lists/:id" element={<SteamImport listId="7" />} />
          <Route path="/" element={<Where />} />
        </Routes>
      </MemoryRouter>
    )
  }

  function Where() {
    const { search } = useLocation()
    return <div data-testid="home">home{search}</div>
  }

  async function openDisconnect(handlers = {}) {
    const fetchMock = mockApi({ ...connected, ...lists, ...handlers })
    showAt()
    await screen.findByText('Gabe')
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    return { fetchMock, dialog: screen.getByRole('alertdialog') }
  }

  const deletes = (fetchMock) => fetchMock.mock.calls.filter(([, options]) => options?.method === 'DELETE')

  it('warns, in plain words, that the whole library will be deleted for good', async () => {
    const { dialog } = await openDisconnect()
    expect(within(dialog).getByText(/permanently deletes all of your lists and the games in them/)).toBeTruthy()
    expect(within(dialog).getByText(/including games you added yourself/)).toBeTruthy()
    expect(within(dialog).getByText(/cannot be undone/)).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Disconnect and Delete Library' })).toBeTruthy()
  })

  it('offers a download of the library first', async () => {
    const { dialog } = await openDisconnect()
    const link = within(dialog).getByRole('link', { name: 'Download a copy first' })
    expect(link.getAttribute('href')).toMatch(/\/export\/csv$/)
    expect(link.hasAttribute('download')).toBe(true)
  })

  it('also warns on the panel itself, before anyone clicks', async () => {
    mockApi(connected)
    show()
    expect(await screen.findByText(/Disconnecting deletes your library/)).toBeTruthy()
  })

  it('does nothing until it is confirmed', async () => {
    const { fetchMock } = await openDisconnect()
    expect(deletes(fetchMock)).toHaveLength(0)
  })

  it('does nothing when cancelled', async () => {
    const { fetchMock, dialog } = await openDisconnect()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByText('Gabe')).toBeTruthy()
    expect(deletes(fetchMock)).toHaveLength(0)
  })

  it('does nothing when Escape is pressed', async () => {
    const { fetchMock } = await openDisconnect()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(deletes(fetchMock)).toHaveLength(0)
  })

  it('asks the server to delete the library on purpose, then goes home with a message', async () => {
    const { fetchMock, dialog } = await openDisconnect({
      'DELETE /api/steam/link': { body: { linked: false, deleted: { lists: 2, games: 5 } } },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect and Delete Library' }))

    expect((await screen.findByTestId('home')).textContent).toBe('home?steam=disconnected')
    const call = deletes(fetchMock)[0]
    expect(JSON.parse(call[1].body)).toEqual({ deleteLibrary: true })
    expect(call[1].credentials).toBe('include')
  })

  it('shows an error when it fails, and stays where it is', async () => {
    const { dialog } = await openDisconnect({ 'DELETE /api/steam/link': { status: 500, body: { error: 'Nope' } } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect and Delete Library' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Nope')
    expect(screen.getByText('Gabe')).toBeTruthy()
    expect(screen.queryByTestId('home')).toBeNull()
  })
})
