import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'

const GAME = { id: 1, igdb_id: 1942, name: 'The Witcher 3', status: 'Backlog', hours_played: null, cover_url: null, hidden: 0 }

const DETAILS = {
  developer: 'CD Projekt Red',
  first_release_date: 1431993600,
  age_ratings: [
    { organization: 'ESRB', rating: 'M' },
    { organization: 'PEGI', rating: '18' },
  ],
  audio_languages: ['English', 'French', 'Polish'],
  store_links: [
    { key: 'steam', label: 'Steam', url: 'https://store.steampowered.com/app/292030' },
    { key: 'gog', label: 'GOG', url: 'https://www.gog.com/game/the_witcher_3_wild_hunt' },
    { key: 'epic', label: 'Epic Games Store', url: 'https://www.epicgames.com/store/en-US/product/the-witcher-3-wild-hunt/home' },
    { key: 'official', label: 'Official site', url: 'http://www.thewitcher.com/' },
  ],
  time_to_beat_main_seconds: 187200,
  time_to_beat_completionist_seconds: 576000,
}

let details
let achievements

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const path = new URL(url, 'http://localhost').pathname
      const table = {
        '/api/auth/me': { user: null },
        '/api/lists': [],
        '/api/lists/1': { id: 1, name: 'Library', games: [GAME] },
        '/api/games/1942/details': details,
        '/api/games/1942/achievements': achievements,
      }
      if (table[path] === undefined) return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) }
      return { ok: true, status: 200, json: async () => table[path] }
    })
  )
}

async function openGame() {
  render(
    <MemoryRouter initialEntries={['/lists/1']}>
      <App />
    </MemoryRouter>
  )
  fireEvent.click(await screen.findByRole('button', { name: 'The Witcher 3' }))
  return within(await screen.findByRole('dialog'))
}

beforeEach(() => {
  details = DETAILS
  achievements = { status: 'not_connected' }
  mockApi()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('game window: age rating, audio and store links', () => {
  it('shows the age ratings and the languages with full audio', async () => {
    const dialog = await openGame()
    expect(await dialog.findByText('ESRB M · PEGI 18')).toBeTruthy()
    expect(dialog.getByText('English, French, Polish')).toBeTruthy()
  })

  it('says "Not listed" when IGDB has neither', async () => {
    details = { ...DETAILS, age_ratings: [], audio_languages: [] }
    const dialog = await openGame()
    await dialog.findByText('Age Rating')
    expect(dialog.getAllByText('Not listed')).toHaveLength(2)
  })

  it('links to Steam, GOG, Epic and the official site, opening in a new tab without leaking the referrer', async () => {
    const dialog = await openGame()
    const links = (await dialog.findAllByRole('link')).map((a) => [a.textContent.replace(' (opens in a new tab)', ''), a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')])
    expect(links).toEqual([
      ['Steam', 'https://store.steampowered.com/app/292030', '_blank', 'noopener noreferrer'],
      ['GOG', 'https://www.gog.com/game/the_witcher_3_wild_hunt', '_blank', 'noopener noreferrer'],
      ['Epic Games Store', 'https://www.epicgames.com/store/en-US/product/the-witcher-3-wild-hunt/home', '_blank', 'noopener noreferrer'],
      ['Official site', 'http://www.thewitcher.com/', '_blank', 'noopener noreferrer'],
    ])
    expect(dialog.getAllByText('(opens in a new tab)')).toHaveLength(4)
  })

  it('leaves the store section out when there are no links', async () => {
    details = { ...DETAILS, store_links: [] }
    const dialog = await openGame()
    await dialog.findByText('Age Rating')
    expect(dialog.queryByText('Find It On')).toBeNull()
    expect(dialog.queryAllByRole('link')).toHaveLength(0)
  })
})

describe('game window: Steam achievements', () => {
  it('shows how many are unlocked, with a bar', async () => {
    achievements = { status: 'ok', total: 78, unlocked: 42 }
    const dialog = await openGame()
    expect(await dialog.findByText(/42 of 78 unlocked \(54%\)/)).toBeTruthy()
    const bar = dialog.getByRole('progressbar', { name: 'Steam achievements unlocked' })
    expect(bar.getAttribute('value')).toBe('42')
    expect(bar.getAttribute('max')).toBe('78')
  })

  it('explains how to fix a private profile', async () => {
    achievements = { status: 'private' }
    const dialog = await openGame()
    expect(await dialog.findByText(/set your profile.s Game details to Public/)).toBeTruthy()
  })

  it.each(['not_connected', 'none', 'unavailable'])('leaves the line out for %s', async (status) => {
    achievements = { status }
    const dialog = await openGame()
    await dialog.findByText('Age Rating')
    expect(dialog.queryByText('Steam Achievements')).toBeNull()
  })

  it('still shows everything else when the achievements request fails', async () => {
    achievements = undefined
    const dialog = await openGame()
    expect(await dialog.findByText('ESRB M · PEGI 18')).toBeTruthy()
    expect(dialog.queryByText('Steam Achievements')).toBeNull()
  })
})
