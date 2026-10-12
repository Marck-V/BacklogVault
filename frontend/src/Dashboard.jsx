import { useEffect, useState } from 'react'
import { getTimeToBeatStats, getCurrentlyPlaying, getGenreBreakdown, setEstimateIncluded, refreshFromSteam } from './api'

function formatHours(seconds) {
  if (seconds == null) return '—'
  if (!seconds) return '0 hours'
  return `${Math.round(seconds / 3600).toLocaleString()}\u00a0hours`
}

function formatHoursPlayed(hours) {
  if (hours == null) return '—'
  return `${Math.round(hours).toLocaleString()}\u00a0hours`
}

// Colours for the genre chart, in order of size. "Other" always gets the last, neutral one.
const GENRE_COLORS = ['#4fd1b5', '#ff5c8a', '#7aa2ff', '#f5b94f', '#b58cff', '#5fd3ff', '#9be564']
const OTHER_COLOR = '#6b7889'
const colorFor = (genre, index) => (genre.name === 'Other' ? OTHER_COLOR : GENRE_COLORS[index % GENRE_COLORS.length])

const DONUT_RADIUS = 54
const DONUT_LENGTH = 2 * Math.PI * DONUT_RADIUS

function GenreDonut({ genres, gameCount }) {
  const total = genres.reduce((sum, genre) => sum + genre.count, 0)
  let offset = 0
  return (
    <svg className="genre-donut" viewBox="0 0 140 140" role="img" aria-label="Your library by genre">
      <circle cx="70" cy="70" r={DONUT_RADIUS} className="genre-donut-track" />
      {genres.map((genre, index) => {
        const length = (genre.count / total) * DONUT_LENGTH
        const segment = (
          <circle
            key={genre.name}
            cx="70"
            cy="70"
            r={DONUT_RADIUS}
            className="genre-donut-segment"
            stroke={colorFor(genre, index)}
            strokeDasharray={`${Math.max(length - 1.5, 0)} ${DONUT_LENGTH}`}
            strokeDashoffset={-offset}
          />
        )
        offset += length
        return segment
      })}
      <text x="70" y="68" textAnchor="middle" className="genre-donut-number">
        {gameCount.toLocaleString()}
      </text>
      <text x="70" y="86" textAnchor="middle" className="genre-donut-caption">
        games
      </text>
    </svg>
  )
}

function GenrePanel({ breakdown }) {
  let body
  if (!breakdown) {
    body = <p className="panel-empty">The genre chart couldn&apos;t be loaded.</p>
  } else if (breakdown.igdb_unavailable) {
    body = <p className="panel-empty">Genres are temporarily unavailable. Everything else is up to date.</p>
  } else if (breakdown.genres.length === 0) {
    body = <p className="panel-empty">No genre information for your games yet.</p>
  } else {
    body = (
      <>
        <div className="genre-body">
          <GenreDonut genres={breakdown.genres} gameCount={breakdown.game_count} />
          <ul className="genre-legend">
            {breakdown.genres.map((genre, index) => (
              <li key={genre.name}>
                <span className="genre-dot" style={{ background: colorFor(genre, index) }} />
                <span className="genre-name">{genre.name}</span>
                <span className="genre-count">{genre.count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="panel-footnote">
          A game can have several genres, so it can count in more than one.
          {breakdown.games_without_genre > 0 && ` ${breakdown.games_without_genre.toLocaleString()} have no genre on IGDB.`}
        </p>
      </>
    )
  }
  return (
    <section className="panel" aria-labelledby="genre-title">
      <h3 className="panel-title" id="genre-title">
        Genres
      </h3>
      {body}
    </section>
  )
}

function PlayingPanel({ playing }) {
  const fromSteam = playing.source === 'steam'
  return (
    <section className="panel" aria-labelledby="playing-title">
      <h3 className="panel-title" id="playing-title">
        {fromSteam ? 'Recently played on Steam' : 'Currently playing'}
      </h3>
      {playing.games.length === 0 ? (
        <p className="panel-empty">
          Nothing here yet. Import your Steam library to see what you played in the last two weeks, or set a game&apos;s
          status to Playing.
        </p>
      ) : (
        <div className="currently-playing-covers">
          {playing.games.map((game) => (
            <div key={game.igdb_id} className="currently-playing-item">
              {game.cover_url ? (
                <img src={game.cover_url} alt={game.name} width="104" height="139" loading="lazy" decoding="async" />
              ) : (
                <div className="currently-playing-placeholder" aria-hidden="true">
                  {game.name.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="currently-playing-name" translate="no">
                {game.name}
              </span>
              {fromSteam && game.hours_last_two_weeks > 0 && (
                <span className="currently-playing-hours">{`${game.hours_last_two_weeks.toLocaleString()}\u00a0h in 2 weeks`}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [playing, setPlaying] = useState({ source: 'manual', games: [] })
  const [breakdown, setBreakdown] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showLeftOut, setShowLeftOut] = useState(false)
  const [toggleError, setToggleError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState(null)

  useEffect(() => {
    // The hour totals are the main event; the two extra panels may fail without taking the dashboard down.
    Promise.all([
      getTimeToBeatStats(),
      getCurrentlyPlaying().catch(() => ({ source: 'manual', games: [] })),
      getGenreBreakdown().catch(() => null),
    ])
      .then(([statsData, playingData, genreData]) => {
        setStats(statsData)
        setPlaying(playingData)
        setBreakdown(genreData)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  // Re-reads the small, fast-changing bits from Steam. For now that is the recently played list.
  async function handleRefresh() {
    setRefreshing(true)
    setRefreshMessage(null)
    try {
      const result = await refreshFromSteam()
      setPlaying(result.currently_playing)
      setRefreshMessage(
        result.currently_playing.steam_failed
          ? { error: true, text: "Steam isn't responding right now, so nothing was updated." }
          : { text: 'Updated from Steam.' }
      )
    } catch (err) {
      setRefreshMessage({ error: true, text: err.message })
    } finally {
      setRefreshing(false)
    }
  }

  async function toggleIncluded(game) {
    setToggleError(null)
    try {
      await setEstimateIncluded(game.igdb_id, !game.included)
      setStats(await getTimeToBeatStats())
    } catch (err) {
      setToggleError(err.message)
    }
  }

  const overLimit = stats?.over_limit_games ?? []
  if (loading) return <p role="status">Loading stats…</p>
  if (error) {
    return (
      <p className="error" role="alert">
        {error}
      </p>
    )
  }
  if (!stats || (stats.game_count === 0 && stats.completed_count === 0)) return null

  return (
    <div>
      {playing.steam_linked && (
        <div className="dashboard-toolbar">
          {refreshMessage && (
            <span className={refreshMessage.error ? 'error' : 'refresh-ok'} role="status">
              {refreshMessage.text}
            </span>
          )}
          <button type="button" className="refresh-btn" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : '↻ Refresh from Steam'}
          </button>
        </div>
      )}

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

      <div className="dashboard-panels">
        <GenrePanel breakdown={breakdown} />
        <PlayingPanel playing={playing} />
      </div>
    </div>
  )
}
