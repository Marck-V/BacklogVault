import { Routes, Route } from 'react-router-dom'
import './App.css'
import Home from './Home'
import ListView from './ListView'
import SiteHeader from './SiteHeader'
import AuthProvider from './AuthProvider'
import { useAuth } from './auth'

function AppRoutes() {
  const { user } = useAuth()
  // Keying on the user remounts every page when the signed-in user changes, so nothing shows the previous user's data.
  return (
    <Routes key={user ? user.id : 'anonymous'}>
      <Route path="/" element={<Home />} />
      <Route path="/lists/:id" element={<ListView />} />
    </Routes>
  )
}

function App() {
  return (
    <AuthProvider>
      <div className="app">
        <SiteHeader />
        <AppRoutes />
        <footer className="site-footer">
          Game data and cover art provided by{' '}
          <a href="https://www.igdb.com" target="_blank" rel="noopener noreferrer">
            IGDB.com
          </a>
        </footer>
      </div>
    </AuthProvider>
  )
}

export default App
