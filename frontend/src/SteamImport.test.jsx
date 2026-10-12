import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
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

const enabled = { 'GET /api/import/steam/status': { body: { enabled: true } } }

async function renderEnabled(handlers = {}, props = {}) {
  const fetchMock = mockApi({ ...enabled, ...handlers })
  const onImported = vi.fn()
  render(<SteamImport listId="7" onImported={onImported} {...props} />)
  await screen.findByRole('heading', { name: 'Import from Steam' })
  return { fetchMock, onImported }
}

const type = (value) => fireEvent.change(screen.getByLabelText('Steam profile'), { target: { value } })
const submit = () => fireEvent.click(screen.getByRole('button', { name: /^Import/ }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('when it is available', () => {
  it('stays hidden if the server has no Steam key', async () => {
    mockApi({ 'GET /api/import/steam/status': { body: { enabled: false } } })
    const { container } = render(<SteamImport listId="7" />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('stays hidden if the status check fails', async () => {
    mockApi({ 'GET /api/import/steam/status': { status: 500, body: { error: 'down' } } })
    const { container } = render(<SteamImport listId="7" />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('explains what to do and what happens to the games', async () => {
    await renderEnabled()
    expect(screen.getByText(/Game details/)).toBeTruthy()
    expect(screen.getByText(/added as Backlog, with your hours played/)).toBeTruthy()
    expect(screen.getByText(/only import your own library/)).toBeTruthy()
  })

  it('keeps the button disabled until something is typed', async () => {
    await renderEnabled()
    const button = screen.getByRole('button', { name: 'Import' })
    expect(button.disabled).toBe(true)
    type('   ')
    expect(button.disabled).toBe(true)
    type('gaben')
    expect(button.disabled).toBe(false)
  })
})

describe('importing', () => {
  it('sends the list as a number and the text trimmed, with the cookie', async () => {
    const { fetchMock } = await renderEnabled({ 'POST /api/import/steam': { body: SUMMARY } })
    type('  https://steamcommunity.com/id/gaben  ')
    submit()
    await screen.findByRole('status')

    const call = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')
    expect(JSON.parse(call[1].body)).toEqual({ listId: 7, steam: 'https://steamcommunity.com/id/gaben' })
    expect(call[1].credentials).toBe('include')
  })

  it('shows a summary and refreshes the list', async () => {
    const { onImported } = await renderEnabled({ 'POST /api/import/steam': { body: SUMMARY } })
    type('gaben')
    submit()

    const summary = await screen.findByRole('status')
    expect(summary.textContent).toContain('Imported 90 games')
    expect(summary.textContent).toContain('from 120 on Steam (100 matched to IGDB)')
    expect(summary.textContent).toContain('10 were already in this list')
    expect(onImported).toHaveBeenCalledTimes(1)
  })

  it('uses the singular for one game', async () => {
    await renderEnabled({
      'POST /api/import/steam': { body: { ...SUMMARY, owned: 1, matched: 1, imported: 1, alreadyInList: 1, unmatched: 0, unmatchedSample: [] } },
    })
    type('gaben')
    submit()
    const summary = await screen.findByRole('status')
    expect(summary.textContent).toContain('Imported 1 game ')
    expect(summary.textContent).toContain('1 was already in this list')
  })

  it('lists the items that could not be matched, with a count of any that are not shown', async () => {
    await renderEnabled({ 'POST /api/import/steam': { body: SUMMARY } })
    type('gaben')
    submit()
    await screen.findByRole('status')

    expect(screen.getByText('20 Steam items couldn\'t be matched')).toBeTruthy()
    expect(screen.getByText('Some Soundtrack')).toBeTruthy()
    expect(screen.getByText('and 18 more')).toBeTruthy()
  })

  it('mentions games that did not fit in the list', async () => {
    await renderEnabled({ 'POST /api/import/steam': { body: { ...SUMMARY, skippedOverCap: 5 } } })
    type('gaben')
    submit()
    const summary = await screen.findByRole('status')
    expect(summary.textContent).toContain('5 games did not fit')
    expect(summary.textContent).toContain('The most played came first')
  })

  it('leaves out the notes that do not apply', async () => {
    await renderEnabled({
      'POST /api/import/steam': { body: { ...SUMMARY, alreadyInList: 0, skippedOverCap: 0, unmatched: 0, unmatchedSample: [] } },
    })
    type('gaben')
    submit()
    const summary = await screen.findByRole('status')
    expect(summary.textContent).not.toContain('already in this list')
    expect(summary.textContent).not.toContain('did not fit')
    expect(screen.queryByText(/couldn't be matched/)).toBeNull()
  })

  it('shows the server\'s message when the import fails, and does not refresh the list', async () => {
    const message = "We couldn't see that profile's games. Set Game details to Public and try again."
    const { onImported } = await renderEnabled({ 'POST /api/import/steam': { status: 422, body: { error: message } } })
    type('gaben')
    submit()

    expect((await screen.findByText(message)).className).toBe('error')
    expect(screen.queryByRole('status')).toBeNull()
    expect(onImported).not.toHaveBeenCalled()
  })

  it('clears an earlier error or summary when you try again', async () => {
    let calls = 0
    await renderEnabled({
      'POST /api/import/steam': () => (++calls === 1 ? { status: 404, body: { error: 'We could not find that Steam profile.' } } : { body: SUMMARY }),
    })
    type('nobody')
    submit()
    await screen.findByText('We could not find that Steam profile.')

    type('gaben')
    submit()
    await screen.findByRole('status')
    expect(screen.queryByText('We could not find that Steam profile.')).toBeNull()
  })

  it('shows progress and blocks a second click while importing', async () => {
    let finish
    const { fetchMock } = await renderEnabled({
      'POST /api/import/steam': () => new Promise((resolve) => (finish = () => resolve({ body: SUMMARY }))),
    })
    type('gaben')
    submit()

    const busyButton = await screen.findByRole('button', { name: 'Importing...' })
    expect(busyButton.disabled).toBe(true)
    fireEvent.click(busyButton)
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)

    finish()
    await screen.findByRole('status')
    expect(screen.getByRole('button', { name: 'Import' }).disabled).toBe(false)
  })

  it('does not call the server for an empty box', async () => {
    const { fetchMock } = await renderEnabled({ 'POST /api/import/steam': { body: SUMMARY } })
    fireEvent.submit(screen.getByLabelText('Steam profile').closest('form'))
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0)
  })
})
