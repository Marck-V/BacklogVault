import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getLists, createList, deleteList, EXPORT_BASE } from './api'
import Dashboard from './Dashboard'
import { useAuth } from './auth'
import { usePageTitle } from './usePageTitle'

const BANNER_DISMISSED_KEY = 'bv_guest_banner_dismissed'

function readBannerDismissed() {
  try {
    return localStorage.getItem(BANNER_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

export default function Home() {
  usePageTitle()
  const { user, refreshUser, openAuth } = useAuth()
  const [bannerDismissed, setBannerDismissed] = useState(readBannerDismissed)
  const [lists, setLists] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [newName, setNewName] = useState('')

  useEffect(() => {
    refresh()
  }, [])

  async function refresh() {
    setLoading(true)
    try {
      setLists(await getLists())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!newName.trim()) return
    try {
      await createList(newName.trim())
      setNewName('')
      // The first list quietly creates a guest session on the server, so pick up the new user.
      if (!user) refreshUser()
      refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDelete(id) {
    await deleteList(id)
    refresh()
  }

  function dismissBanner() {
    setBannerDismissed(true)
    try {
      localStorage.setItem(BANNER_DISMISSED_KEY, '1')
    } catch {
      // Storage can be blocked; the banner then simply returns on the next visit.
    }
  }

  return (
    <div>
      {user?.isGuest && lists.length > 0 && !bannerDismissed && (
        <div className="guest-banner" role="note">
          <span>
            You&apos;re using BacklogVault as a guest. Create a free account to keep your library and open it on any
            device.
          </span>
          <span className="guest-banner-actions">
            <button type="button" onClick={() => openAuth('signup')}>
              Create account
            </button>
            <button type="button" className="btn-ghost" onClick={dismissBanner}>
              Dismiss
            </button>
          </span>
        </div>
      )}

      <section className="home-section">
        <h2 className="section-title">Dashboard</h2>
        <Dashboard />
      </section>

      <section className="home-section">
        <div className="section-title-row">
          <h2 className="section-title">Your Lists</h2>
          {lists.length > 0 && (
            <a href={`${EXPORT_BASE}/export/csv`} className="export-btn" download="backlog.csv">
              ↓ Export CSV
            </a>
          )}
        </div>

        <form onSubmit={handleCreate} className="new-list-form">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New list name..."
            maxLength={100}
          />
          <button type="submit">Create List</button>
        </form>

        {error && <p className="error">{error}</p>}
        {loading && <p>Loading...</p>}

        {!loading && lists.length === 0 && <p>No lists yet. Create one to get started.</p>}

        <ul className="list-of-lists">
          {lists.map((list) => (
            <li key={list.id}>
              <Link to={`/lists/${list.id}`}>{list.name}</Link>
              <button type="button" onClick={() => handleDelete(list.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
