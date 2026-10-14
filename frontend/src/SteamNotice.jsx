import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'

const MESSAGES = {
  invalid: "We couldn't confirm your Steam sign-in. Please try again.",
  state: 'That sign-in link expired or was already used. Please try again.',
  session: 'Your session was lost while you were on Steam. Check that cookies are allowed, then try again.',
  unavailable: "Steam isn't responding right now. Please try again in a minute.",
  already_linked: 'That Steam account is already connected to another BacklogVault account.',
  disabled: "Steam sign-in isn't set up on this server.",
}

// Steam sends visitors back to the home page with ?steam=linked or ?steam=error&reason=... This turns that into a
// message, then tidies the address so a refresh does not show it again.
function readNotice(searchParams) {
  if (searchParams.get('data') === 'deleted') return { ok: true, text: 'Your data was deleted.' }
  const outcome = searchParams.get('steam')
  if (outcome === 'linked') {
    return { ok: true, text: 'Steam connected. Your recently played games will now show on the dashboard.' }
  }
  if (outcome === 'disconnected') return { ok: true, text: 'Steam disconnected, and your library was deleted.' }
  if (outcome === 'error') {
    return { ok: false, text: MESSAGES[searchParams.get('reason')] ?? 'Steam sign-in did not work. Please try again.' }
  }
  return null
}

// Shown above every page (so it survives the page being rebuilt when the signed-in state changes). It reads the message
// from the address, then tidies the address so a refresh does not show it again.
export default function SteamNotice() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [notice, setNotice] = useState(() => readNotice(searchParams))
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const found = readNotice(searchParams)
    if (found) {
      setNotice(found)
      setDismissed(false)
    }
    if (!searchParams.has('steam') && !searchParams.has('reason') && !searchParams.has('data')) return
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        next.delete('steam')
        next.delete('reason')
        next.delete('data')
        return next
      },
      { replace: true }
    )
  }, [searchParams, setSearchParams])

  if (!notice || dismissed) return null
  return (
    <div className={`notice ${notice.ok ? 'notice-ok' : 'notice-error'}`} role={notice.ok ? 'status' : 'alert'}>
      <span>{notice.text}</span>
      <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setDismissed(true)}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
