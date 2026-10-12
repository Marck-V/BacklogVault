import { useEffect, useState } from 'react'
import { getGameDetails, updateGameEntry } from './api'
import { STATUSES } from './StatusBubble'

function formatDate(unixSeconds) {
  if (!unixSeconds) return 'Unknown'
  return new Date(unixSeconds * 1000).toLocaleDateString()
}

function formatHours(seconds) {
  if (!seconds) return 'Unknown'
  return `${Math.round(seconds / 3600)} hours`
}

const RATING_STATUSES = ['Completed', 'Dropped']

export default function GameDetailsModal({ game, listId, onClose, onUpdate }) {
  const [details, setDetails] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState(game.status)
  const [rating, setRating] = useState(game.rating ?? '')
  const [hoursPlayed, setHoursPlayed] = useState(game.hours_played ?? '')
  const [notes, setNotes] = useState(game.notes ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    getGameDetails(game.igdb_id)
      .then(setDetails)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [game.igdb_id])

  const showRating = RATING_STATUSES.includes(status)

  async function handleSave(overrides = {}) {
    const nextStatus = overrides.status ?? status
    setSaving(true)
    setError(null)
    try {
      const payload = {
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
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose}>
          &times;
        </button>
        <h2>{game.name}</h2>
        {game.cover_url && <img className="modal-cover" src={game.cover_url} alt={game.name} />}

        <label className="status-label">
          Status:{' '}
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              handleSave({ status: e.target.value })
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
            value={notes}
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => handleSave()}
          />
        </label>

        {saving && <p className="status-ok">Saving...</p>}
        {loading && <p>Loading details...</p>}
        {error && <p className="error">{error}</p>}

        {details && (
          <dl className="details-list">
            <dt>Developer</dt>
            <dd>{details.developer ?? 'Unknown'}</dd>

            <dt>Release Date</dt>
            <dd>{formatDate(details.first_release_date)}</dd>

            <dt>Time to Beat (Main Story)</dt>
            <dd>{formatHours(details.time_to_beat_main_seconds)}</dd>

            <dt>Time to Beat (100%)</dt>
            <dd>{formatHours(details.time_to_beat_completionist_seconds)}</dd>
          </dl>
        )}
      </div>
    </div>
  )
}
