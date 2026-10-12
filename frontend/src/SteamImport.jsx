import { useEffect, useState } from 'react'
import { getSteamImportStatus, importSteamLibrary } from './api'

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
  const [enabled, setEnabled] = useState(false)
  const [steam, setSteam] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    let active = true
    getSteamImportStatus()
      .then((status) => active && setEnabled(Boolean(status?.enabled)))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  if (!enabled) return null

  async function handleSubmit(e) {
    e.preventDefault()
    const value = steam.trim()
    if (!value || busy) return

    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setResult(await importSteamLibrary(listId, value))
      onImported?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="steam-import">
      <h2>Import from Steam</h2>
      <p className="steam-import-help">
        Paste your Steam profile link, your 17-digit Steam ID or your custom profile name. Your profile&apos;s{' '}
        <strong>Game details</strong> must be set to Public. Games are added as Backlog, with your hours played.
        Please only import your own library.
      </p>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          aria-label="Steam profile"
          value={steam}
          onChange={(e) => setSteam(e.target.value)}
          placeholder="steamcommunity.com/id/yourname"
          maxLength={200}
        />
        <button type="submit" disabled={busy || !steam.trim()}>
          {busy ? 'Importing...' : 'Import'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {result && <Summary result={result} />}
    </section>
  )
}
