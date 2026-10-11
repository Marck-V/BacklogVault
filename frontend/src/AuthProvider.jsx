import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthContext } from './auth'
import { getMe, registerAccount, loginAccount, logoutAccount } from './api'
import AuthDialog from './AuthDialog'

export default function AuthProvider({ children }) {
  const navigate = useNavigate()
  const [user, setUser] = useState(undefined)
  const [dialogMode, setDialogMode] = useState(null)

  const refreshUser = useCallback(async () => {
    try {
      const { user: current } = await getMe()
      setUser(current)
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

  const value = { user, loading: user === undefined, refreshUser, register, login, logout, openAuth: setDialogMode }

  return (
    <AuthContext.Provider value={value}>
      {children}
      {dialogMode && (
        <AuthDialog mode={dialogMode} onModeChange={setDialogMode} onClose={() => setDialogMode(null)} />
      )}
    </AuthContext.Provider>
  )
}
