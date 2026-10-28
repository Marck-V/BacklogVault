import { useEffect, useState } from 'react'
import { getTimeToBeatStats, getCurrentlyPlaying, getBreakdown, setEstimateIncluded, refreshFromSteam } from './api'
import { ChartPie, Gamepad2, RefreshCw } from 'lucide-react'
import { errorMessage } from './errors'
import type { Notice } from './types'
import type {
  BreakdownCategoryName,
  BreakdownItem,
  BreakdownResponse,
  CurrentlyPlaying,
  HoursRefresh,
  TimeToBeatRefresh,
  OverLimitGame,
  PlayingGame,
  TimeToBeatStats,
} from '../../shared/api.ts'

// What the playing panel shows before anything has loaded, or when it could not load.
const NO_PLAYING: CurrentlyPlaying = { source: 'manual', steam_linked: false, steam_failed: false, games: [] }

function formatHours(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  if (!seconds) return '0 hours'
  return `${Math.round(seconds / 3600).toLocaleString()}\u00a0hours`
}

// A big number with a small "hours" beside it. If the card is too narrow for both, the unit drops to its own line as a
// whole word instead of being split in the middle.
function HoursValue({ hours }: { hours: number | null | undefined }) {
  if (hours == null) return <span className="stat-value">—</span>
  return (
    <span className="stat-value">
      <span className="stat-number">{Math.round(hours).toLocaleString()}</span>{' '}
      <span className="stat-unit">hours</span>
    </span>
  )
}

// Colours for the genre chart, in order of size. "Other" always gets the last, neutral one.
const GENRE_COLORS = ['#4fd1b5', '#ff5c8a', '#7aa2ff', '#f5b94f', '#b58cff', '#5fd3ff', '#9be564']
const OTHER_COLOR = '#6b7889'
const colorFor = (genre: BreakdownItem, index: number) => (genre.name === 'Other' ? OTHER_COLOR : GENRE_COLORS[index % GENRE_COLORS.length])

const DONUT_RADIUS = 54
const DONUT_LENGTH = 2 * Math.PI * DONUT_RADIUS

function GenreDonut({ genres, gameCount, label }: { genres: BreakdownItem[]; gameCount: number; label: string }) {
  const total = genres.reduce((sum, genre) => sum + genre.count, 0)
  let offset = 0
  return (
    <svg className="genre-donut" viewBox="0 0 140 140" role="img" aria-label={label}>
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

// What each tab of the breakdown panel shows. `what` fills the sentences, `without` says what a game with none is missing.
interface BreakdownView {
  key: BreakdownCategoryName
  label: string
  what: string
  several: string
  without: string
}

const BREAKDOWN_VIEWS: BreakdownView[] = [
  { key: 'genres', label: 'Genres', what: 'genre', several: 'genres', without: 'no genre' },
  { key: 'themes', label: 'Themes', what: 'theme', several: 'themes', without: 'no theme' },
  { key: 'modes', label: 'Game modes', what: 'game mode', several: 'modes', without: 'no game mode' },
]
const VIEW_STORAGE_KEY = 'bv_breakdown_view'

function readSavedView(): BreakdownCategoryName {
  try {
    const saved = localStorage.getItem(VIEW_STORAGE_KEY)
    return BREAKDOWN_VIEWS.find((view) => view.key === saved)?.key ?? 'genres'
  } catch {
    return 'genres'
  }
}

function BreakdownPanel({ breakdown }: { breakdown: BreakdownResponse | null }) {
  const [viewKey, setViewKey] = useState<BreakdownCategoryName>(readSavedView)
  const view = BREAKDOWN_VIEWS.find((v) => v.key === viewKey) ?? BREAKDOWN_VIEWS[0]!
  const unavailable = breakdown !== null && 'igdb_unavailable' in breakdown
  const data = breakdown && !('igdb_unavailable' in breakdown) ? breakdown[viewKey] : undefined
  const items = data?.items ?? []

  function chooseView(key: BreakdownCategoryName) {
    setViewKey(key)
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, key)
    } catch {
      // Storage can be blocked; the panel then just starts on Genres next time.
    }
  }

  let body
  if (!breakdown) {
    body = <p className="panel-empty">The library breakdown couldn&apos;t be loaded.</p>
  } else if (unavailable) {
    body = <p className="panel-empty">This is temporarily unavailable. Everything else is up to date.</p>
  } else if (items.length === 0) {
    body = <p className="panel-empty">IGDB has no {view.what} information for your games yet.</p>
  } else {
    body = (
      <>
        <div className="genre-body">
          <GenreDonut genres={items} gameCount={breakdown.game_count ?? 0} label={`Your library by ${view.what}`} />
          <ul className="genre-legend">
            {items.map((item, index) => (
              <li key={item.name}>
                <span className="genre-dot" style={{ background: colorFor(item, index) }} />
                <span className="genre-name">{item.name}</span>
                <span className="genre-count">{item.count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="panel-footnote">
          A game can have several {view.several}, so it can count in more than one.
          {data && data.without > 0 && ` ${data.without.toLocaleString()} have ${view.without} on IGDB.`}
          {breakdown && 'not_loaded' in breakdown && breakdown.not_loaded
            ? ` IGDB isn't responding, so ${breakdown.not_loaded.toLocaleString()} newer ${breakdown.not_loaded === 1 ? 'game is' : 'games are'} left out for now.`
            : ''}
        </p>
      </>
    )
  }

  return (
    <section className="panel" aria-labelledby="breakdown-title">
      <div className="panel-header">
        <h3 className="panel-title" id="breakdown-title">
          <ChartPie size={16} aria-hidden="true" />
          <span>Library breakdown</span>
        </h3>
        <div className="view-toggle" role="group" aria-label="Break the library down by">
          {BREAKDOWN_VIEWS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`view-toggle-btn ${viewKey === option.key ? 'active' : ''}`}
              aria-pressed={viewKey === option.key}
              onClick={() => chooseView(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {body}
    </section>
  )
}

// More games than this fold into a "Show more" toggle, so the panel does not keep growing taller than its neighbour.
const PLAYING_VISIBLE = 6

function PlayingPanel({ playing }: { playing: CurrentlyPlaying }) {
  const fromSteam = playing.source === 'steam'
  const [expanded, setExpanded] = useState(false)
  const hidden = Math.max(playing.games.length - PLAYING_VISIBLE, 0)
  const shown = expanded ? playing.games : playing.games.slice(0, PLAYING_VISIBLE)
  return (
    <section className="panel" aria-labelledby="playing-title">
      <h3 className="panel-title" id="playing-title">
        <Gamepad2 size={16} aria-hidden="true" />
        <span>{fromSteam ? 'Recently played on Steam' : 'Currently playing'}</span>
      </h3>
      {playing.games.length === 0 ? (
        <p className="panel-empty">
          Nothing here yet. Connect your Steam account (under Import from Steam on any list page) to see what you played
          in the last two weeks, or set a game&apos;s status to Playing.
        </p>
      ) : (
        <div className="currently-playing-covers" id="playing-games">
          {shown.map((game) => (
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
              {fromSteam && playedLabel(game) && <span className="currently-playing-hours">{playedLabel(game)}</span>}
            </div>
          ))}
        </div>
      )}
      {hidden > 0 && (
        <button
          type="button"
          className="link-button currently-playing-more"
          aria-expanded={expanded}
          aria-controls="playing-games"
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? 'Show fewer' : `Show ${hidden} more`}
        </button>
      )}
      {playing.stale_since && (
        <p className="panel-footnote">
          Steam isn&apos;t responding, so this is the list from{' '}
          {new Date(playing.stale_since).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.
        </p>
      )}
    </section>
  )
}

// Playtime of a recently played game: whole minutes when it is under an hour, otherwise hours. Null when there is none.
function playedLabel(game: PlayingGame): string | null {
  const minutes = game.minutes_last_two_weeks ?? Math.round((game.hours_last_two_weeks ?? 0) * 60)
  if (minutes <= 0) return null
  if (minutes < 60) return `${minutes} min in 2 weeks`
  return `${(game.hours_last_two_weeks ?? Math.round(minutes / 6) / 10).toLocaleString()} h in 2 weeks`
}

function refreshSummary(hours: HoursRefresh | undefined, timeToBeat?: TimeToBeatRefresh): Notice {
  if (timeToBeat?.status === 'ok' && timeToBeat.updated > 0 && hours?.status !== 'error') {
    const estimates = `${timeToBeat.updated} ${timeToBeat.updated === 1 ? 'game has' : 'games have'} a new time to beat.`
    const base = refreshSummary(hours)
    return { text: `${base.text} ${estimates}` }
  }
  if (hours?.status === 'ok') {
    return {
      text:
        hours.updated > 0
          ? `Updated from Steam. Hours updated for ${hours.updated} ${hours.updated === 1 ? 'game' : 'games'}.`
          : 'Updated from Steam. Hours were already up to date.',
    }
  }
  if (hours?.status === 'recent') {
    return { text: 'Updated from Steam. Hours were checked a few minutes ago, so they were left as they are.' }
  }
  if (hours?.status === 'error') {
    return { error: true, text: `Recently played is updated, but hours were not: ${hours.message}` }
  }
  return { text: 'Updated from Steam.' }
}

export default function Dashboard() {
  const [stats, setStats] = useState<TimeToBeatStats | null>(null)
  const [playing, setPlaying] = useState<CurrentlyPlaying>(NO_PLAYING)
  const [breakdown, setBreakdown] = useState<BreakdownResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showLeftOut, setShowLeftOut] = useState(false)
  const [toggleError, setToggleError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<Notice | null>(null)

  useEffect(() => {
    // The hour totals are the main event; the two extra panels may fail without taking the dashboard down.
    Promise.all([
      getTimeToBeatStats(),
      getCurrentlyPlaying().catch(() => NO_PLAYING),
      getBreakdown().catch(() => null),
    ])
      .then(([statsData, playingData, genreData]) => {
        setStats(statsData)
        setPlaying(playingData)
        setBreakdown(genreData)
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false))
  }, [])

  // Re-reads the small, fast-changing bits from Steam: the recently played list, and the hours of games already in the
  // library. The message says what changed, so a different hours total is never a mystery.
  async function handleRefresh() {
    setRefreshing(true)
    setRefreshMessage(null)
    try {
      const result = await refreshFromSteam()
      setPlaying(result.currently_playing)
      if (result.currently_playing.steam_failed) {
        setRefreshMessage({ error: true, text: "Steam isn't responding right now, so nothing was updated." })
      } else {
        setRefreshMessage(refreshSummary(result.hours, result.time_to_beat))
        // New hours or new time-to-beat estimates change the totals on this page, so read them again.
        const hoursChanged = result.hours?.status === 'ok' && result.hours.updated > 0
        const estimatesChanged = result.time_to_beat?.status === 'ok' && result.time_to_beat.updated > 0
        if (hoursChanged || estimatesChanged) {
          getTimeToBeatStats()
            .then(setStats)
            .catch(() => {})
        }
      }
    } catch (err) {
      setRefreshMessage({ error: true, text: errorMessage(err) })
    } finally {
      setRefreshing(false)
    }
  }

  async function toggleIncluded(game: OverLimitGame) {
    setToggleError(null)
    try {
      await setEstimateIncluded(game.igdb_id, !game.included)
      setStats(await getTimeToBeatStats())
    } catch (err) {
      setToggleError(errorMessage(err))
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
            <RefreshCw size={15} aria-hidden="true" className={refreshing ? 'spin' : undefined} />
            {refreshing ? 'Refreshing…' : 'Refresh from Steam'}
          </button>
        </div>
      )}

      <div className="dashboard">
        <div className="stat-card">
          <span className="stat-label">Games in progress or backlogged</span>
          <span className="stat-value">{stats.game_count}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Time remaining (main story)</span>
          <HoursValue hours={stats.total_main_story_seconds == null ? null : stats.total_main_story_seconds / 3600} />
        </div>
        <div className="stat-card">
          <span className="stat-label">Time remaining (100%)</span>
          <HoursValue hours={stats.total_completionist_seconds == null ? null : stats.total_completionist_seconds / 3600} />
        </div>
        <div className="stat-card">
          <span className="stat-label">Total hours played</span>
          <HoursValue hours={stats.total_hours_played} />
        </div>
        <div className="stat-card">
          <span className="stat-label">Games completed</span>
          <span className="stat-value">{stats.completed_count}</span>
        </div>
      </div>

      {stats.igdb_unavailable && (
        <p className="dashboard-note">Time estimates are temporarily unavailable. Everything else is up to date.</p>
      )}

      {(overLimit.length > 0 || (stats.games_without_estimate ?? 0) > 0) && (
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
                    {/* Two right-aligned columns, so the numbers line up from row to row. IGDB sends 0 when it has no
                        100% estimate, which is shown as a dash rather than a misleading "0 hours". */}
                    <span className="left-out-hours">
                      <span>{formatHours(game.main_story_seconds)} main</span>
                      <span className="left-out-sep" aria-hidden="true">
                        {' · '}
                      </span>
                      <span>{game.completionist_seconds ? formatHours(game.completionist_seconds) : '—'} 100%</span>
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
        <BreakdownPanel breakdown={breakdown} />
        <PlayingPanel playing={playing} />
      </div>
    </div>
  )
}
