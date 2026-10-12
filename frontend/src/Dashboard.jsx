import { useEffect, useState } from 'react'
import { getTimeToBeatStats, getCurrentlyPlaying, setEstimateIncluded } from './api'

function formatHours(seconds) {
  if (seconds == null) return '—'
  if (!seconds) return '0 hours'
  return `${Math.round(seconds / 3600).toLocaleString()} hours`
}

function formatHoursPlayed(hours) {
  if (hours == null) return '—'
  return `${Math.round(hours).toLocaleString()} hours`
}

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [playing, setPlaying] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showLeftOut, setShowLeftOut] = useState(false)
  const [toggleError, setToggleError] = useState(null)

  useEffect(() => {
    Promise.all([getTimeToBeatStats(), getCurrentlyPlaying()])
      .then(([statsData, playingData]) => {
        setStats(statsData)
        setPlaying(playingData)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  async function toggleIncluded(game) {
    setToggleError(null)
    try {
      await setEstimateIncluded(game.igdb_id, !game.included)
      setStats(await getTimeToBeatStats())
    } catch (err) {
      setToggleError(err.message)
    }
  }

  if (loading) return <p>Loading stats...</p>
  if (error) return <p className="error">{error}</p>
  const overLimit = stats?.over_limit_games ?? []
  if (!stats || (stats.game_count === 0 && stats.completed_count === 0)) return null

  return (
    <div>
      <div className="dashboard">
        <div className="stat-card">
          <span className="stat-value">{stats.game_count}</span>
          <span className="stat-label">Games in progress or backlogged</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{formatHours(stats.total_main_story_seconds)}</span>
          <span className="stat-label">Time remaining (main story)</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{formatHours(stats.total_completionist_seconds)}</span>
          <span className="stat-label">Time remaining (100%)</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.completed_count}</span>
          <span className="stat-label">Games completed</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{formatHoursPlayed(stats.total_hours_played)}</span>
          <span className="stat-label">Total hours played</span>
        </div>
      </div>

      {stats.igdb_unavailable && (
        <p className="dashboard-note">Time estimates are temporarily unavailable. Everything else is up to date.</p>
      )}

      {(overLimit.length > 0 || stats.games_without_estimate > 0) && (
        <div className="dashboard-note">
          Time remaining leaves out{' '}
          {overLimit.length > 0 ? (
            <button
              type="button"
              className="link-button"
              aria-expanded={showLeftOut}
              onClick={() => setShowLeftOut((open) => !open)}
            >
              {stats.games_left_out} game{stats.games_left_out === 1 ? '' : 's'} with unrealistic estimates
            </button>
          ) : (
            <>0 games with unrealistic estimates</>
          )}{' '}
          (endless or multiplayer games) and {stats.games_without_estimate ?? 0} with no estimate on IGDB.
          {showLeftOut && (
            <ul className="left-out-list">
              {overLimit.map((game) => (
                <li key={game.igdb_id}>
                  <label>
                    <span className="left-out-name">{game.name}</span>
                    <span className="left-out-hours">
                      {formatHours(game.main_story_seconds)} main · {formatHours(game.completionist_seconds)} 100%
                    </span>
                    <input type="checkbox" checked={game.included} onChange={() => toggleIncluded(game)} />
                  </label>
                </li>
              ))}
            </ul>
          )}
          {showLeftOut && <span className="left-out-hint">Tick a game to count it in the time remaining.</span>}
          {toggleError && <span className="error"> {toggleError}</span>}
        </div>
      )}

      {playing.length > 0 && (
        <div className="currently-playing-widget">
          <h3 className="currently-playing-title">Currently Playing</h3>
          <div className="currently-playing-covers">
            {playing.map((game) => (
              <div key={game.igdb_id} className="currently-playing-item">
                {game.cover_url ? (
                  <img src={game.cover_url} alt={game.name} />
                ) : (
                  <div className="currently-playing-placeholder">{game.name}</div>
                )}
                <span className="currently-playing-name">{game.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
