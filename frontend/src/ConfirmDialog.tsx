import { useId, type ReactNode } from 'react'
import Modal from './Modal'

interface ConfirmDialogProps {
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({ message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel }: ConfirmDialogProps) {
  const messageId = useId()
  return (
    <Modal onClose={onCancel} role="alertdialog" describedBy={messageId} label="Please confirm" className="confirm-dialog">
      <p id={messageId}>{message}</p>
      <div className="confirm-dialog-actions">
        {/* The safe choice takes focus first, so a stray Enter cannot confirm. */}
        <button type="button" className="confirm-no" onClick={onCancel} data-autofocus>
          {cancelLabel}
        </button>
        <button type="button" className="confirm-yes" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
