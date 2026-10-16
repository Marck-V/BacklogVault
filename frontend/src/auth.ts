import { createContext, useContext } from 'react'
import type { RestoreSummary, SessionUser } from '../../shared/api.ts'

export type AuthDialogMode = 'signin' | 'signup'

export interface AuthState {
  // undefined while the first check of the session is still running, null for a visitor with no session yet
  user: SessionUser | null | undefined
  accountsEnabled: boolean
  loading: boolean
  restoreResult: RestoreSummary | null
  setRestoreResult: (result: RestoreSummary | null) => void
  refreshUser: () => Promise<void>
  register: (email: string, password: string) => Promise<void>
  login: (email: string, password: string, mergeGuestData: boolean) => Promise<void>
  logout: () => Promise<void>
  openAuth: (mode: AuthDialogMode | null) => void
}

export const AuthContext = createContext<AuthState | null>(null)

// Every page sits inside AuthProvider (see App), so the state is always there.
export function useAuth(): AuthState {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside AuthProvider')
  return auth
}

// For a page that can also be shown on its own (the privacy page): null when there is no AuthProvider around it.
export function useOptionalAuth(): AuthState | null {
  return useContext(AuthContext)
}
