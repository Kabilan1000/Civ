import { describe, expect, it } from 'vitest'
import { shortcutFor } from './shortcuts.ts'

describe('keyboard shortcuts', () => {
  it('maps Space and 1/2/3 on the page body', () => {
    expect(shortcutFor({ key: ' ', targetTag: 'BODY' })).toBe('togglePause')
    expect(shortcutFor({ key: '1', targetTag: 'BODY' })).toBe('speed1')
    expect(shortcutFor({ key: '2', targetTag: 'BODY' })).toBe('speed3')
    expect(shortcutFor({ key: '3', targetTag: 'CANVAS' })).toBe('speed10')
    expect(shortcutFor({ key: '4', targetTag: 'BODY' })).toBe('speed100')
    expect(shortcutFor({ key: '5', targetTag: 'BODY' })).toBeNull()
    expect(shortcutFor({ key: 'Escape', targetTag: 'BODY' })).toBe('deselect')
    expect(shortcutFor({ key: 'x', targetTag: 'BODY' })).toBeNull()
  })

  it('never fires while typing or with modifier keys', () => {
    for (const key of [' ', '1', '2', '3', '4', 'Escape']) {
      expect(shortcutFor({ key, targetTag: 'INPUT' })).toBeNull()
      expect(shortcutFor({ key, targetTag: 'TEXTAREA' })).toBeNull()
      expect(shortcutFor({ key, targetTag: 'DIV', targetEditable: true })).toBeNull()
    }
    expect(shortcutFor({ key: '1', ctrlKey: true })).toBeNull()
    expect(shortcutFor({ key: '2', metaKey: true })).toBeNull()
    expect(shortcutFor({ key: ' ', altKey: true })).toBeNull()
  })

  it('leaves Space to a focused control and Escape to an open dialog', () => {
    expect(shortcutFor({ key: ' ', targetTag: 'BUTTON' })).toBeNull()
    expect(shortcutFor({ key: ' ', targetTag: 'DIV', targetRole: 'tab' })).toBeNull()
    expect(shortcutFor({ key: '2', targetTag: 'BUTTON' })).toBe('speed3') // digits don't conflict with buttons
    expect(shortcutFor({ key: 'Escape', dialogOpen: true })).toBeNull()
    expect(shortcutFor({ key: ' ', dialogOpen: true })).toBeNull()
  })
})
