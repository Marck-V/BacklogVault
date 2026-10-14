import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthContext } from './auth'
import { getMe, registerAccount, loginAccount, logoutAccount } from './api'
import AuthDialog from './AuthDialog'

export default function AuthProvider({ children }) {
  const navigate = useNavigate()
  const [user, setUser] = useState(undefined)
  const [accountsEnabled, setAccountsEnabled] = useState(false)
  // Kept here, above the pages, because restoring into an empty browser creates this device's library, which changes who
  // is signed in and rebuilds the page: a message held by the page itself would vanish the moment it appeared.
  const [restoreResult, setRestoreResult] = useState(null)
  const [dialogMode, setDialogMode] = useState(null)

  const refreshUser = useCallback(async () => {
    try {
      const { user: current, accountsEnabled: enabled } = await getMe()
      setUser(current)
      setAccountsEnabled(Boolean(enabled))
    } catch {
      setUser(null)
    }
  }, [])

  useEffect(() => {
    refreshUser()
  }, [refreshUser])

  async function register(email, password) {
    const { user: created } = await registerAccount(email, password)
    setUser(created)
    setDialogMode(null)
  }

  async function login(email, password, mergeGuestData) {
    const { user: signedIn } = await loginAccount(email, password, mergeGuestData)
    setUser(signedIn)
    setDialogMode(null)
    navigate('/')
  }

  async function logout() {
    await logoutAccount()
    setUser(null)
    navigate('/')
  }

  const value = { user, accountsEnabled, restoreResult, setRestoreResult, loading: user === undefined, refreshUser, register, login, logout, openAuth: setDialogMode }

  return (
    <AuthContext.Provider value={value}>
      {children}
      {dialogMode && (
        <AuthDialog mode={dialogMode} onModeChange={setDialogMode} onClose={() => setDialogMode(null)} />
      )}
    </AuthContext.Provider>
  )
}
