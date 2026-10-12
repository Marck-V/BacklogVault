import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('./api', () => ({
  getTimeToBeatStats: vi.fn(),
  getCurrentlyPlaying: vi.fn(),
  getGenreBreakdown: vi.fn(),
  refreshFromSteam: vi.fn(),
  setEstimateIncluded: vi.fn(),
}))

import Dashboard from './Dashboard'
import { getTimeToBeatStats, getCurrentlyPlaying, getGenreBreakdown, setEstimateIncluded, refreshFromSteam } from './api'

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

const GAME = { igdb_id: 9, name: 'VRChat', main_story_seconds: 180018000, completionist_seconds: 190000000, included: false }

afterEach(cleanup)

beforeEach(() => {
  vi.mocked(getCurrentlyPlaying).mockResolvedValue({ source: 'manual', games: [] })
  vi.mocked(getGenreBreakdown).mockResolvedValue({ game_count: 0, genres: [], games_without_genre: 0 })
})

describe('Dashboard', () => {
  it('shows total hours played', async () => {
    vi.mocked(getTimeToBeatStats).mockResolvedValue(BASE)
    render(<Dashboard />)
    const label = await screen.findByText('Total hours played')
    const card = label.closest('.stat-card')
    expect(card.querySelector('.stat-number').textContent).toBe('1,234')
    expect(card.querySelector('.stat-unit').textContent).toBe('hours')
    expect(screen.queryByText(/leaves out/)).toBeNull()
  })

  it('says how many games were left out of the time remaining', async () => {
    vi.mocked(getTimeToBeatStats).mockResolvedValue({ ...BASE, games_left_out: 1, games_without_estimate: 70, over_limit_games: [GAME] })
    render(<Dashboard />)
    expect(await screen.findByText(/leaves out/)).toBeTruthy()
    expect(screen.getByText(/70 with no\s+estimate/)).toBeTruthy()
  })

  it('opens the left-out games on click and lets you count one', async () => {
    const withGame = { ...BASE, games_left_out: 1, over_limit_games: [GAME] }
    vi.mocked(getTimeToBeatStats).mockResolvedValue(withGame)
    vi.mocked(setEstimateIncluded).mockResolvedValue({})
    render(<Dashboard />)

    expect(screen.queryByText('VRChat')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: /1 game with unrealistic estimates/ }))
    const box = screen.getByRole('checkbox')
    expect(screen.getByText('VRChat')).toBeTruthy()
    expect(box.checked).toBe(false)

    vi.mocked(getTimeToBeatStats).mockResolvedValue({
      ...withGame,
      games_left_out: 0,
      over_limit_games: [{ ...GAME, included: true }],
    })
    fireEvent.click(box)
    await waitFor(() => expect(screen.getByRole('checkbox').checked).toBe(true))
    expect(setEstimateIncluded).toHaveBeenCalledWith(9, true)
  })

  it('draws the genre breakdown with a count for each genre', async () => {
    vi.mocked(getTimeToBeatStats).mockResolvedValue(BASE)
    vi.mocked(getGenreBreakdown).mockResolvedValue({
      game_count: 12,
      genres: [
        { name: 'RPG', count: 7 },
        { name: 'Shooter', count: 4 },
        { name: 'Other', count: 2 },
      ],
      games_without_genre: 3,
    })
    render(<Dashboard />)

    expect(await screen.findByText('RPG')).toBeTruthy()
    expect(screen.getByText('Shooter')).toBeTruthy()
    expect(screen.getByText('7')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Your library by genre' })).toBeTruthy()
    expect(screen.getByText(/3 have no genre on IGDB/)).toBeTruthy()
  })

  it('says so when genres are unavailable, and keeps the rest of the dashboard', async () => {
    vi.mocked(getTimeToBeatStats).mockResolvedValue(BASE)
    vi.mocked(getGenreBreakdown).mockResolvedValue({ igdb_unavailable: true, game_count: null, genres: [] })
    render(<Dashboard />)

    expect(await screen.findByText(/Genres are temporarily unavailable/)).toBeTruthy()
    expect(screen.getByText('Total hours played')).toBeTruthy()
  })

  it('survives the genre request failing outright', async () => {
    vi.mocked(getTimeToBeatStats).mockResolvedValue(BASE)
    vi.mocked(getGenreBreakdown).mockRejectedValue(new Error('network'))
    render(<Dashboard />)

    expect(await screen.findByText(/genre chart couldn't be loaded/)).toBeTruthy()
    expect(screen.getByText('Total hours played')).toBeTruthy()
  })

  it('shows recently played Steam games with their two-week hours', async () => {
    vi.mocked(getTimeToBeatStats).mockResolvedValue(BASE)
    vi.mocked(getCurrentlyPlaying).mockResolvedValue({
      source: 'steam',
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
    expect(await screen.findByText(/Import your Steam library/)).toBeTruthy()
  })

  describe('refresh button', () => {
    const steamPlaying = (names) => ({
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
      vi.mocked(refreshFromSteam).mockResolvedValue({ currently_playing: steamPlaying(['New Game']) })
      render(<Dashboard />)

      expect(await screen.findByText('Old Game')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /Refresh from Steam/ }))
      expect(await screen.findByText('New Game')).toBeTruthy()
      expect(screen.queryByText('Old Game')).toBeNull()
      expect(screen.getByText('Updated from Steam.')).toBeTruthy()
    })

    it('disables the button while it works', async () => {
      vi.mocked(getTimeToBeatStats).mockResolvedValue(BASE)
      vi.mocked(getCurrentlyPlaying).mockResolvedValue(steamPlaying(['Alpha']))
      let finish
      vi.mocked(refreshFromSteam).mockReturnValue(new Promise((resolve) => (finish = resolve)))
      render(<Dashboard />)

      fireEvent.click(await screen.findByRole('button', { name: /Refresh from Steam/ }))
      const busy = await screen.findByRole('button', { name: /Refreshing/ })
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
      })
      render(<Dashboard />)

      fireEvent.click(await screen.findByRole('button', { name: /Refresh from Steam/ }))
      expect(await screen.findByText(/Steam isn't responding/)).toBeTruthy()
    })
  })
})
