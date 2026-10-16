import { useEffect, useId, useState } from 'react'
import { getGameAchievements, getGameDetails, updateGameEntry, type GameEntryUpdate } from './api'
import Modal from './Modal'
import { STATUSES } from './statuses'
import { ExternalLink, X } from 'lucide-react'
import { errorMessage } from './errors'
import type { AchievementResult, GameDetails, GameStatus, ListGame } from '../../shared/api.ts'

function formatDate(unixSeconds: number | null): string {
  if (!unixSeconds) return 'Unknown'
  return new Date(unixSeconds * 1000).toLocaleDateString()
}

function formatHours(seconds: number | null): string {
  if (!seconds) return 'Unknown'
  return `${Math.round(seconds / 3600)}\u00a0hours`
}

const RATING_STATUSES: GameStatus[] = ['Completed', 'Dropped']

function AchievementsLine({ achievements }: { achievements: AchievementResult | null }) {
  if (achievements?.status === 'private') {
    return (
      <>
        <dt>Steam Achievements</dt>
        <dd>
          We can&apos;t see them. In Steam, set your profile&apos;s Game details to Public, then open this game again.
        </dd>
      </>
    )
  }
  if (achievements?.status !== 'ok') return null
  const percent = Math.round((achievements.unlocked / achievements.total) * 100)
  return (
    <>
      <dt>Steam Achievements</dt>
      <dd>
        {achievements.unlocked} of {achievements.total} unlocked ({percent}%)
        <progress
          className="achievement-bar"
          value={achievements.unlocked}
          max={achievements.total}
          aria-label="Steam achievements unlocked"
        />
      </dd>
    </>
  )
}

interface GameDetailsModalProps {
  game: ListGame
  listId: number | string
  onClose: () => void
  onUpdate?: (game: Partial<ListGame>) => void
}

export default function GameDetailsModal({ game, listId, onClose, onUpdate }: GameDetailsModalProps) {
  const [details, setDetails] = useState<GameDetails | null>(null)
  const [achievements, setAchievements] = useState<AchievementResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState(game.status)
  // The number fields hold what is typed (text) until it is saved.
  const [rating, setRating] = useState<number | string>(game.rating ?? '')
  const [hoursPlayed, setHoursPlayed] = useState<number | string>(game.hours_played ?? '')
  const [notes, setNotes] = useState(game.notes ?? '')
  const [saving, setSaving] = useState(false)
  const titleId = useId()

  useEffect(() => {
    setLoading(true)
    setError(null)
    getGameDetails(game.igdb_id)
      .then(setDetails)
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false))
  }, [game.igdb_id])

  // Separate from the details: it asks Steam, so it can be slower, and a failure must not hide everything else.
  useEffect(() => {
    setAchievements(null)
    let current = true
    getGameAchievements(game.igdb_id)
      .then((result) => current && setAchievements(result))
      .catch(() => {})
    return () => {
      current = false
    }
  }, [game.igdb_id])

  const showRating = RATING_STATUSES.includes(status)

  async function handleSave(overrides: { status?: GameStatus } = {}) {
    const nextStatus = overrides.status ?? status
    setSaving(true)
    setError(null)
    try {
      const payload: GameEntryUpdate = {
        status: nextStatus,
        hoursPlayed: hoursPlayed === '' ? null : Number(hoursPlayed),
        notes: notes === '' ? null : notes,
      }
      if (RATING_STATUSES.includes(nextStatus)) {
        payload.rating = rating === '' ? null : Number(rating)
      }
      const updated = await updateGameEntry(listId, game.id, payload)
      setStatus(updated.status)
      setRating(updated.rating ?? '')
      setHoursPlayed(updated.hours_played ?? '')
      setNotes(updated.notes ?? '')
      onUpdate?.(updated)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} labelledBy={titleId}>
      <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
        <X size={16} aria-hidden="true" />
      </button>
      <h2 id={titleId} translate="no">
        {game.name}
      </h2>
      {game.cover_url && <img className="modal-cover" src={game.cover_url} alt={game.name} width="160" height="213" />}

      <label className="status-label">
        Status:{' '}
        <select
          value={status}
          onChange={(e) => {
            // The options are exactly STATUSES, so the value is always one of them.
            const next = e.target.value as GameStatus
            setStatus(next)
            handleSave({ status: next })
          }}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      {showRating && (
        <label className="field-label">
          Rating (1-10):
          <input
            type="number"
            name="rating"
            autoComplete="off"
            min="1"
            max="10"
            value={rating}
            onChange={(e) => setRating(e.target.value)}
            onBlur={() => handleSave()}
          />
        </label>
      )}

      <label className="field-label">
        Hours played:
        <input
          type="number"
          name="hoursPlayed"
          autoComplete="off"
          min="0"
          max="100000"
          step="0.5"
          value={hoursPlayed}
          onChange={(e) => setHoursPlayed(e.target.value)}
          onBlur={() => handleSave()}
        />
      </label>

      <label className="field-label">
        Notes:
        <textarea
          name="notes"
          autoComplete="off"
          value={notes}
          maxLength={2000}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => handleSave()}
        />
      </label>

      {saving && (
        <p className="status-ok" role="status">
          Saving…
        </p>
      )}
      {loading && <p role="status">Loading details…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {details && (
        <dl className="details-list">
          <dt>Developer</dt>
          <dd>{details.developer ?? 'Unknown'}</dd>

          <dt>Release Date</dt>
          <dd>{formatDate(details.first_release_date)}</dd>

          <dt>Age Rating</dt>
          <dd>
            {details.age_ratings?.length
              ? details.age_ratings.map((r) => `${r.organization} ${r.rating}`).join(' · ')
              : 'Not listed'}
          </dd>

          <dt>Full Audio</dt>
          <dd>{details.audio_languages?.length ? details.audio_languages.join(', ') : 'Not listed'}</dd>

          <dt>Time to Beat (Main Story)</dt>
          <dd>{formatHours(details.time_to_beat_main_seconds)}</dd>

          <dt>Time to Beat (100%)</dt>
          <dd>{formatHours(details.time_to_beat_completionist_seconds)}</dd>

          <AchievementsLine achievements={achievements} />

          {details.store_links?.length > 0 && (
            <>
              <dt>Find It On</dt>
              <dd>
                <ul className="store-links">
                  {details.store_links.map((link) => (
                    <li key={link.key}>
                      <a href={link.url} target="_blank" rel="noopener noreferrer">
                        {link.label}
                        <ExternalLink size={13} aria-hidden="true" />
                        <span className="visually-hidden"> (opens in a new tab)</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
        </dl>
      )}
    </Modal>
  )
}
