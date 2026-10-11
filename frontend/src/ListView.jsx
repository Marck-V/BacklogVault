import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getList, getLists, removeGameFromList, updateGameEntry } from './api'
import GameSearch from './GameSearch'
import GameDetailsModal from './GameDetailsModal'
import StatusBubble, { STATUSES } from './StatusBubble'
import ConfirmDialog from './ConfirmDialog'

const TABS = ['All', ...STATUSES]

export default function ListView() {
  const { id } = useParams()
  const [list, setList] = useState(null)
  const [allLists, setAllLists] = useState([])
  const [error, setError] = useState(null)
  const [activeGame, setActiveGame] = useState(null)
  const [activeTab, setActiveTab] = useState('All')
  const [pendingRemove, setPendingRemove] = useState(null)
  const [viewMode, setViewMode] = useState('grid')

  useEffect(() => {
    refresh()
  }, [id])

  async function refresh() {
    try {
      const [listData, lists] = await Promise.all([getList(id), getLists()])
      setList(listData)
      setAllLists(lists)
    } catch (err) {
      setError(err.message)
    }
  }

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
    if (activeTab === 'All') return list.games
    return list.games.filter((g) => g.status === activeTab)
  }, [list, activeTab])

  if (error) return <p className="error">{error}</p>
  if (!list) return <p>Loading...</p>

  return (
    <div>
      <Link to="/">&larr; All lists</Link>
      <h1>{list.name}</h1>

      <div className="list-toolbar">
        <h2>Games in this list</h2>
        <div className="view-toggle">
          <button
            type="button"
            className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => setViewMode('grid')}
          >
            Grid
          </button>
          <button
            type="button"
            className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode('list')}
          >
            List
          </button>
        </div>
      </div>

      <div className="filter-tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`filter-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
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
              {game.cover_url && <img src={game.cover_url} alt={game.name} />}
              <h3>{game.name}</h3>
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
                <img src={game.cover_url} alt={game.name} />
              ) : (
                <div className="game-row-cover-placeholder" />
              )}
              <span className="game-row-name">{game.name}</span>
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
          message={`Remove "${pendingRemove.name}" from this list?`}
          onConfirm={handleConfirmRemove}
          onCancel={() => setPendingRemove(null)}
        />
      )}
    </div>
  )
}
