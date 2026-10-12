import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { getList, getLists, removeGameFromList, updateGameEntry } from './api'
import GameSearch from './GameSearch'
import SteamImport from './SteamImport'
import GameDetailsModal from './GameDetailsModal'
import StatusBubble from './StatusBubble'
import { STATUSES } from './statuses'
import ConfirmDialog from './ConfirmDialog'
import NotFound from './NotFound'
import { usePageTitle } from './usePageTitle'
import { SORT_OPTIONS, sortGames, formatPlaytime } from './sortGames'

const TABS = ['All', ...STATUSES]

export default function ListView() {
  const { id } = useParams()
  const [list, setList] = useState(null)
  const [allLists, setAllLists] = useState([])
  const [error, setError] = useState(null)
  const [activeGame, setActiveGame] = useState(null)
  const [pendingRemove, setPendingRemove] = useState(null)
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

  const visibleGames = useMemo(() => {
    if (!list) return []
    const filtered = activeTab === 'All' ? list.games : list.games.filter((g) => g.status === activeTab)
    return sortGames(filtered, sortKey)
  }, [list, activeTab, sortKey])

  const showPlaytime = sortKey.startsWith('playtime')

  if (error === 'List not found') return <NotFound />
  if (error) return <p className="error">{error}</p>
  if (!list) return <p role="status">Loading…</p>

  return (
    <div>
      <Link to="/">&larr; All lists</Link>
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
              Grid
            </button>
            <button
              type="button"
              className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setParam('view', 'list', 'grid')}
            >
              List
            </button>
          </div>
        </div>
      </div>

      <div className="filter-tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`filter-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setParam('status', tab, 'All')}
          >
            {tab}
          </button>
        ))}
      </div>

      {list.games.length === 0 && <p>No games added yet. Search below.</p>}
      {list.games.length > 0 && visibleGames.length === 0 && <p>No games with this status.</p>}

      {viewMode === 'grid' ? (
        <div className="results">
          {visibleGames.map((game) => (
            <div key={game.id} className="game-card clickable" onClick={() => setActiveGame(game)}>
              {game.cover_url && (
                <img src={game.cover_url} alt={game.name} width="264" height="352" loading="lazy" decoding="async" />
              )}
              <h3 translate="no">
                <button type="button" className="game-title-btn" onClick={() => setActiveGame(game)}>
                  {game.name}
                </button>
              </h3>
              {showPlaytime && <p className="game-playtime">{formatPlaytime(game.hours_played)}</p>}
              <div className="game-card-actions">
                <StatusBubble
                  status={game.status}
                  onChange={(newStatus) => handleStatusChange(game, newStatus)}
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setPendingRemove(game)
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="game-rows">
          {visibleGames.map((game) => (
            <div key={game.id} className="game-row clickable" onClick={() => setActiveGame(game)}>
              {game.cover_url ? (
                <img src={game.cover_url} alt={game.name} width="42" height="56" loading="lazy" decoding="async" />
              ) : (
                <div className="game-row-cover-placeholder" />
              )}
              <span className="game-row-name" translate="no">
                <button type="button" className="game-title-btn" onClick={() => setActiveGame(game)}>
                  {game.name}
                </button>
              </span>
              {showPlaytime && <span className="game-row-playtime">{formatPlaytime(game.hours_played)}</span>}
              <div className="game-row-actions" onClick={(e) => e.stopPropagation()}>
                <StatusBubble
                  status={game.status}
                  onChange={(newStatus) => handleStatusChange(game, newStatus)}
                />
                <button
                  type="button"
                  onClick={() => setPendingRemove(game)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2>Add games</h2>
      <GameSearch lists={allLists} defaultListId={Number(id)} onAdded={refresh} />

      <SteamImport listId={id} onImported={refresh} />

      {activeGame && (
        <GameDetailsModal
          game={activeGame}
          listId={id}
          onClose={() => setActiveGame(null)}
          onUpdate={(updates) => applyLocalUpdate(activeGame.id, updates)}
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
    </div>
  )
}
