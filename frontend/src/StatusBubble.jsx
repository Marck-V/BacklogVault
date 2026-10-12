import { useState, useRef, useEffect } from 'react'
import { STATUSES } from './statuses'

const STATUS_CLASS = {
  Backlog: 'status-backlog',
  Playing: 'status-playing',
  Completed: 'status-completed',
  Dropped: 'status-dropped',
}

export default function StatusBubble({ status, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div className="status-bubble-wrap" ref={ref}>
      <button
        type="button"
        className={`status-badge ${STATUS_CLASS[status] ?? ''}`}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        {status}
      </button>
      {open && (
        <div className="status-dropdown" onClick={(e) => e.stopPropagation()}>
          {STATUSES.filter((s) => s !== status).map((s) => (
            <button
              key={s}
              type="button"
              className={`status-option ${STATUS_CLASS[s]}`}
              onClick={() => {
                onChange(s)
                setOpen(false)
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
