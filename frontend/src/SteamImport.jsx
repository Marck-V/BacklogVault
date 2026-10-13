import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { EXPORT_BASE, STEAM_CONNECT_URL, getSteamImportStatus, importSteamLibrary, disconnectSteamAndDeleteLibrary } from './api'
import { Download, Unlink } from 'lucide-react'
import ConfirmDialog from './ConfirmDialog'

const plural = (count, one, many) => (count === 1 ? one : many)

function Summary({ result }) {
  const { imported, matched, alreadyInList, skippedOverCap, unmatched, owned, unmatchedSample } = result
  const hiddenNames = unmatched - unmatchedSample.length

  return (
    <div className="steam-import-summary" role="status">
      <p>
        <strong>
          Imported {imported} {plural(imported, 'game', 'games')}
        </strong>{' '}
        from {owned} on Steam ({matched} matched to IGDB).
      </p>
      {alreadyInList > 0 && (
        <p>
          {alreadyInList} {plural(alreadyInList, 'was', 'were')} already in this list, so it was left as it is.
        </p>
      )}
      {skippedOverCap > 0 && (
        <p>
          {skippedOverCap} {plural(skippedOverCap, 'game', 'games')} did not fit, because a list holds up to 2,000 games.
          The most played came first.
        </p>
      )}
      {unmatched > 0 && (
        <details>
          <summary>
            {unmatched} Steam {plural(unmatched, 'item', 'items')} couldn&apos;t be matched
          </summary>
          <p>These are often soundtracks, tools, demos or beta apps that IGDB does not list as games.</p>
          <ul>
            {unmatchedSample.map((name) => (
              <li key={name}>{name}</li>
            ))}
            {hiddenNames > 0 && <li>and {hiddenNames} more</li>}
          </ul>
        </details>
      )}
    </div>
  )
}

export default function SteamImport({ listId, onImported }) {
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    let active = true
    getSteamImportStatus()
      .then((data) => active && setStatus(data))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  if (!status?.enabled) return null
  const linked = Boolean(status.linked)

  // Steam's terms allow reading someone's Steam data only when they ask, so this runs only from a button click and
  // only for the account the visitor connected through Steam's own sign-in.
  async function runImport() {
    if (busy) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setResult(await importSteamLibrary(listId))
      onImported?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleDisconnect() {
    setConfirmDisconnect(false)
    setError(null)
    try {
      await disconnectSteamAndDeleteLibrary()
      // The list this page shows no longer exists, so go home, where a message says what happened.
      navigate('/?steam=disconnected', { replace: true })
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <section className="steam-import">
      <h2>Import from Steam</h2>

      {linked ? (
        <>
          <p className="steam-import-help">
            Connected as <strong translate="no">{status.personaName ?? 'your Steam account'}</strong>. Your profile&apos;s{' '}
            <strong>Game details</strong> must be set to Public. Games are added as Backlog, with your hours played, and
            your recently played games appear on the dashboard. Disconnecting deletes your library.
          </p>
          <div className="steam-import-actions">
            <button type="button" onClick={runImport} disabled={busy}>
              <Download size={16} aria-hidden="true" />
              {busy ? 'Importing…' : 'Import my library'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setConfirmDisconnect(true)} disabled={busy}>
              <Unlink size={16} aria-hidden="true" />
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="steam-import-help">
            Connect your Steam account to import your library and keep your recently played games up to date. You sign
            in on Steam&apos;s own site, so we never see your password.
          </p>
          <div className="steam-import-actions">
            {/* Valve's own "Sign in through Steam" button, shown as supplied. */}
            <a className="steam-signin" href={STEAM_CONNECT_URL}>
              <img src="/sits_01.png" alt="Sign in through Steam" width="180" height="35" />
            </a>
          </div>
        </>
      )}

      <p className="steam-import-help steam-import-data">
        We store your Steam ID, your Steam display name and the hours you have played in the games you import. We read
        your Steam data only when you ask: when you import, press Refresh from Steam, or open your dashboard.{' '}
        <Link to="/privacy">How we use your Steam data</Link>
      </p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && <Summary result={result} />}

      {confirmDisconnect && (
        <ConfirmDialog
          message={
            <>
              Disconnect Steam and delete your library? This removes your Steam ID and display name and{' '}
              <strong>permanently deletes all of your lists and the games in them</strong>, including games you added
              yourself. It cannot be undone.{' '}
              <a href={`${EXPORT_BASE}/export/csv`} download="backlog.csv">
                Download a copy first
              </a>
              .
            </>
          }
          confirmLabel="Disconnect and Delete Library"
          cancelLabel="Cancel"
          onConfirm={handleDisconnect}
          onCancel={() => setConfirmDisconnect(false)}
        />
      )}
    </section>
  )
}
