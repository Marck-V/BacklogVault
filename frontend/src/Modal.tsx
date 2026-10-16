import { useEffect, useRef, type AriaRole, type ReactNode } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// The shared shell for every pop-up: announced as a dialog, closes on Escape or a click on the dimmed area, keeps Tab
// inside, stops the page behind it from scrolling, and puts focus back where it was when it closes.
// Mark one element data-autofocus to have it focused on open (only with a mouse or trackpad, so phones do not pop
// the keyboard open); otherwise the dialog itself takes focus.
interface ModalProps {
  onClose: () => void
  // The dialog's name: either text (label) or the id of a heading inside it (labelledBy).
  label?: string
  labelledBy?: string
  describedBy?: string
  role?: AriaRole
  className?: string
  children: ReactNode
}

export default function Modal({ onClose, label, labelledBy, describedBy, role = 'dialog', className = '', children }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const preferred = dialog.querySelector<HTMLElement>('[data-autofocus]')
    const finePointer = Boolean(window.matchMedia?.('(pointer: fine)').matches)
    ;(preferred && finePointer ? preferred : dialog).focus()

    function handleKeyDown(e: KeyboardEvent) {
      if (!dialog) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return

      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      if (previouslyFocused?.isConnected) previouslyFocused.focus?.()
    }
  }, [])

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className={`modal ${className}`.trim()}
        role={role}
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  )
}
