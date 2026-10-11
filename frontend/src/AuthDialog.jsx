import { useState } from 'react'
import { useAuth } from './auth'

export default function AuthDialog({ mode, onModeChange, onClose }) {
  const { user, register, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mergeGuestData, setMergeGuestData] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const isSignUp = mode === 'signup'

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (isSignUp) await register(email, password)
      else await login(email, password, mergeGuestData)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal auth-dialog" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          &times;
        </button>
        <h2>{isSignUp ? 'Create your account' : 'Sign in'}</h2>
        <p className="auth-blurb">
          {isSignUp
            ? user?.isGuest
              ? 'Your current library will be saved to this account.'
              : 'Save your library online and open it from any device.'
            : 'Welcome back.'}
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="field-label">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              autoFocus
            />
          </label>
          <label className="field-label">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              minLength={isSignUp ? 8 : undefined}
              maxLength={128}
              required
            />
          </label>
          {isSignUp && <p className="auth-hint">At least 8 characters.</p>}

          {!isSignUp && user?.isGuest && (
            <label className="auth-check">
              <input type="checkbox" checked={mergeGuestData} onChange={(e) => setMergeGuestData(e.target.checked)} />
              Move my guest lists into this account
            </label>
          )}

          {error && <p className="error">{error}</p>}

          <button type="submit" disabled={busy}>
            {busy ? 'Please wait...' : isSignUp ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <p className="auth-switch">
          {isSignUp ? 'Already have an account?' : 'New here?'}{' '}
          <button type="button" className="link-button" onClick={() => onModeChange(isSignUp ? 'signin' : 'signup')}>
            {isSignUp ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      </div>
    </div>
  )
}
