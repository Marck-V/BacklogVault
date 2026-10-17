import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('./api', () => ({
  getTimeToBeatStats: vi.fn(),
  getCurrentlyPlaying: vi.fn(),
  getBreakdown: vi.fn(),
  refreshFromSteam: vi.fn(),
  setEstimateIncluded: vi.fn(),
}))

import Dashboard from './Dashboard'
import { getTimeToBeatStats, getCurrentlyPlaying, getBreakdown, setEstimateIncluded, refreshFromSteam } from './api'
import type { CurrentlyPlaying, HoursRefresh, RefreshResult } from '../../shared/api.ts'

const BASE = {
  game_count: 3,
  completed_count: 1,
  total_main_story_seconds: 36000,
  total_completionist_seconds: 72000,
  total_hours_played: 1234.4,
  games_left_out: 0,
  games_without_estimate: 0,
  over_limit_games: [],
}

const none = { items: [], without: 0 }
const BREAKDOWN_EMPTY = { game_count: 0, genres: none, themes: none, modes: none }
const BREAKDOWN = {
  game_count: 12,
  genres: {
    items: [
      { name: 'RPG', count: 7 },
      { name: 'Shooter', count: 4 },
      { name: 'Other', count: 2 },
    ],
    without: 3,
  },
  themes: { items: [{ name: 'Fantasy', count: 9 }, { name: 'Horror', count: 2 }], without: 1 },
  modes: { items: [{ name: 'Single player', count: 10 }, { name: 'Co-operative', count: 5 }], without: 0 },
}

const GAME = { igdb_id: 9, name: 'VRChat', main_story_seconds: 180018000, completionist_seconds: 190000000, included: false }

afterEach(cleanup)

beforeEach(() => {
  vi.mocked(getCurrentlyPlaying).mockResolvedValue({ source: 'manual', steam_linked: false, steam_failed: false, games: [] })
  vi.mocked(getBreakdown).mockResolvedValue(BREAKDOWN_EMPTY)
})

describe('Dashboard', () => {
  it('shows total hours played', async () => {
    vi.mocked(getTimeToBeatStats).mockResolvedValue(BASE)
    render(<Dashboard />)
    const label = await screen.findByText('Total hours played')
    const card = label.closest<HTMLElement>('.stat-card')!
    expect(card.querySelector<HTMLElement>('.stat-number')!.textContent).toBe('1,234')
    expect(card.querySelector<HTMLElement>('.stat-unit')!.textContent).toBe('hours')
    expect(screen.queryByText(/leaves out/)).toBeNull()
  })

  it('says how many games were left out of the time remaining', async () => {
    vi.mocked(getTimeToBeatStats).mockResolvedValue({ ...BASE, games_left_out: 1, games_without_estimate: 70, over_limit_games: [GAME] })
    render(<Dashboard />)
    expect(await screen.findByText(/leaves out/)).toBeTruthy()
    expect(screen.getByText(/70 with no\s+estimate/)).toBeTruthy()
  })

  it('shows a dash, not "0 hours", when IGDB has no 100% estimate for a left-out game', async () => {
    const noFull = { ...GAME, completionist_seconds: 0 }
    vi.mocked(getTimeToBeatStats).mockResolvedValue({ ...BASE, games_left_out: 1, over_limit_games: [noFull] })
    render(<Dashboard />)
    fireEvent.click(await screen.findByRole('button', { name: /1 game with unrealistic estimates/ }))
    const row = screen.getByText('VRChat').closest('label')!
    expect(row.textContent).toContain('— 100%')
    expect(row.textContent).not.toContain('0 hours 100%')
    expect(row.textContent).toContain('50,005 hours main')
  })

  it('opens the left-out games on click and lets you count one', async () => {
    const withGame = { ...BASE, games_left_out: 1, over_limit_games: [GAME] }
    vi.mocked(getTimeToBeatStats).mockResolvedValue(withGame)
    vi.mocked(setEstimateIncluded).mockResolvedValue({ igdb_id: 1, included: true })
    render(<Dashboard />)

    expect(screen.queryByText('VRChat')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: /1 game with unrealistic estimates/ }))
    const box = screen.getByRole<HTMLInputElement>('checkbox')
    expect(screen.getByText('VRChat')).toBeTruthy()
    expect(box.checked).toBe(false)

    vi.mocked(getTimeToBeatStats).mockResolvedValue({
      ...withGame,
      games_left_out: 0,
      over_limit_games: [{ ...GAME, included: true }],
    })
    fireEvent.click(box)
    await waitFor(() => expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(true))
    expect(setEstimateIncluded).toHaveBeenCalledWith(9, true)
  })

  describe('library breakdown', () => {
    beforeEach(() => {
      localStorage.clear()
    })

    it('starts on genres, with a count for each', async () => {
      vi.mocked(getTimeToBeatStats).mockResolvedValue(BASE)
      vi.mocked(getBreakdown).mockResolvedValue(BREAKDOWN)
      render(<Dashboard />)

      expect(await screen.findByText('RPG')).toBeTruthy()
      expect(screen.getByText('Shooter')).toBeTruthy()
      expect(screen.getByText('7')).toBeTruthy()
      expect(screen.getByRole('img', { name: 'Your library by genre' })).toBeTruthy()
      expect(screen.getByText(/3 have no genre on IGDB/)).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Genres' }).getAttribute('aria-pressed')).toBe('true')
    })

    it('switches to themes and to game modes, with their own wording', async () => {
      vi.mocked(getTimeToBeatStats).mockResolvedValue(BASE)
      vi.mocked(getBreakdown).mockResolvedValue(BREAKDOWN)
      render(<Dashboard />)
      await screen.findByText('RPG')

      fireEvent.click(screen.getByRole('button', { name: 'Themes' }))
      expect(screen.getByText('Fantasy')).toBeTruthy()
      expect(screen.queryByText('RPG')).toBeNull()
      expect(screen.getByRole('img', { name: 'Your library by theme' })).toBeTruthy()
      expect(screen.getByText(/1 have no theme on IGDB/)).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Themes' }).getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByRole('button', { name: 'Genres' }).getAttribute('aria-pressed')).toBe('false')

      fireEvent.click(screen.getByRole('button', { name: 'Game modes' }))
      expect(screen.getByText('Single player')).toBeTruthy()
      expect(screen.getByRole('img', { name: 'Your library by game mode' })).toBeTruthy()
      expect(screen.getByText(/A game can have several modes/)).toBeTruthy()
      expect(screen.queryByText(/have no game mode/)).toBeNull() // every game has a mode in this data
    })

    it('remembers the tab you chose', async () => {
      vi.mocked(getTimeToBeatStats).mockResolvedValue(BASE)
      vi.mocked(getBreakdown).mockResolvedValue(BREAKDOWN)
      const first = render(<Dashboard />)
      await screen.findByText('RPG')
      fireEvent.click(screen.getByRole('button', { name: 'Game modes' }))
      first.unmount()

      render(<Dashboard />)
      expect(await screen.findByText('Single player')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Game modes' }).getAttribute('aria-pressed')).toBe('true')
    })

    it('still works when the browser blocks storage', async () => {
      vi.mocked(getTimeToBeatStats).mockResolvedValue(BASE)
      vi.mocked(getBreakdown).mockResolvedValue(BREAKDOWN)
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      render(<Dashboard />)
      expect(await screen.findByText('RPG')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Themes' }))
      expect(screen.getByText('Fantasy')).toBeTruthy()
      vi.restoreAllMocks()
    })

    it('says so when a category is empty', async () => {
      vi.mocked(getTimeToBeatStats).mockResolvedValue(BASE)
      vi.mocked(getBreakdown).mockResolvedValue({ ...BREAKDOWN, themes: none })
      render(<Dashboard />)
      await screen.findByText('RPG')
      fireEvent.click(screen.getByRole('button', { name: 'Themes' }))
      expect(screen.getByText(/no theme information for your games/)).toBeTruthy()
    })

    it('says so when IGDB is unavailable, and keeps the rest of the dashboard', async () => {
      vi.mocked(getTimeToBeatStats).mockResolvedValue(BASE)
      vi.mocked(getBreakdown).mockResolvedValue({ igdb_unavailable: true, game_count: null })
      render(<Dashboard />)

      expect(await screen.findByText(/temporarily unavailable/)).toBeTruthy()
      expect(screen.getByText('Total hours played')).toBeTruthy()
    })

    it('survives the request failing outright', async () => {
      vi.mocked(getTimeToBeatStats).mockResolvedValue(BASE)
      vi.mocked(getBreakdown).mockRejectedValue(new Error('network'))
      render(<Dashboard />)

      expect(await screen.findByText(/library breakdown couldn't be loaded/)).toBeTruthy()
      expect(screen.getByText('Total hours played')).toBeTruthy()
    })
  })

  it('shows recently played Steam games with their two-week hours', async () => {
    vi.mocked(getTimeToBeatStats).mockResolvedValue(BASE)
    vi.mocked(getCurrentlyPlaying).mockResolvedValue({
      source: 'steam',
      steam_linked: true,
      steam_failed: false,
      games: [{ igdb_id: 1, name: 'Dota 2', cover_url: null, hours_last_two_weeks: 12.5 }],
    })
    render(<Dashboard />)

    expect(await screen.findByText('Recently played on Steam')).toBeTruthy()
    expect(screen.getByText('12.5 h in 2 weeks')).toBeTruthy()
  })

  it('shows hand-picked Playing games under Currently playing, without hours', async () => {
    vi.mocked(getTimeToBeatStats).mockResolvedValue(BASE)
    vi.mocked(getCurrentlyPlaying).mockResolvedValue({
      source: 'manual',
      steam_linked: false,
      steam_failed: false,
      games: [{ igdb_id: 1, name: 'Hades', cover_url: 'https://example.com/h.jpg' }],
    })
    render(<Dashboard />)

    expect(await screen.findByText('Currently playing')).toBeTruthy()
    expect(screen.getByAltText('Hades')).toBeTruthy()
    expect(screen.queryByText(/in 2 weeks/)).toBeNull()
  })

  it('explains how to fill the widget when there is nothing to show', async () => {
    vi.mocked(getTimeToBeatStats).mockResolvedValue(BASE)
    render(<Dashboard />)
    expect(await screen.findByText(/Connect your Steam account/)).toBeTruthy()
  })

  describe('refresh button', () => {
    const steamPlaying = (names: string[]): CurrentlyPlaying => ({
      source: 'steam',
      steam_linked: true,
      steam_failed: false,
      games: names.map((name, i) => ({ igdb_id: i + 1, name, cover_url: null, hours_last_two_weeks: 1 })),
    })

    it('is hidden until a Steam account has been linked', async () => {
      vi.mocked(getTimeToBeatStats).mockResolvedValue(BASE)
      render(<Dashboard />)
      await screen.findByText('Total hours played')
      expect(screen.queryByRole('button', { name: /Refresh from Steam/ })).toBeNull()
    })

    it('updates the recently played list', async () => {
      vi.mocked(getTimeToBeatStats).mockResolvedValue(BASE)
      vi.mocked(getCurrentlyPlaying).mockResolvedValue(steamPlaying(['Old Game']))
      // An answer without hours (as an older server sent) must still work.
      vi.mocked(refreshFromSteam).mockResolvedValue({ currently_playing: steamPlaying(['New Game']) } as RefreshResult)
      render(<Dashboard />)

      expect(await screen.findByText('Old Game')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /Refresh from Steam/ }))
      expect(await screen.findByText('New Game')).toBeTruthy()
      expect(screen.queryByText('Old Game')).toBeNull()
      expect(screen.getByText('Updated from Steam.')).toBeTruthy()
    })

    describe('hours', () => {
      const withHours = (hours: HoursRefresh) => ({ currently_playing: steamPlaying(['Alpha']), hours })

      async function pressRefresh() {
        vi.mocked(getTimeToBeatStats).mockResolvedValue(BASE)
        vi.mocked(getCurrentlyPlaying).mockResolvedValue(steamPlaying(['Alpha']))
        render(<Dashboard />)
        fireEvent.click(await screen.findByRole('button', { name: /Refresh from Steam/ }))
      }

      it('says how many games got new hours, and reads the totals again', async () => {
        vi.mocked(refreshFromSteam).mockResolvedValue(withHours({ status: 'ok', updated: 12 }))
        await pressRefresh()
        expect(await screen.findByText('Updated from Steam. Hours updated for 12 games.')).toBeTruthy()
        expect(vi.mocked(getTimeToBeatStats).mock.calls.length).toBeGreaterThanOrEqual(2)
      })

      it('uses the singular for one game', async () => {
        vi.mocked(refreshFromSteam).mockResolvedValue(withHours({ status: 'ok', updated: 1 }))
        await pressRefresh()
        expect(await screen.findByText('Updated from Steam. Hours updated for 1 game.')).toBeTruthy()
      })

      it('says when hours were already up to date, without reloading the totals', async () => {
        vi.mocked(refreshFromSteam).mockResolvedValue(withHours({ status: 'ok', updated: 0 }))
        await pressRefresh()
        expect(await screen.findByText('Updated from Steam. Hours were already up to date.')).toBeTruthy()
        expect(vi.mocked(getTimeToBeatStats)).toHaveBeenCalledTimes(1)
      })

      it('says when hours were checked recently', async () => {
        vi.mocked(refreshFromSteam).mockResolvedValue(withHours({ status: 'recent' }))
        await pressRefresh()
        expect(await screen.findByText(/Hours were checked a few minutes ago/)).toBeTruthy()
      })

      it('shows the reason when hours could not be updated, while recently played still updates', async () => {
        vi.mocked(refreshFromSteam).mockResolvedValue(
          withHours({ status: 'error', message: "We couldn't see that profile's games." })
        )
        await pressRefresh()
        expect(await screen.findByText(/Recently played is updated, but hours were not: We couldn't see/)).toBeTruthy()
      })
    })

    it('disables the button while it works', async () => {
      vi.mocked(getTimeToBeatStats).mockResolvedValue(BASE)
      vi.mocked(getCurrentlyPlaying).mockResolvedValue(steamPlaying(['Alpha']))
      let finish
      vi.mocked(refreshFromSteam).mockReturnValue(new Promise((resolve) => (finish = resolve)))
      render(<Dashboard />)

      fireEvent.click(await screen.findByRole('button', { name: /Refresh from Steam/ }))
      const busy = await screen.findByRole<HTMLButtonElement>('button', { name: /Refreshing/ })
      expect(busy.disabled).toBe(true)
      finish({ currently_playing: steamPlaying(['Alpha']) })
      await screen.findByRole('button', { name: /Refresh from Steam/ })
    })

    it('shows the server message when refreshing is refused', async () => {
      vi.mocked(getTimeToBeatStats).mockResolvedValue(BASE)
      vi.mocked(getCurrentlyPlaying).mockResolvedValue(steamPlaying(['Alpha']))
      vi.mocked(refreshFromSteam).mockRejectedValue(new Error('Refreshed a moment ago. Try again in a few seconds.'))
      render(<Dashboard />)

      fireEvent.click(await screen.findByRole('button', { name: /Refresh from Steam/ }))
      expect(await screen.findByText(/Refreshed a moment ago/)).toBeTruthy()
      expect(screen.getByText('Alpha')).toBeTruthy() // the old list stays
    })

    it("says so when Steam isn't responding", async () => {
      vi.mocked(getTimeToBeatStats).mockResolvedValue(BASE)
      vi.mocked(getCurrentlyPlaying).mockResolvedValue(steamPlaying(['Alpha']))
      vi.mocked(refreshFromSteam).mockResolvedValue({
        currently_playing: { source: 'manual', steam_linked: true, steam_failed: true, games: [] },
        hours: { status: 'recent' },
      })
      render(<Dashboard />)

      fireEvent.click(await screen.findByRole('button', { name: /Refresh from Steam/ }))
      expect(await screen.findByText(/Steam isn't responding/)).toBeTruthy()
    })
  })
})
