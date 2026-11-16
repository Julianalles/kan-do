import { describe, expect, it } from 'vitest'
import { isBrowserShortcut } from '~/lib/nativeShortcuts'

// #398: the production desktop app swallows reload, print and page zoom, and nothing else.

interface Chord { key: string, code?: string, metaKey?: boolean, ctrlKey?: boolean, altKey?: boolean }
const chord = (c: Chord) => ({ code: '', metaKey: false, ctrlKey: false, altKey: false, ...c })

describe('isBrowserShortcut', () => {
  it('blocks reload: F5, Cmd/Ctrl+R, with Shift', () => {
    expect(isBrowserShortcut(chord({ key: 'F5' }))).toBe(true)
    expect(isBrowserShortcut(chord({ key: 'F5', ctrlKey: true }))).toBe(true)
    expect(isBrowserShortcut(chord({ key: 'r', metaKey: true }))).toBe(true)
    expect(isBrowserShortcut(chord({ key: 'R', metaKey: true }))).toBe(true) // Cmd+Shift+R
    expect(isBrowserShortcut(chord({ key: 'r', ctrlKey: true }))).toBe(true)
  })

  it('blocks print: Cmd/Ctrl+P', () => {
    expect(isBrowserShortcut(chord({ key: 'p', metaKey: true }))).toBe(true)
    expect(isBrowserShortcut(chord({ key: 'P', ctrlKey: true }))).toBe(true)
  })

  it('blocks page zoom by key and by code, on any layout and the numpad', () => {
    for (const key of ['+', '=', '-', '_', '0']) {
      expect(isBrowserShortcut(chord({ key, metaKey: true }))).toBe(true)
      expect(isBrowserShortcut(chord({ key, ctrlKey: true }))).toBe(true)
    }
    for (const code of ['Equal', 'Minus', 'Digit0', 'Numpad0', 'NumpadAdd', 'NumpadSubtract']) {
      expect(isBrowserShortcut(chord({ key: 'Unidentified', code, metaKey: true }))).toBe(true)
    }
  })

  it('leaves the bare keys alone: typing r, p, + or - in a field is not a shortcut', () => {
    for (const key of ['r', 'p', '+', '-', '=', '0', 'R', 'P']) {
      expect(isBrowserShortcut(chord({ key }))).toBe(false)
    }
  })

  it('leaves editing and the app\'s own chords alone', () => {
    for (const key of ['a', 'c', 'v', 'x', 'z', 'n', '1', '2', '3', ',', 'Enter']) {
      expect(isBrowserShortcut(chord({ key, metaKey: true }))).toBe(false)
      expect(isBrowserShortcut(chord({ key, ctrlKey: true }))).toBe(false)
    }
  })

  it('does not take Cmd+Alt+R or Cmd+Alt+P (not the browser chords)', () => {
    expect(isBrowserShortcut(chord({ key: 'r', metaKey: true, altKey: true }))).toBe(false)
    expect(isBrowserShortcut(chord({ key: 'p', metaKey: true, altKey: true }))).toBe(false)
  })
})
