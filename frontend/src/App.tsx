import { Link, Routes, Route, useLocation } from 'react-router-dom'
import './App.css'
import Home from './Home'
import ListView from './ListView'
import NotFound from './NotFound'
import PrivacyPage from './PrivacyPage'
import SteamNotice from './SteamNotice'
import ErrorBoundary from './ErrorBoundary'
import SiteHeader from './SiteHeader'
import AuthProvider from './AuthProvider'
import { useAuth } from './auth'

function AppRoutes() {
  const { user } = useAuth()
  const location = useLocation()
  // Keying on the user remounts every page when the signed-in user changes, so nothing shows the previous user's data.
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <Routes key={user ? user.id : 'anonymous'}>
        <Route path="/" element={<Home />} />
        <Route path="/lists/:id" element={<ListView />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ErrorBoundary>
  )
}

function App() {
  return (
    <AuthProvider>
      <div className="app">
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        <SiteHeader />
        <main id="main" tabIndex={-1}>
          <SteamNotice />
          <AppRoutes />
        </main>
        <footer className="site-footer">
          <p>
            Game data and cover art provided by{' '}
            <a href="https://www.igdb.com" target="_blank" rel="noopener noreferrer">
              IGDB.com
            </a>
            . Steam data from the Steam Web API.
          </p>
          <p>
            BacklogVault is not affiliated with or endorsed by Valve or{' '}
            <a href="https://store.steampowered.com/" target="_blank" rel="noopener noreferrer">
              Steam
            </a>
            . Steam and the Steam logo are trademarks of Valve Corporation. <Link to="/privacy">Privacy and Steam data</Link>
          </p>
          <p>
            <a href="/third-party-licenses.txt" target="_blank" rel="noopener noreferrer">
              Open-source licenses
            </a>
          </p>
        </footer>
      </div>
    </AuthProvider>
  )
}

export default App
