import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { bulkSetHidden, bulkUpdateStatus, getList, getLists, removeGameFromList, setGameHidden, updateGameEntry } from './api'
import GameSearch from './GameSearch'
import SteamImport from './SteamImport'
import GameDetailsModal from './GameDetailsModal'
import StatusBubble from './StatusBubble'
import BulkStatusBar from './BulkStatusBar'
import { STATUSES } from './statuses'
import ConfirmDialog from './ConfirmDialog'
import NotFound from './NotFound'
import { usePageTitle } from './usePageTitle'
import { SORT_OPTIONS, sortGames, formatPlaytime } from './sortGames'
import { ArrowLeft, Check, Eye, EyeOff, LayoutGrid, List as ListIcon, SquareCheckBig, Trash2 } from 'lucide-react'

const TABS = ['All', ...STATUSES]

export default function ListView() {
  const { id } = useParams()
  const [list, setList] = useState(null)
  const [allLists, setAllLists] = useState([])
  const [error, setError] = useState(null)
  const [activeGame, setActiveGame] = useState(null)
  const [pendingRemove, setPendingRemove] = useState(null)
  // Hiding asks first: { games } is one card's game, or everything picked in select mode.
  const [pendingHide, setPendingHide] = useState(null)
  // Select mode: pick several games and change their status in one go.
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [lastPickedId, setLastPickedId] = useState(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkMessage, setBulkMessage] = useState(null)
  // Tab, sort and view live in the address, so a refresh, a shared link and the back button all keep them.
  const [searchParams, setSearchParams] = useSearchParams()
  const statusParam = searchParams.get('status')
  const activeTab = TABS.includes(statusParam) ? statusParam : 'All'
  const sortParam = searchParams.get('sort')
  const sortKey = SORT_OPTIONS.some((option) => option.value === sortParam) ? sortParam : 'recent'
  const viewMode = searchParams.get('view') === 'list' ? 'list' : 'grid'

  function setParam(key, value, defaultValue) {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (value === defaultValue) next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: true }
    )
  }

  usePageTitle(list?.name)

  const refresh = useCallback(async () => {
    try {
      const [listData, lists] = await Promise.all([getList(id), getLists()])
      setList(listData)
      setAllLists(lists)
    } catch (err) {
      setError(err.message)
    }
  }, [id])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleConfirmRemove() {
    const gameId = pendingRemove.id
    setPendingRemove(null)
    await removeGameFromList(id, gameId)
    refresh()
  }

  function applyLocalUpdate(gameId, updates) {
    setList((prev) => ({
      ...prev,
      games: prev.games.map((g) => (g.id === gameId ? { ...g, ...updates } : g)),
    }))
    setActiveGame((prev) => (prev && prev.id === gameId ? { ...prev, ...updates } : prev))
  }

  async function handleStatusChange(game, newStatus) {
    applyLocalUpdate(game.id, { status: newStatus })
    try {
      const updated = await updateGameEntry(id, game.id, { status: newStatus })
      applyLocalUpdate(game.id, updated)
    } catch (err) {
      applyLocalUpdate(game.id, { status: game.status })
      setError(err.message)
    }
  }

  // Hidden games stay saved but live in their own collapsed section at the bottom, out of the tabs and the dashboard.
  const shownGames = useMemo(() => (list ? list.games.filter((g) => !g.hidden) : []), [list])
  const hiddenGames = useMemo(() => (list ? list.games.filter((g) => g.hidden) : []), [list])

  const visibleGames = useMemo(() => {
    const filtered = activeTab === 'All' ? shownGames : shownGames.filter((g) => g.status === activeTab)
    return sortGames(filtered, sortKey)
  }, [shownGames, activeTab, sortKey])

  async function handleHide(game, hidden) {
    applyLocalUpdate(game.id, { hidden: hidden ? 1 : 0 })
    try {
      await setGameHidden(id, game.id, hidden)
    } catch (err) {
      applyLocalUpdate(game.id, { hidden: hidden ? 0 : 1 })
      setError(err.message)
    }
  }

  const showPlaytime = sortKey.startsWith('playtime')

  // Only games you can see count as selected, so the number on the bar always matches what is on the screen.
  const selectedGames = visibleGames.filter((game) => selectedIds.has(game.id))

  function clearSelection() {
    setSelectedIds(new Set())
    setLastPickedId(null)
  }

  function toggleSelecting() {
    setSelecting((on) => !on)
    clearSelection()
    setBulkMessage(null)
  }

  // Click picks or unpicks one game. Shift-click picks or unpicks everything between this game and the last one
  // clicked, in the order shown.
  function handlePick(game, shiftKey) {
    setBulkMessage(null)
    setSelectedIds((previous) => {
      const next = new Set(previous)
      const from = shiftKey && lastPickedId != null ? visibleGames.findIndex((g) => g.id === lastPickedId) : -1
      const to = visibleGames.findIndex((g) => g.id === game.id)
      if (from !== -1 && to !== -1) {
        const adding = !previous.has(game.id)
        for (const g of visibleGames.slice(Math.min(from, to), Math.max(from, to) + 1)) {
          if (adding) next.add(g.id)
          else next.delete(g.id)
        }
      } else if (next.has(game.id)) {
        next.delete(game.id)
      } else {
        next.add(game.id)
      }
      return next
    })
    setLastPickedId(game.id)
  }

  function openOrPick(game, event) {
    if (selecting) handlePick(game, event.shiftKey)
    else setActiveGame(game)
  }

  async function applyBulkStatus(status) {
    const ids = selectedGames.map((game) => game.id)
    if (ids.length === 0) return
    setBulkBusy(true)
    setBulkMessage(null)
    try {
      const result = await bulkUpdateStatus(id, ids, status)
      const changed = new Map(result.games.map((game) => [game.id, game]))
      setList((prev) => ({ ...prev, games: prev.games.map((game) => changed.get(game.id) ?? game) }))
      clearSelection()
      setBulkMessage({ text: `Moved ${result.updated} ${result.updated === 1 ? 'game' : 'games'} to ${status}.` })
    } catch (err) {
      setBulkMessage({ error: true, text: err.message })
    } finally {
      setBulkBusy(false)
    }
  }

  async function applyBulkHide() {
    const ids = selectedGames.map((game) => game.id)
    if (ids.length === 0) return
    setBulkBusy(true)
    setBulkMessage(null)
    try {
      const result = await bulkSetHidden(id, ids, true)
      const changed = new Map(result.games.map((game) => [game.id, game]))
      setList((prev) => ({ ...prev, games: prev.games.map((game) => changed.get(game.id) ?? game) }))
      clearSelection()
      setBulkMessage({
        text: `Hid ${result.updated} ${result.updated === 1 ? 'game' : 'games'}. Find them under Hidden games at the bottom.`,
      })
    } catch (err) {
      setBulkMessage({ error: true, text: err.message })
    } finally {
      setBulkBusy(false)
    }
  }

  if (error === 'List not found') return <NotFound />
  if (error) return <p className="error">{error}</p>
  if (!list) return <p role="status">Loading…</p>

  return (
    <div>
      <Link to="/" className="back-link">
        <ArrowLeft size={16} aria-hidden="true" />
        All lists
      </Link>
      <h1>{list.name}</h1>

      <div className="list-toolbar">
        <h2>Games in this list</h2>
        <div className="list-toolbar-controls">
          <label className="sort-control">
            <span>Sort by</span>
            <select value={sortKey} onChange={(e) => setParam('sort', e.target.value, 'recent')}>
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="view-toggle">
            <button
              type="button"
              className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setParam('view', 'grid', 'grid')}
            >
              <LayoutGrid size={15} aria-hidden="true" />
              Grid
            </button>
            <button
              type="button"
              className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setParam('view', 'list', 'grid')}
            >
              <ListIcon size={15} aria-hidden="true" />
              List
            </button>
          </div>
          <button type="button" className="btn-ghost select-toggle" aria-pressed={selecting} onClick={toggleSelecting}>
            {selecting ? <Check size={15} aria-hidden="true" /> : <SquareCheckBig size={15} aria-hidden="true" />}
            {selecting ? 'Done' : 'Select'}
          </button>
        </div>
      </div>

      <div className="filter-tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`filter-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => {
              setParam('status', tab, 'All')
              clearSelection()
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {list.games.length === 0 && <p>No games added yet. Search below.</p>}
      {shownGames.length > 0 && visibleGames.length === 0 && <p>No games with this status.</p>}
      {list.games.length > 0 && shownGames.length === 0 && (
        <p>Every game in this list is hidden. Open Hidden games at the bottom to bring them back.</p>
      )}

      {viewMode === 'grid' ? (
        <div className="results">
          {visibleGames.map((game) => (
            <div
              key={game.id}
              className={`game-card clickable${selectedIds.has(game.id) ? ' selected' : ''}`}
              onClick={(e) => openOrPick(game, e)}
            >
              {selecting && (
                <input
                  type="checkbox"
                  className="select-box"
                  aria-label={`Select ${game.name}`}
                  checked={selectedIds.has(game.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => handlePick(game, e.nativeEvent.shiftKey)}
                />
              )}
              {game.cover_url && (
                <img src={game.cover_url} alt={game.name} width="264" height="352" loading="lazy" decoding="async" />
              )}
              <h3 translate="no">
                {/* A click bubbles up to the card, which opens the game (or picks it in select mode). */}
                <button type="button" className="game-title-btn">
                  {game.name}
                </button>
              </h3>
              {showPlaytime && <p className="game-playtime">{formatPlaytime(game.hours_played)}</p>}
              {selecting ? (
                <div className="game-card-actions">
                  <span className={`status-badge status-${game.status.toLowerCase()} static`}>{game.status}</span>
                </div>
              ) : (
                <div className="game-card-actions">
                  <StatusBubble
                    status={game.status}
                    onChange={(newStatus) => handleStatusChange(game, newStatus)}
                  />
                  <div className="icon-btn-group">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Hide ${game.name} from stats`}
                      title="Hide from stats"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPendingHide({ games: [game] })
                      }}
                    >
                      <EyeOff size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="icon-btn danger"
                      aria-label={`Remove ${game.name} from this list`}
                      title="Remove from list"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPendingRemove(game)
                      }}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="game-rows">
          {visibleGames.map((game) => (
            <div
              key={game.id}
              className={`game-row clickable${selectedIds.has(game.id) ? ' selected' : ''}`}
              onClick={(e) => openOrPick(game, e)}
            >
              {selecting && (
                <input
                  type="checkbox"
                  className="select-box"
                  aria-label={`Select ${game.name}`}
                  checked={selectedIds.has(game.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => handlePick(game, e.nativeEvent.shiftKey)}
                />
              )}
              {game.cover_url ? (
                <img src={game.cover_url} alt={game.name} width="42" height="56" loading="lazy" decoding="async" />
              ) : (
                <div className="game-row-cover-placeholder" />
              )}
              <span className="game-row-name" translate="no">
                <button type="button" className="game-title-btn">
                  {game.name}
                </button>
              </span>
              {showPlaytime && <span className="game-row-playtime">{formatPlaytime(game.hours_played)}</span>}
              {selecting ? (
                <div className="game-row-actions">
                  <span className={`status-badge status-${game.status.toLowerCase()} static`}>{game.status}</span>
                </div>
              ) : (
                <div className="game-row-actions" onClick={(e) => e.stopPropagation()}>
                  <StatusBubble
                    status={game.status}
                    onChange={(newStatus) => handleStatusChange(game, newStatus)}
                  />
                  <div className="icon-btn-group">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Hide ${game.name} from stats`}
                      title="Hide from stats"
                      onClick={() => setPendingHide({ games: [game] })}
                    >
                      <EyeOff size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="icon-btn danger"
                      aria-label={`Remove ${game.name} from this list`}
                      title="Remove from list"
                      onClick={() => setPendingRemove(game)}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <h2>Add games</h2>
      <GameSearch lists={allLists} defaultListId={Number(id)} onAdded={refresh} />

      <SteamImport listId={id} onImported={refresh} />

      {hiddenGames.length > 0 && (
        <details className="hidden-games">
          <summary>
            <EyeOff size={16} aria-hidden="true" />
            Hidden games ({hiddenGames.length})
          </summary>
          <p className="hidden-games-note">
            These are saved but left out of the dashboard totals and charts. Show a game to count it again.
          </p>
          <ul className="hidden-games-list">
            {sortGames(hiddenGames, 'alpha').map((game) => (
              <li key={game.id} className="hidden-game">
                {game.cover_url ? (
                  <img src={game.cover_url} alt="" width="34" height="45" loading="lazy" decoding="async" />
                ) : (
                  <div className="game-row-cover-placeholder" />
                )}
                <span className="hidden-game-name" translate="no">
                  {game.name}
                </span>
                <span className={`status-badge status-${game.status.toLowerCase()} static`}>{game.status}</span>
                <button type="button" className="btn-ghost" onClick={() => handleHide(game, false)}>
                  <Eye size={15} aria-hidden="true" />
                  Show
                  <span className="visually-hidden"> {game.name} again</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {activeGame && (
        <GameDetailsModal
          game={activeGame}
          listId={id}
          onClose={() => setActiveGame(null)}
          onUpdate={(updates) => applyLocalUpdate(activeGame.id, updates)}
        />
      )}

      {pendingHide && (
        <ConfirmDialog
          message={
            pendingHide.games.length === 1
              ? `Hide “${pendingHide.games[0].name}”? It stays saved but is left out of your dashboard stats. You can show it again from Hidden games at the bottom of the list.`
              : `Hide ${pendingHide.games.length} games? They stay saved but are left out of your dashboard stats. You can show them again from Hidden games at the bottom of the list.`
          }
          confirmLabel={pendingHide.games.length === 1 ? 'Hide Game' : 'Hide Games'}
          cancelLabel="Cancel"
          onConfirm={() => {
            const { games, bulk } = pendingHide
            setPendingHide(null)
            if (bulk) applyBulkHide()
            else handleHide(games[0], true)
          }}
          onCancel={() => setPendingHide(null)}
        />
      )}

      {pendingRemove && (
        <ConfirmDialog
          message={`Remove “${pendingRemove.name}” from this list?`}
          confirmLabel="Remove Game"
          cancelLabel="Cancel"
          onConfirm={handleConfirmRemove}
          onCancel={() => setPendingRemove(null)}
        />
      )}

      {selecting && (
        <BulkStatusBar
          count={selectedGames.length}
          visibleCount={visibleGames.length}
          busy={bulkBusy}
          message={bulkMessage}
          onSelectAll={() => setSelectedIds(new Set(visibleGames.map((game) => game.id)))}
          onClear={clearSelection}
          onApply={applyBulkStatus}
          onHide={() => setPendingHide({ games: selectedGames, bulk: true })}
        />
      )}
    </div>
  )
}
