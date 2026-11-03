import { useState, useSyncExternalStore } from 'react'
import type { Autosaver } from '../../app/Autosaver.ts'
import type { SimulationController } from '../../app/SimulationController.ts'
import { AUTOSAVE_SLOT, SLOT_LABELS, type SaveStore, type SlotId, type SlotInfo } from '../../persistence/storage.ts'
import { Modal, type ConfirmRequest } from './Modal.tsx'

const pad = (n: number) => String(n).padStart(2, '0')

export type Notify = (kind: 'ok' | 'error', text: string) => void

interface Props {
  mode: 'save' | 'load'
  controller: SimulationController
  store: SaveStore
  autosaver: Autosaver
  unsaved: boolean
  onClose: () => void
  confirm: (request: ConfirmRequest) => void
  notify: Notify
}

function describeMeta(info: SlotInfo) {
  if (info.status === 'empty' || !('meta' in info) || !info.meta) return null
  const m = info.meta
  const saved = new Date(m.savedAt)
  return (
    <div className="slot-meta">
      <span title="Seed">Seed “{m.seed}”</span>
      <span className="num">Day {m.day} · {pad(m.hour)}:{pad(m.minute)}</span>
      <span className="num">{m.population} citizens</span>
      <span className="muted num" title={saved.toString()}>
        saved {Number.isNaN(saved.getTime()) ? 'unknown' : saved.toLocaleString()}
      </span>
    </div>
  )
}

export function SaveDialog({ mode, controller, store, autosaver, unsaved, onClose, confirm, notify }: Props) {
  const [tab, setTab] = useState(mode)
  const [version, setVersion] = useState(0) // bump to re-read slots after an action
  const autosave = useSyncExternalStore(autosaver.subscribe, autosaver.getStatus)
  const slots = store.list()
  void version
  const refresh = () => setVersion((v) => v + 1)

  const save = (slot: SlotId) => {
    const result = store.save(slot, controller.state)
    if (result.ok) {
      controller.markSaved()
      notify('ok', `Saved to ${SLOT_LABELS[slot]}.`)
    } else {
      notify('error', result.message)
    }
    refresh()
  }

  const load = (slot: SlotId) => {
    const result = store.load(slot)
    if (!result.ok) {
      notify('error', result.message) // the running world is untouched
      refresh()
      return
    }
    controller.loadWorld(result.value.state)
    const m = result.value.meta
    notify('ok', `Loaded ${SLOT_LABELS[slot]} — seed “${m.seed}”, day ${m.day}. Paused: press Play to continue.`)
    onClose()
  }

  const remove = (slot: SlotId) => {
    const result = store.delete(slot)
    notify(result.ok ? 'ok' : 'error', result.ok ? `${SLOT_LABELS[slot]} deleted.` : result.message)
    refresh()
  }

  return (
    <Modal title="Saved worlds" onClose={onClose} wide>
      <div className="tabs" role="tablist">
        {(['save', 'load'] as const).map((t) => (
          <button key={t} type="button" role="tab" className="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === 'save' ? 'Save current world' : 'Load a world'}
          </button>
        ))}
      </div>
      {!store.available && (
        <p className="notice error">Browser storage is unavailable here (private mode or blocked site data), so saving is disabled.</p>
      )}
      <ul className="slots">
        {slots.map((info) => {
          const isAuto = info.id === AUTOSAVE_SLOT
          const occupied = info.status !== 'empty'
          return (
            <li key={info.id} className={`slot ${info.status}`}>
              <div className="slot-main">
                <div className="slot-title">
                  <strong>{SLOT_LABELS[info.id]}</strong>
                  <span className={`badge ${info.status}`}>
                    {info.status === 'empty' ? 'Empty' : info.status === 'ok' ? 'Saved world' : 'Damaged'}
                  </span>
                </div>
                {describeMeta(info) ?? (
                  <div className="muted small">
                    {info.status === 'corrupt'
                      ? 'Its details could not be read.'
                      : isAuto
                        ? 'Written automatically every 5 minutes of play.'
                        : 'No world saved here.'}
                  </div>
                )}
                {info.status === 'corrupt' && <div className="slot-error small">{info.message}</div>}
              </div>
              <div className="slot-actions">
                {tab === 'save' && !isAuto && (
                  <button
                    type="button"
                    className="btn primary-btn"
                    disabled={!store.available}
                    onClick={() =>
                      occupied
                        ? confirm({
                            title: `Overwrite ${SLOT_LABELS[info.id]}?`,
                            message: 'The world saved in this slot will be replaced by the current world. This cannot be undone.',
                            confirmLabel: 'Overwrite',
                            danger: true,
                            onConfirm: () => save(info.id),
                          })
                        : save(info.id)
                    }
                  >
                    {occupied ? 'Overwrite' : 'Save here'}
                  </button>
                )}
                {tab === 'load' && (
                  <button
                    type="button"
                    className="btn primary-btn"
                    disabled={info.status !== 'ok'}
                    title={info.status === 'corrupt' ? 'This save is damaged' : undefined}
                    onClick={() =>
                      unsaved
                        ? confirm({
                            title: 'Load and discard current progress?',
                            message: 'The current world has progress that is not saved. Loading replaces it.',
                            confirmLabel: 'Load',
                            danger: true,
                            onConfirm: () => load(info.id),
                          })
                        : load(info.id)
                    }
                  >
                    Load
                  </button>
                )}
                {occupied && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      confirm({
                        title: `Delete ${SLOT_LABELS[info.id]}?`,
                        message: 'The saved world in this slot will be permanently deleted.',
                        confirmLabel: 'Delete',
                        danger: true,
                        onConfirm: () => remove(info.id),
                      })
                    }
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      <p className="muted small autosave-line">
        {autosave.lastError
          ? `Last autosave failed: ${autosave.lastError.message}`
          : autosave.lastSavedAt
            ? `Last autosave at ${autosave.lastSavedAt.toLocaleTimeString()}.`
            : 'Autosave runs after every 5 minutes of play, if the world has changed. Closing the tab may skip the last autosave.'}
      </p>
    </Modal>
  )
}
