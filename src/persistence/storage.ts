// Browser save slots (localStorage). Lives outside src/sim: the simulation
// only provides serialize()/deserialize(); this layer adds slots, metadata
// and error handling.
//
// Slots: 'slot1' | 'slot2' | 'slot3' (manual) and 'autosave' (written only
// by the Autosaver). Each key holds one SaveFile:
//   { format: 'little-worlds-save', fileVersion: 1, meta, world }
// where `world` is the plain serialized WorldState (schema v5 today; older
// schemas are migrated by deserialize on load). `meta.savedAt` is a browser
// timestamp kept in the FILE only — never in the simulation state.
//
// Every operation returns a result object instead of throwing, so storage
// that is missing, full (quota) or corrupted never crashes the game.

import {
  SaveError,
  deserialize,
  getCivStats,
  getClockTime,
  getDayNumber,
  serialize,
  type WorldState,
} from '../sim/index.ts'

export const MANUAL_SLOTS = ['slot1', 'slot2', 'slot3'] as const
export const AUTOSAVE_SLOT = 'autosave'
export type ManualSlotId = (typeof MANUAL_SLOTS)[number]
export type SlotId = ManualSlotId | typeof AUTOSAVE_SLOT
export const ALL_SLOTS: readonly SlotId[] = [...MANUAL_SLOTS, AUTOSAVE_SLOT]

export const KEY_PREFIX = 'little-worlds:save:'
const FORMAT = 'little-worlds-save'
const FILE_VERSION = 1

/** The subset of the Web Storage API we use (injectable for tests). */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface SaveMeta {
  seed: string
  tick: number
  day: number
  hour: number
  minute: number
  population: number
  schemaVersion: number
  /** ISO timestamp from the browser clock (file metadata only). */
  savedAt: string
}

export interface SaveFile {
  format: typeof FORMAT
  fileVersion: number
  meta: SaveMeta
  world: unknown
}

export type SlotInfo =
  | { id: SlotId; status: 'empty' }
  | { id: SlotId; status: 'ok'; meta: SaveMeta }
  | { id: SlotId; status: 'corrupt'; message: string; meta?: SaveMeta }

export type StoreErrorCode = 'unavailable' | 'quota' | 'empty' | 'corrupt' | 'unsupported' | 'write-failed'
export interface StoreFailure {
  ok: false
  code: StoreErrorCode
  message: string
}
export type StoreResult<T = undefined> = { ok: true; value: T } | StoreFailure

export const SLOT_LABELS: Record<SlotId, string> = { slot1: 'Slot 1', slot2: 'Slot 2', slot3: 'Slot 3', autosave: 'Autosave' }

/** localStorage if usable (a probe write succeeds), else null. Never throws. */
export function browserStorage(): StorageLike | null {
  try {
    const s = globalThis.localStorage
    if (!s) return null
    const probe = `${KEY_PREFIX}__probe`
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch {
    return null
  }
}

function isQuotaError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false
  const err = e as { name?: string; code?: number }
  return err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22 || err.code === 1014
}

export function buildMeta(state: WorldState, now: Date): SaveMeta {
  const { hour, minute } = getClockTime(state)
  return {
    seed: state.config.seed,
    tick: state.tick,
    day: getDayNumber(state),
    hour,
    minute,
    population: getCivStats(state).population,
    schemaVersion: state.schemaVersion,
    savedAt: now.toISOString(),
  }
}

function isMeta(m: unknown): m is SaveMeta {
  if (typeof m !== 'object' || m === null) return false
  const x = m as Record<string, unknown>
  return (
    typeof x.seed === 'string' && Number.isInteger(x.tick) && Number.isInteger(x.day) && Number.isInteger(x.hour) &&
    Number.isInteger(x.minute) && Number.isInteger(x.population) && Number.isInteger(x.schemaVersion) && typeof x.savedAt === 'string'
  )
}

function saveErrorMessage(e: unknown): { code: StoreErrorCode; message: string } {
  if (e instanceof SaveError) {
    if (e.code === 'unsupported-version') {
      return { code: 'unsupported', message: `This save can't be loaded by this version of Little Worlds. ${e.message}.` }
    }
    return { code: 'corrupt', message: `This save is damaged and can't be loaded. ${e.message}.` }
  }
  return { code: 'corrupt', message: `This save is damaged and can't be loaded (${e instanceof Error ? e.message : String(e)}).` }
}

export class SaveStore {
  private readonly storage: StorageLike | null

  constructor(storage: StorageLike | null = browserStorage()) {
    this.storage = storage
  }

  get available(): boolean {
    return this.storage !== null
  }

  private unavailable(): StoreFailure {
    return {
      ok: false,
      code: 'unavailable',
      message: 'Browser storage is unavailable (private mode or blocked site data), so worlds cannot be saved here.',
    }
  }

  /** Write `state` to a slot. Nothing is changed if the write fails. */
  save(slot: SlotId, state: WorldState, now: Date = new Date()): StoreResult {
    if (!this.storage) return this.unavailable()
    const file: SaveFile = { format: FORMAT, fileVersion: FILE_VERSION, meta: buildMeta(state, now), world: JSON.parse(serialize(state)) }
    try {
      this.storage.setItem(KEY_PREFIX + slot, JSON.stringify(file))
      return { ok: true, value: undefined }
    } catch (e) {
      if (isQuotaError(e)) {
        return { ok: false, code: 'quota', message: 'Browser storage is full. Delete an old save (or free site data) and try again.' }
      }
      return { ok: false, code: 'write-failed', message: `Saving failed: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  /** Read, migrate and fully validate a slot. Never throws; never touches the running world. */
  load(slot: SlotId): StoreResult<{ state: WorldState; meta: SaveMeta }> {
    if (!this.storage) return this.unavailable()
    let raw: string | null
    try {
      raw = this.storage.getItem(KEY_PREFIX + slot)
    } catch {
      return this.unavailable()
    }
    if (raw === null) return { ok: false, code: 'empty', message: `${SLOT_LABELS[slot]} is empty.` }
    let file: unknown
    try {
      file = JSON.parse(raw)
    } catch {
      return { ok: false, code: 'corrupt', message: `${SLOT_LABELS[slot]} is damaged (not valid JSON).` }
    }
    const f = file as Partial<SaveFile>
    if (typeof f !== 'object' || f === null || f.format !== FORMAT) {
      return { ok: false, code: 'corrupt', message: `${SLOT_LABELS[slot]} doesn't contain a Little Worlds save.` }
    }
    if (typeof f.fileVersion !== 'number' || f.fileVersion > FILE_VERSION) {
      return { ok: false, code: 'unsupported', message: `${SLOT_LABELS[slot]} was written by a newer version of Little Worlds.` }
    }
    if (!isMeta(f.meta)) return { ok: false, code: 'corrupt', message: `${SLOT_LABELS[slot]} has damaged details.` }
    try {
      return { ok: true, value: { state: deserialize(JSON.stringify(f.world)), meta: f.meta } }
    } catch (e) {
      return { ok: false, ...saveErrorMessage(e) }
    }
  }

  delete(slot: SlotId): StoreResult {
    if (!this.storage) return this.unavailable()
    try {
      this.storage.removeItem(KEY_PREFIX + slot)
      return { ok: true, value: undefined }
    } catch (e) {
      return { ok: false, code: 'write-failed', message: `Deleting failed: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  /** Status of every slot. Occupied slots are fully validated, so damage shows up before loading. */
  list(): SlotInfo[] {
    return ALL_SLOTS.map((id): SlotInfo => {
      if (!this.storage) return { id, status: 'empty' }
      let raw: string | null = null
      try {
        raw = this.storage.getItem(KEY_PREFIX + id)
      } catch {
        return { id, status: 'corrupt', message: 'Could not read this slot.' }
      }
      if (raw === null) return { id, status: 'empty' }
      const result = this.load(id)
      if (result.ok) return { id, status: 'ok', meta: result.value.meta }
      let meta: SaveMeta | undefined
      try {
        const m = (JSON.parse(raw) as Partial<SaveFile>).meta
        if (isMeta(m)) meta = m
      } catch {
        // unreadable: no meta to show
      }
      return meta ? { id, status: 'corrupt', message: result.message, meta } : { id, status: 'corrupt', message: result.message }
    })
  }
}
