export default function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <p>{message}</p>
        <div className="confirm-dialog-actions">
          <button type="button" className="confirm-no" onClick={onCancel}>
            No
          </button>
          <button type="button" className="confirm-yes" onClick={onConfirm}>
            Yes
          </button>
        </div>
      </div>
    </div>
  )
}
