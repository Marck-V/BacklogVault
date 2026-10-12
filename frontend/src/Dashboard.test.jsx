import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('./api', () => ({ getTimeToBeatStats: vi.fn(), getCurrentlyPlaying: vi.fn(), setEstimateIncluded: vi.fn() }))

import Dashboard from './Dashboard'
import { getTimeToBeatStats, getCurrentlyPlaying, setEstimateIncluded } from './api'

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

beforeEach(() => {
  vi.mocked(getCurrentlyPlaying).mockResolvedValue([])
})

describe('Dashboard', () => {
  it('shows total hours played', async () => {
    vi.mocked(getTimeToBeatStats).mockResolvedValue(BASE)
    render(<Dashboard />)
    expect(await screen.findByText('1,234 hours')).toBeTruthy()
    expect(screen.getByText('Total hours played')).toBeTruthy()
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
})
