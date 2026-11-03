// Keyboard shortcuts (UI only).
//   Space  play / pause        1 / 2 / 3  speed 1x / 3x / 10x
//   Escape close the topmost dialog (handled by Modal), otherwise deselect
// Shortcuts never fire while typing in a text field, with a modifier key held
// (browser/OS shortcuts keep working), or — for Space — while a button, link
// or other control has focus (Space activates that control instead).

export type ShortcutAction = 'togglePause' | 'speed1' | 'speed3' | 'speed10' | 'deselect'

export interface KeyInfo {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  /** Tag name of the focused element (event.target), upper case. */
  targetTag?: string
  targetEditable?: boolean
  /** ARIA role of the focused element, if any. */
  targetRole?: string | null
  /** A modal dialog is open (Escape belongs to it). */
  dialogOpen?: boolean
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])
const CONTROL_TAGS = new Set(['BUTTON', 'A', 'SUMMARY'])
const CONTROL_ROLES = new Set(['button', 'tab', 'link', 'checkbox', 'switch', 'menuitem', 'option'])

export function shortcutFor(k: KeyInfo): ShortcutAction | null {
  if (k.ctrlKey || k.metaKey || k.altKey) return null
  if (k.targetEditable || (k.targetTag && TYPING_TAGS.has(k.targetTag))) return null
  if (k.key === 'Escape') return k.dialogOpen ? null : 'deselect'
  if (k.dialogOpen) return null
  if (k.key === ' ' || k.key === 'Spacebar') {
    const onControl = (k.targetTag && CONTROL_TAGS.has(k.targetTag)) || (k.targetRole && CONTROL_ROLES.has(k.targetRole))
    return onControl ? null : 'togglePause'
  }
  if (k.key === '1') return 'speed1'
  if (k.key === '2') return 'speed3'
  if (k.key === '3') return 'speed10'
  return null
}
