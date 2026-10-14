import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getLists, createList, deleteList, EXPORT_BASE, BACKUP_URL } from './api'
import Dashboard from './Dashboard'
import ConfirmDialog from './ConfirmDialog'
import YourData from './YourData'
import { useAuth } from './auth'
import { usePageTitle } from './usePageTitle'
import { Download, Plus, Trash2 } from 'lucide-react'

const BANNER_DISMISSED_KEY = 'bv_guest_banner_dismissed'
const DEVICE_NOTICE_KEY = 'bv_device_notice_dismissed'

function readDismissed(key) {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

export default function Home() {
  usePageTitle()
  const { user, accountsEnabled, refreshUser, openAuth } = useAuth()
  const [deviceNoticeDismissed, setDeviceNoticeDismissed] = useState(() => readDismissed(DEVICE_NOTICE_KEY))
  const [bannerDismissed, setBannerDismissed] = useState(() => readDismissed(BANNER_DISMISSED_KEY))
  const [lists, setLists] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [newName, setNewName] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)

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

  async function handleConfirmDelete() {
    const { id } = pendingDelete
    setPendingDelete(null)
    try {
      await deleteList(id)
    } catch (err) {
      setError(err.message)
    }
    refresh()
  }

  function remember(key, done) {
    done(true)
    try {
      localStorage.setItem(key, '1')
    } catch {
      // Storage can be blocked; the message then simply returns on the next visit.
    }
  }

  const dismissBanner = () => remember(BANNER_DISMISSED_KEY, setBannerDismissed)
  const dismissDeviceNotice = () => remember(DEVICE_NOTICE_KEY, setDeviceNoticeDismissed)

  return (
    <div>
      <h1 className="visually-hidden">BacklogVault</h1>

      {!accountsEnabled && lists.length > 0 && !deviceNoticeDismissed && (
        <div className="guest-banner" role="note">
          <span>
            Your library is saved on this device. If you clear your browser data or switch devices, you will start over, so
            download a backup to keep a copy. A library not opened for 90 days is deleted.
          </span>
          <span className="guest-banner-actions">
            <a className="btn-link" href={BACKUP_URL} download>
              Download Backup
            </a>
            <button type="button" className="btn-ghost" onClick={dismissDeviceNotice}>
              Dismiss
            </button>
          </span>
        </div>
      )}

      {accountsEnabled && user?.isGuest && lists.length > 0 && !bannerDismissed && (
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
              <Download size={14} aria-hidden="true" />
              Export CSV
            </a>
          )}
        </div>

        <form onSubmit={handleCreate} className="new-list-form">
          <input
            type="text"
            aria-label="New list name"
            name="listName"
            autoComplete="off"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Weekend Backlog…"
            maxLength={100}
          />
          <button type="submit">
            <Plus size={16} aria-hidden="true" />
            Create List
          </button>
        </form>

        {error && <p className="error">{error}</p>}
        {loading && <p role="status">Loading…</p>}

        {!loading && lists.length === 0 && <p>No lists yet. Create one to get started.</p>}

        <ul className="list-of-lists">
          {lists.map((list) => (
            <li key={list.id}>
              <Link to={`/lists/${list.id}`}>{list.name}</Link>
              <button type="button" onClick={() => setPendingDelete(list)} aria-label={`Delete ${list.name}`}>
                <Trash2 size={14} aria-hidden="true" />
                Delete
              </button>
            </li>
          ))}
        </ul>
      </section>

      <YourData onChanged={refresh} />

      {pendingDelete && (
        <ConfirmDialog
          message={`Delete “${pendingDelete.name}” and every game in it? This can’t be undone.`}
          confirmLabel="Delete List"
          cancelLabel="Cancel"
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
