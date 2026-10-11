import { useEffect, useState } from 'react'
import { getTimeToBeatStats, getCurrentlyPlaying } from './api'

function formatHours(seconds) {
  if (seconds == null) return '—'
  if (!seconds) return '0 hours'
  return `${Math.round(seconds / 3600).toLocaleString()} hours`
}

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [playing, setPlaying] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getTimeToBeatStats(), getCurrentlyPlaying()])
      .then(([statsData, playingData]) => {
        setStats(statsData)
        setPlaying(playingData)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p>Loading stats...</p>
  if (error) return <p className="error">{error}</p>
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
      </div>

      {stats.igdb_unavailable && (
        <p className="dashboard-note">Time estimates are temporarily unavailable. Everything else is up to date.</p>
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
