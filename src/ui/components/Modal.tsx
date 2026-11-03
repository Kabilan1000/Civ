import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}

/** Open modals, innermost last: only the top one reacts to Escape. */
const stack: object[] = []

/**
 * Accessible modal: Escape (topmost only) and backdrop click close it. Focus
 * moves into it once when it opens and returns to the opener when it closes.
 * The effect runs once per mount — `onClose` is read through a ref, because
 * parents pass a new function on every render (the UI re-renders at 5 Hz) and
 * re-running the effect would keep pulling focus back to the dialog.
 */
export function Modal({ title, onClose, children, wide }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])
  useEffect(() => {
    const token = {}
    stack.push(token)
    const opener = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack.at(-1) === token) onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      stack.splice(stack.indexOf(token), 1)
      if (opener?.isConnected) opener.focus()
    }
  }, [])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export interface ConfirmRequest {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
}

export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest; onClose: () => void }) {
  return (
    <Modal title={request.title} onClose={onClose}>
      <p className="confirm-text">{request.message}</p>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className={`btn ${request.danger ? 'danger' : 'primary-btn'}`}
          onClick={() => {
            onClose()
            request.onConfirm()
          }}
        >
          {request.confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
