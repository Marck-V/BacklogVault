import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from './auth'
import ConfirmDialog from './ConfirmDialog'
import { LogIn, LogOut, UserPlus } from 'lucide-react'

export default function SiteHeader() {
  const { user, accountsEnabled, loading, openAuth, logout } = useAuth()
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  function handleSignOut() {
    if (user.isGuest) setConfirmSignOut(true)
    else logout()
  }

  return (
    <header className="site-header">
      <span className="header-spacer" />
      <Link to="/" className="site-title" translate="no">
        BacklogVault
      </Link>

      <div className="header-actions">
        {accountsEnabled && !loading && !user && (
          <>
            <button type="button" className="btn-ghost" onClick={() => openAuth('signin')}>
              <LogIn size={15} aria-hidden="true" />
              Sign In
            </button>
            <button type="button" onClick={() => openAuth('signup')}>
              <UserPlus size={15} aria-hidden="true" />
              Create Account
            </button>
          </>
        )}
        {accountsEnabled && user?.isGuest && (
          <>
            <span className="user-pill">Guest</span>
            <button type="button" onClick={() => openAuth('signup')}>
              <UserPlus size={15} aria-hidden="true" />
              Create Account
            </button>
            <button type="button" className="btn-ghost" onClick={() => openAuth('signin')}>
              <LogIn size={15} aria-hidden="true" />
              Sign In
            </button>
          </>
        )}
        {accountsEnabled && user && !user.isGuest && (
          <>
            <span className="user-pill" title={user.email}>
              {user.email}
            </span>
            <button type="button" className="btn-ghost" onClick={handleSignOut}>
              <LogOut size={15} aria-hidden="true" />
              Sign Out
            </button>
          </>
        )}
      </div>

      {confirmSignOut && (
        <ConfirmDialog
          confirmLabel="Sign Out"
          cancelLabel="Cancel"
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
