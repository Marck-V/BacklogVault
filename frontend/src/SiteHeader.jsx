import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from './auth'
import ConfirmDialog from './ConfirmDialog'

export default function SiteHeader() {
  const { user, loading, openAuth, logout } = useAuth()
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  function handleSignOut() {
    if (user.isGuest) setConfirmSignOut(true)
    else logout()
  }

  return (
    <header className="site-header">
      <span className="header-spacer" />
      <Link to="/" className="site-title">
        BacklogVault
      </Link>

      <div className="header-actions">
        {!loading && !user && (
          <>
            <button type="button" className="btn-ghost" onClick={() => openAuth('signin')}>
              Sign in
            </button>
            <button type="button" onClick={() => openAuth('signup')}>
              Create account
            </button>
          </>
        )}
        {user?.isGuest && (
          <>
            <span className="user-pill">Guest</span>
            <button type="button" onClick={() => openAuth('signup')}>
              Create account
            </button>
            <button type="button" className="btn-ghost" onClick={() => openAuth('signin')}>
              Sign in
            </button>
          </>
        )}
        {user && !user.isGuest && (
          <>
            <span className="user-pill" title={user.email}>
              {user.email}
            </span>
            <button type="button" className="btn-ghost" onClick={handleSignOut}>
              Sign out
            </button>
          </>
        )}
      </div>

      {confirmSignOut && (
        <ConfirmDialog
          message="You're using a guest session, so signing out leaves your library behind on this browser. Create an account first to keep it. Sign out anyway?"
          onConfirm={() => {
            setConfirmSignOut(false)
            logout()
          }}
          onCancel={() => setConfirmSignOut(false)}
        />
      )}
    </header>
  )
}
