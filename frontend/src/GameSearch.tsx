import { useState, type FormEvent } from 'react'
import { searchGames, addGameToList } from './api'
import { Plus, Search } from 'lucide-react'
import { errorMessage } from './errors'
import type { List, SearchResult } from '../../shared/api.ts'

function coverUrl(game: SearchResult): string | null {
  return game.cover?.url ? `https:${game.cover.url.replace('t_thumb', 't_cover_big')}` : null
}

interface GameSearchProps {
  lists: List[]
  defaultListId?: number
  onAdded?: (listId: number) => void
}

export default function GameSearch({ lists, defaultListId, onAdded }: GameSearchProps) {
  const [query, setQuery] = useState('')
  const [games, setGames] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Per search result: the list chosen in its drop-down, and 'adding', 'added' or an error message.
  const [selectedListByGame, setSelectedListByGame] = useState<Record<number, number>>({})
  const [statusByGame, setStatusByGame] = useState<Record<number, string>>({})

  async function handleSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    try {
      const data = await searchGames(query)
      setGames(data)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  function listIdFor(gameId: number): number | undefined {
    return selectedListByGame[gameId] ?? defaultListId ?? lists[0]?.id
  }

  async function handleAdd(game: SearchResult) {
    const listId = listIdFor(game.id)
    if (!listId) return
    setStatusByGame((s) => ({ ...s, [game.id]: 'adding' }))
    try {
      await addGameToList(listId, {
        igdb_id: game.id,
        name: game.name,
        cover_url: coverUrl(game),
      })
      setStatusByGame((s) => ({ ...s, [game.id]: 'added' }))
      onAdded?.(listId)
    } catch (err) {
      setStatusByGame((s) => ({ ...s, [game.id]: errorMessage(err) }))
    }
  }

  return (
    <div>
      <form onSubmit={handleSearch}>
        <input
          type="search"
          aria-label="Search for a game"
          name="q"
          maxLength={100}
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a game, e.g. Hades…"
        />
        <button type="submit" disabled={loading}>
          <Search size={16} aria-hidden="true" />
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="results">
        {games.map((game) => {
          const cover = coverUrl(game)
          const status = statusByGame[game.id]
          return (
            <div key={game.id} className="game-card">
              {cover && <img src={cover} alt={game.name} width="264" height="352" loading="lazy" decoding="async" />}
              <h3 translate="no">{game.name}</h3>
              <div className="add-row">
                <select
                  value={listIdFor(game.id)}
                  onChange={(e) =>
                    setSelectedListByGame((s) => ({ ...s, [game.id]: Number(e.target.value) }))
                  }
                  disabled={lists.length === 0}
                >
                  {lists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleAdd(game)}
                  disabled={lists.length === 0 || status === 'adding'}
                >
                  <Plus size={15} aria-hidden="true" />
                  Add to List
                </button>
              </div>
              {status === 'added' && (
                <p className="status-ok" role="status">
                  Added!
                </p>
              )}
              {status && status !== 'adding' && status !== 'added' && (
                <p className="error" role="alert">
                  {status}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
