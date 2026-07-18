interface Props {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({ open, title, body, confirmLabel, cancelLabel, onConfirm, onCancel }: Props): JSX.Element | null {
  if (!open) return null
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{title}</h3>
        <p className="modal-desc">{body}</p>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button className="btn btn-destructive" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
