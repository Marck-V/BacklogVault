import { useEffect, useId, useState } from 'react'
import { getGameDetails, updateGameEntry } from './api'
import Modal from './Modal'
import { STATUSES } from './statuses'
import { X } from 'lucide-react'

function formatDate(unixSeconds) {
  if (!unixSeconds) return 'Unknown'
  return new Date(unixSeconds * 1000).toLocaleDateString()
}

function formatHours(seconds) {
  if (!seconds) return 'Unknown'
  return `${Math.round(seconds / 3600)}\u00a0hours`
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
  const titleId = useId()

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

          <dt>Time to Beat (Main Story)</dt>
          <dd>{formatHours(details.time_to_beat_main_seconds)}</dd>

          <dt>Time to Beat (100%)</dt>
          <dd>{formatHours(details.time_to_beat_completionist_seconds)}</dd>
        </dl>
      )}
    </Modal>
  )
}
