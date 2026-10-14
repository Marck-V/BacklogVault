import { CheckCheck, EyeOff, X } from 'lucide-react'
import { STATUSES } from './statuses'

// The bar that appears at the bottom of the list page in select mode: how many games are picked, quick ways to pick
// more or none, and one button per status to apply to all of them at once.
export default function BulkStatusBar({ count, visibleCount, busy, message, onSelectAll, onClear, onApply, onHide }) {
  const none = count === 0
  return (
    <section className="bulk-bar" aria-label="Change several games at once">
      <span className="bulk-count">
        {count} {count === 1 ? 'game' : 'games'} selected
      </span>

      <button type="button" className="btn-ghost" onClick={onSelectAll} disabled={busy || count === visibleCount}>
        <CheckCheck size={15} aria-hidden="true" />
        Select All ({visibleCount})
      </button>
      <button type="button" className="btn-ghost" onClick={onClear} disabled={busy || none}>
        <X size={15} aria-hidden="true" />
        Clear
      </button>

      <div className="bulk-statuses" role="group" aria-label="Set the status of the selected games">
        <span className="bulk-statuses-label" aria-hidden="true">
          Set to
        </span>
        {STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            className={`status-badge status-${status.toLowerCase()}`}
            disabled={busy || none}
            onClick={() => onApply(status)}
          >
            {status}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="btn-ghost"
        disabled={busy || none}
        onClick={onHide}
        title="Keep the games but leave them out of the dashboard"
      >
        <EyeOff size={15} aria-hidden="true" />
        Hide
      </button>

      <span className="bulk-message" role="status">
        {message && !message.error ? message.text : ''}
      </span>
      {message?.error && (
        <span className="error bulk-message" role="alert">
          {message.text}
        </span>
      )}
    </section>
  )
}
