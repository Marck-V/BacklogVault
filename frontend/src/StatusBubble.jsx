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
  const triggerRef = useRef(null)
  const options = STATUSES.filter((s) => s !== status)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  // Opening the menu moves focus to its first option, so it can be driven from the keyboard.
  useEffect(() => {
    if (open) ref.current?.querySelector('[role="menuitem"]')?.focus()
  }, [open])

  function closeAndRefocus() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  function handleMenuKeyDown(e) {
    const items = [...ref.current.querySelectorAll('[role="menuitem"]')]
    const index = items.indexOf(document.activeElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeAndRefocus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      items[(index + 1) % items.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      items[(index - 1 + items.length) % items.length]?.focus()
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div className="status-bubble-wrap" ref={ref}>
      <button
        type="button"
        ref={triggerRef}
        className={`status-badge ${STATUS_CLASS[status] ?? ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        {status}
      </button>
      {open && (
        <div
          className="status-dropdown"
          role="menu"
          aria-label="Change status"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleMenuKeyDown}
        >
          {options.map((s) => (
            <button
              key={s}
              type="button"
              role="menuitem"
              className={`status-option ${STATUS_CLASS[s]}`}
              onClick={() => {
                onChange(s)
                closeAndRefocus()
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
