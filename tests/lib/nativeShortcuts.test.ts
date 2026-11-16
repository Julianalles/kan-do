import { describe, expect, it } from 'vitest'
import { isBrowserShortcut } from '~/lib/nativeShortcuts'

// #398: the production desktop app swallows reload, print and page zoom, and nothing else. The shortcut modifier is Cmd on
// macOS and Ctrl elsewhere; on macOS the Ctrl chords are Cocoa text bindings (Ctrl+P moves up a line) and pass through.

interface Chord { key: string, code?: string, altKey?: boolean }
const chord = (c: Chord, mod: 'meta' | 'ctrl' | 'none') => ({
  code: '', altKey: false, ...c, metaKey: mod === 'meta', ctrlKey: mod === 'ctrl',
})
/** `platform.mod` is the platform's own shortcut modifier, `platform.other` the one it leaves alone. */
const mac = { mac: true, mod: 'meta', other: 'ctrl' } as const
const pc = { mac: false, mod: 'ctrl', other: 'meta' } as const

describe.each([['macOS', mac], ['Windows/Linux', pc]])('isBrowserShortcut on %s', (_name, platform) => {
  const blocked = (c: Chord, mod: 'meta' | 'ctrl' | 'none' = platform.mod) => isBrowserShortcut(chord(c, mod), platform.mac)

  it('blocks reload: F5, mod+R, with Shift', () => {
    expect(blocked({ key: 'F5' }, 'none')).toBe(true)
    expect(blocked({ key: 'F5' }, platform.other)).toBe(true)
    expect(blocked({ key: 'r' })).toBe(true)
    expect(blocked({ key: 'R' })).toBe(true) // mod+Shift+R
  })

  it('blocks print: mod+P', () => {
    expect(blocked({ key: 'p' })).toBe(true)
    expect(blocked({ key: 'P' })).toBe(true)
  })

  it('blocks page zoom by key and by code, on any layout and the numpad', () => {
    for (const key of ['+', '=', '-', '_', '0']) expect(blocked({ key })).toBe(true)
    for (const code of ['Equal', 'Minus', 'Digit0', 'Numpad0', 'NumpadAdd', 'NumpadSubtract']) {
      expect(blocked({ key: 'Unidentified', code })).toBe(true)
    }
  })

  it('leaves the bare keys alone: typing r, p, + or - in a field is not a shortcut', () => {
    for (const key of ['r', 'p', '+', '-', '=', '0', 'R', 'P']) expect(blocked({ key }, 'none')).toBe(false)
  })

  it('leaves editing and the app\'s own chords alone', () => {
    for (const key of ['a', 'c', 'v', 'x', 'z', 'n', '1', '2', '3', ',', 'Enter']) expect(blocked({ key })).toBe(false)
  })

  it('does not take mod+Alt+R or mod+Alt+P (not the browser chords)', () => {
    expect(blocked({ key: 'r', altKey: true })).toBe(false)
    expect(blocked({ key: 'p', altKey: true })).toBe(false)
  })

  it('leaves the other platform\'s modifier to the text field', () => {
    for (const key of ['r', 'p', '=', '-', '0']) expect(blocked({ key }, platform.other)).toBe(false)
  })
})

describe('isBrowserShortcut: macOS text bindings', () => {
  it('lets Ctrl+P (up a line), Ctrl+N, Ctrl+A, Ctrl+E and Ctrl+R pass through to a text field', () => {
    for (const key of ['p', 'P', 'n', 'a', 'e', 'r']) {
      expect(isBrowserShortcut(chord({ key }, 'ctrl'), true), key).toBe(false)
    }
  })

  it('still cancels Cmd+P, Cmd+R and Cmd+= there', () => {
    for (const key of ['p', 'r', '=']) expect(isBrowserShortcut(chord({ key }, 'meta'), true), key).toBe(true)
  })
})
