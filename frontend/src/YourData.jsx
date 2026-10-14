import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Download, Trash2, Upload } from 'lucide-react'
import { BACKUP_URL, deleteMyData, restoreBackup } from './api'
import { useAuth } from './auth'
import ConfirmDialog from './ConfirmDialog'

// The same limit as the server (4 MB), checked here so a huge file is refused before it is read.
const MAX_BACKUP_BYTES = 4 * 1024 * 1024
const plural = (count, one, many) => (count === 1 ? one : many)

function RestoreSummary({ result }) {
  const { lists_created, games_added, games_already_there, games_skipped, games_over_limit } = result
  return (
    <div className="restore-summary" role="status">
      <p>
        <strong>
          Restored {games_added} {plural(games_added, 'game', 'games')}
        </strong>{' '}
        into {lists_created} new {plural(lists_created, 'list', 'lists')}.
      </p>
      {games_already_there > 0 && (
        <p>
          {games_already_there} {plural(games_already_there, 'was', 'were')} already in your library, so{' '}
          {plural(games_already_there, 'it was', 'they were')} left as {plural(games_already_there, 'it is', 'they are')}.
        </p>
      )}
      {games_over_limit > 0 && (
        <p>
          {games_over_limit} {plural(games_over_limit, 'game', 'games')} did not fit within the list limits.
        </p>
      )}
      {games_skipped > 0 && (
        <p>
          {games_skipped} {plural(games_skipped, 'entry', 'entries')} in the file could not be used and{' '}
          {plural(games_skipped, 'was', 'were')} skipped.
        </p>
      )}
    </div>
  )
}

// Everything about keeping, moving and removing the library. It is always shown, including to someone with no games yet,
// because that is exactly who needs to restore a backup on a new device.
export default function YourData({ onChanged }) {
  const { user, accountsEnabled, refreshUser, restoreResult: result, setRestoreResult: setResult } = useAuth()
  const navigate = useNavigate()
  const fileInput = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const savedWithAccount = accountsEnabled && user && !user.isGuest

  async function handleFile(event) {
    const file = event.target.files?.[0]
    event.target.value = '' // so choosing the same file again still triggers a change
    if (!file) return

    setError(null)
    setResult(null)
    if (file.size > MAX_BACKUP_BYTES) {
      setError('That file is too large to be a BacklogVault backup (the limit is 4 MB).')
      return
    }

    let backup
    try {
      backup = JSON.parse(await file.text())
    } catch {
      setError("That file isn't a BacklogVault backup. Choose a .json file you downloaded from here.")
      return
    }

    setBusy(true)
    try {
      setResult(await restoreBackup(backup))
      await refreshUser() // a first restore quietly creates this device's library
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    setConfirmDelete(false)
    setError(null)
    setResult(null)
    try {
      await deleteMyData()
      navigate('/?data=deleted', { replace: true })
      await refreshUser()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <section className="home-section your-data" aria-labelledby="your-data-title">
      <h2 className="section-title" id="your-data-title">
        Your data
      </h2>
      <div className="panel">
        <p>
          {savedWithAccount
            ? 'Your library is saved to your account.'
            : 'Your library is saved on this device, in this browser. Clearing your browser data, using a private window, or opening the site on another device or browser starts you with an empty library.'}{' '}
          {!savedWithAccount && 'A library that has not been opened for 90 days is deleted automatically. '}
          {!accountsEnabled &&
            'Accounts are under construction: once they are live, your library will be saved and tied to your account. '}
          Download a backup to keep a copy or to move your library to another device.
        </p>

        <div className="your-data-actions">
          <a className="btn-link" href={BACKUP_URL} download>
            <Download size={16} aria-hidden="true" />
            Download Backup
          </a>
          <button type="button" className="btn-ghost" onClick={() => fileInput.current?.click()} disabled={busy}>
            <Upload size={16} aria-hidden="true" />
            {busy ? 'Restoring…' : 'Restore From Backup'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            name="backup"
            aria-label="Backup file"
            hidden
            onChange={handleFile}
          />
          <button type="button" className="btn-ghost danger-ghost" onClick={() => setConfirmDelete(true)} disabled={busy}>
            <Trash2 size={16} aria-hidden="true" />
            Delete My Data
          </button>
        </div>
        <p className="panel-footnote">
          Restoring only adds games: nothing already in your library is changed or removed.{' '}
          <Link to="/privacy">How we handle your data</Link>
        </p>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {result && <RestoreSummary result={result} />}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          message={
            <>
              Delete all of your data? This permanently deletes every list and game, your Steam connection if you have
              one, and your session on this device. <strong>It cannot be undone.</strong>{' '}
              <a href={BACKUP_URL} download>
                Download a backup first
              </a>{' '}
              if you might want it back.
            </>
          }
          confirmLabel="Delete My Data"
          cancelLabel="Cancel"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </section>
  )
}
