/**
 * #383: what the floating Now window derives from a snapshot: the wall-clock count, the label, the ring, the amber
 * last minute and overrun, the paused state, and the tolerant reading of a snapshot that arrives over the wire.
 */
import { describe, expect, it } from 'vitest'
import { lineAnimates, lineFrame, nowView, parseSnapshot, spentAt, type NowSnapshot } from '~/lib/nowWindow'

const AT = 1_763_300_000_000
const snap = (extra: Partial<NowSnapshot> = {}): NowSnapshot => ({
  taskId: 'a', title: 'Release notes', timeBoxSeconds: 1500, spentSeconds: 860, at: AT, running: true, locale: 'de', ...extra,
})

describe('spentAt', () => {
  it('counts on by the wall clock while running', () => {
    expect(spentAt(snap(), AT)).toBe(860)
    expect(spentAt(snap(), AT + 12_999)).toBe(872)
  })
  it('stands still while paused, and never goes backwards when the clock does', () => {
    expect(spentAt(snap({ running: false }), AT + 60_000)).toBe(860)
    expect(spentAt(snap(), AT - 5000)).toBe(860)
  })
})

describe('nowView', () => {
  it('shows the remaining time as m:ss with the line at the share that is left', () => {
    const v = nowView(snap(), AT)
    expect(v.label).toBe('10:40')
    expect(v.line).toBeCloseTo(640 / 1500)
    expect(v).toMatchObject({ mode: 'left', tone: 'normal', over: false, paused: false })
  })
  it('starts full and ends empty', () => {
    expect(nowView(snap({ spentSeconds: 0 }), AT).line).toBe(1)
    expect(nowView(snap({ spentSeconds: 1500 }), AT).line).toBe(0)
  })
  it('reads h:mm:ss from an hour on', () => {
    expect(nowView(snap({ timeBoxSeconds: 7200, spentSeconds: 0 }), AT).label).toBe('2:00:00')
    expect(nowView(snap({ timeBoxSeconds: 3661, spentSeconds: 0 }), AT).label).toBe('1:01:01')
  })
  it("turns amber above 80 % of the timebox spent, as the app's bar does (`getTimeboxRingColor`)", () => {
    expect(nowView(snap({ spentSeconds: 1200 }), AT).tone).toBe('normal')
    expect(nowView(snap({ spentSeconds: 1201 }), AT).tone).toBe('warning')
    expect(nowView(snap({ spentSeconds: 1499 }), AT).label).toBe('0:01')
  })
  it('stays amber over the timebox and reads the overrun as +m:ss; the line is full again (it has run out)', () => {
    const v = nowView(snap({ spentSeconds: 1500 + 130 }), AT)
    expect(v).toMatchObject({ label: '+2:10', mode: 'over', tone: 'warning', over: true, line: 1 })
  })
  it('a task without a timebox has no line and counts the time passed up, never amber', () => {
    expect(nowView(snap({ timeBoxSeconds: null, spentSeconds: 125 }), AT)).toEqual({ line: null, mode: 'elapsed', label: '2:05', tone: 'normal', over: false, paused: false })
    expect(nowView(snap({ timeBoxSeconds: null, spentSeconds: 3725 }), AT).label).toBe('1:02:05')
    expect(nowView(snap({ timeBoxSeconds: null, spentSeconds: 99_999 }), AT).tone).toBe('normal')
    expect(nowView(snap({ timeBoxSeconds: null, spentSeconds: 125 }), AT + 5000).label).toBe('2:10')
  })
  it('paused is reported and the time does not move', () => {
    const v = nowView(snap({ running: false }), AT + 90_000)
    expect(v.paused).toBe(true)
    expect(v.label).toBe('10:40')
  })
})

describe('parseSnapshot', () => {
  it('reads a well-formed snapshot', () => {
    expect(parseSnapshot(snap())).toEqual(snap())
    expect(parseSnapshot({ ...snap(), timeBoxSeconds: null })?.timeBoxSeconds).toBeNull()
  })
  it.each([
    ['null', null], ['a string', 'x'], ['an array', []], ['no task id', { ...snap(), taskId: 3 }], ['a numeric title', { ...snap(), title: 4 }],
    ['a zero timebox', { ...snap(), timeBoxSeconds: 0 }], ['a string timebox', { ...snap(), timeBoxSeconds: '25' }],
    ['NaN seconds', { ...snap(), spentSeconds: Number.NaN }], ['running as a string', { ...snap(), running: 'yes' }], ['no locale', { ...snap(), locale: undefined }],
  ])('reads %s as none', (_name, value) => {
    expect(parseSnapshot(value)).toBeNull()
  })
  it('clamps negative spent time to zero', () => {
    expect(parseSnapshot({ ...snap(), spentSeconds: -5 })?.spentSeconds).toBe(0)
  })
})

describe('lineAnimates: the timer line glides on a tick and jumps on anything else (#436)', () => {
  const frame = (extra: Partial<NowSnapshot> = {}, at = AT) => {
    const snapshot = snap(extra)
    return lineFrame(snapshot, nowView(snapshot, at))
  }
  it('glides from one second to the next', () => {
    expect(lineAnimates(frame(), frame({}, AT + 1000))).toBe(true)
    expect(lineAnimates(frame(), frame({}, AT + 2000))).toBe(true)
  })
  it('does not animate the first frame', () => {
    expect(lineAnimates(null, frame())).toBe(false)
  })
  it('does not glide when the clock jumps (a resumed window, a wake from sleep)', () => {
    expect(lineAnimates(frame(), frame({}, AT + 60_000))).toBe(false)
  })
  it('jumps when the task changes, even at the same width', () => {
    expect(lineAnimates(frame(), frame({ taskId: 'b' }))).toBe(false)
  })
  it('jumps when the timebox changes', () => {
    expect(lineAnimates(frame(), frame({ timeBoxSeconds: 3000 }, AT + 1000))).toBe(false)
  })
  it('jumps at the timebox instead of growing from the end to full', () => {
    const last = frame({ spentSeconds: 1499 })
    const over = frame({ spentSeconds: 1501 })
    expect(over.over).toBe(true)
    expect(lineAnimates(last, over)).toBe(false)
  })
  it('does not animate with no line, or in the overrun where it stays full', () => {
    expect(lineAnimates(frame({ timeBoxSeconds: null }), frame({ timeBoxSeconds: null }, AT + 1000))).toBe(false)
    expect(lineAnimates(frame({ spentSeconds: 1600 }), frame({ spentSeconds: 1600 }, AT + 1000))).toBe(false)
  })
})
