import type { ReactNode } from 'react'
interface Props {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
  /** Style the confirm button as a destructive (red) action. Defaults to true. */
  destructive?: boolean
  /** Extra content rendered under the body — e.g. an option the confirmation depends on. */
  extra?: ReactNode
}

export function ConfirmModal({ open, title, body, confirmLabel, cancelLabel, onConfirm, onCancel, destructive = true, extra }: Props): JSX.Element | null {
  if (!open) return null
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{title}</h3>
        <p className="modal-desc">{body}</p>
        {extra}
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button className={`btn ${destructive ? 'btn-destructive' : 'btn-primary'}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
