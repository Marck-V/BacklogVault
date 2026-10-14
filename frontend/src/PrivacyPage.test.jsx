import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'

beforeEach(() => {
  document.title = ''
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const path = new URL(url, 'http://localhost').pathname
      const table = { '/api/auth/me': { user: null }, '/api/lists': [] }
      if (table[path] === undefined) return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) }
      return { ok: true, status: 200, json: async () => table[path] }
    })
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  )

describe('the privacy page (Steam Web API terms)', () => {
  it('is reachable at /privacy and titled in the tab', async () => {
    renderAt('/privacy')
    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy and Steam data' })).toBeTruthy()
    expect(document.title).toBe('Privacy and Steam data · BacklogVault')
  })

  it('says accounts are under construction and that the library will be tied to the account once they are live', async () => {
    renderAt('/privacy')
    const heading = await screen.findByRole('heading', { name: 'Your library and this device' })
    expect(heading.nextElementSibling.textContent).toMatch(
      /no accounts yet: they are under construction, and once they are live your library will be saved and tied to your account/
    )
  })

  it('says Steam data is read only when the user asks, and never for anyone who has not connected', async () => {
    renderAt('/privacy')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByText(/only when you ask us to/)).toBeTruthy()
    expect(screen.getByText(/never read the Steam data of anyone who has not connected/)).toBeTruthy()
  })

  it('lists everything stored and where it goes', async () => {
    renderAt('/privacy')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByText(/Your Steam ID .* and your Steam display name/)).toBeTruthy()
    expect(screen.getByText(/the hours you have played/)).toBeTruthy()
    expect(screen.getByText(/never see or store your Steam password/)).toBeTruthy()
    expect(screen.getByText(/receives the Steam app numbers of the games you import/)).toBeTruthy()
    expect(screen.getByText(/do not sell your data/)).toBeTruthy()
  })

  it('has as-is disclaimers and says it is not affiliated with Valve', async () => {
    renderAt('/privacy')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByRole('heading', { name: /Steam data is provided/ })).toBeTruthy()
    expect(screen.getByText(/no promises or warranties about Steam data/)).toBeTruthy()
    expect(screen.getByText(/not affiliated with, sponsored by or endorsed by Valve/)).toBeTruthy()
    expect(within(screen.getByRole('article')).getByText(/trademarks of Valve Corporation/)).toBeTruthy()
  })

  it('says disconnecting Steam deletes the whole library', async () => {
    renderAt('/privacy')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByText(/deletes your whole library/)).toBeTruthy()
    expect(screen.getByText(/including games you added/)).toBeTruthy()
    expect(screen.getByText(/It cannot be undone/)).toBeTruthy()
  })

  it('does not invent a storage country: it says plainly when none has been set', async () => {
    renderAt('/privacy')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByText(/country where your data is stored will be named here when the site is deployed/)).toBeTruthy()
  })

  it('names the storage country and contact once they are configured', async () => {
    vi.stubEnv('VITE_DATA_COUNTRY', 'Germany')
    vi.stubEnv('VITE_CONTACT_EMAIL', 'privacy@example.com')
    vi.resetModules()
    const { default: Configured } = await import('./PrivacyPage')
    render(
      <MemoryRouter>
        <Configured />
      </MemoryRouter>
    )
    expect(screen.getByText(/stored on servers in Germany/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'privacy@example.com' }).getAttribute('href')).toBe('mailto:privacy@example.com')
  })
})

describe('the footer on every page', () => {
  it('says the site is not affiliated with Valve, links to Steam without nofollow, and links to the privacy page', async () => {
    renderAt('/')
    const steam = await screen.findByRole('link', { name: 'Steam' })
    expect(steam.getAttribute('href')).toBe('https://store.steampowered.com/')
    expect((steam.getAttribute('rel') ?? '').split(' ')).not.toContain('nofollow')
    expect(screen.getByText(/not affiliated with or endorsed by Valve/)).toBeTruthy()
    expect(screen.getByText(/Steam Web API/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Privacy and Steam data' }).getAttribute('href')).toBe('/privacy')
  })

  it('keeps the IGDB attribution', async () => {
    renderAt('/')
    expect((await screen.findByRole('link', { name: 'IGDB.com' })).getAttribute('href')).toBe('https://www.igdb.com')
  })
})
