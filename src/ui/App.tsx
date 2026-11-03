import { useCallback, useEffect, useState } from 'react'
import { Autosaver } from '../app/Autosaver.ts'
import { useSimulation } from '../app/useSimulation.ts'
import { SaveStore } from '../persistence/storage.ts'
import { Controls } from './components/Controls.tsx'
import { Dashboard } from './components/Dashboard.tsx'
import { EventFeed } from './components/EventFeed.tsx'
import { HistoryCharts } from './components/HistoryCharts.tsx'
import { Inspector } from './components/Inspector.tsx'
import { MapView } from './components/MapView.tsx'
import { ConfirmDialog, type ConfirmRequest } from './components/Modal.tsx'
import { SaveDialog } from './components/SaveDialog.tsx'
import { selectedIn, type Selection } from './selection.ts'
import { shortcutFor } from './shortcuts.ts'

interface Toast {
  id: number
  kind: 'ok' | 'error'
  text: string
}

export default function App() {
  const { controller, snapshot } = useSimulation()
  const { width, height } = controller.state.config
  const [store] = useState(() => new SaveStore())
  const [autosaver] = useState(() => new Autosaver(controller, store))

  // UI-only state: which citizen is inspected, tied to the world it belongs to.
  const [selection, setSelection] = useState<Selection | null>(null)
  const selectedId = selectedIn(selection, snapshot.worldId)
  const select = useCallback(
    (id: number | null) => setSelection(id === null ? null : { worldId: controller.currentWorldId, citizenId: id }),
    [controller],
  )

  const [saves, setSaves] = useState<'save' | 'load' | null>(null)
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const notify = useCallback((kind: 'ok' | 'error', text: string) => setToast({ id: Date.now(), kind, text }), [])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), toast.kind === 'error' ? 8000 : 4000)
    return () => window.clearTimeout(t)
  }, [toast])

  // Autosave lifecycle (one timer; stopped on unmount). Failures surface as a toast.
  useEffect(() => {
    autosaver.start()
    const unsubscribe = autosaver.subscribe(() => {
      const err = autosaver.getStatus().lastError
      if (err) notify('error', `Autosave failed: ${err.message}`)
    })
    // Best effort only: browsers may not complete work during page unload.
    const onHide = () => {
      if (controller.getSnapshot().unsaved) autosaver.saveNow()
    }
    window.addEventListener('pagehide', onHide)
    return () => {
      autosaver.stop()
      unsubscribe()
      window.removeEventListener('pagehide', onHide)
    }
  }, [autosaver, controller, notify])

  // Keyboard shortcuts (see ui/shortcuts.ts). Escape inside a dialog is handled by the dialog.
  const dialogOpen = saves !== null || confirmRequest !== null
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const action = shortcutFor({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        targetTag: target?.tagName,
        targetEditable: target?.isContentEditable,
        targetRole: target?.getAttribute?.('role') ?? null,
        dialogOpen,
      })
      if (!action) return
      e.preventDefault()
      if (action === 'togglePause') controller.togglePause()
      else if (action === 'speed1') controller.setSpeed(1)
      else if (action === 'speed3') controller.setSpeed(3)
      else if (action === 'speed10') controller.setSpeed(10)
      else if (action === 'deselect') setSelection(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [controller, dialogOpen])

  // Dev-only handle for automated browser checks (stripped from production builds).
  useEffect(() => {
    if (import.meta.env.DEV) {
      ;(window as unknown as { __littleWorlds?: unknown }).__littleWorlds = { controller, store, autosaver }
    }
  }, [controller, store, autosaver])

  return (
    <div className="app">
      <header className="topbar">
        <h1>Little Worlds</h1>
        <Controls controller={controller} snapshot={snapshot} onOpenSaves={setSaves} confirm={setConfirmRequest} notify={notify} />
      </header>

      <main className="layout">
        <div className="world-col">
          <MapView controller={controller} aspect={`${width} / ${height}`} selectedId={selectedId} onSelect={select} />
          <div className="below-map">
            <EventFeed controller={controller} lastEventId={snapshot.lastEventId} worldId={snapshot.worldId} onSelect={select} />
            <HistoryCharts controller={controller} historyLength={snapshot.historyLength} worldId={snapshot.worldId} />
          </div>
        </div>
        <aside className="sidebar">
          <Dashboard snapshot={snapshot} />
          <Inspector controller={controller} snapshot={snapshot} selectedId={selectedId} onSelect={select} />
        </aside>
      </main>

      <footer className="footer" aria-label="Keyboard shortcuts">
        <span><kbd>Space</kbd> play / pause</span>
        <span><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> speed 1× / 3× / 10×</span>
        <span><kbd>Esc</kbd> close dialog or deselect</span>
        <span className="muted">Click a citizen to inspect them</span>
      </footer>

      {saves && (
        <SaveDialog
          mode={saves}
          controller={controller}
          store={store}
          autosaver={autosaver}
          unsaved={snapshot.unsaved}
          onClose={() => setSaves(null)}
          confirm={setConfirmRequest}
          notify={notify}
        />
      )}
      {confirmRequest && <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />}
      {toast && (
        <div key={toast.id} className={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
          {toast.text}
          <button type="button" className="icon-button" onClick={() => setToast(null)} aria-label="Dismiss">×</button>
        </div>
      )}
    </div>
  )
}
