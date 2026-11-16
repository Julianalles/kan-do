/**
 * #383: what the floating Now window derives from a snapshot: the wall-clock count, the label, the ring, the amber
 * last minute and overrun, the paused state, and the tolerant reading of a snapshot that arrives over the wire.
 */
import { describe, expect, it } from 'vitest'
import { WARNING_SECONDS, nowView, parseSnapshot, spentAt, type NowSnapshot } from '~/lib/nowWindow'

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
  it('shows the remaining time as m:ss with the ring at the spent share', () => {
    const v = nowView(snap(), AT)
    expect(v.label).toBe('10:40')
    expect(v.ring).toBeCloseTo(860 / 1500)
    expect(v).toMatchObject({ tone: 'normal', over: false, paused: false })
  })
  it('reads h:mm:ss from an hour on', () => {
    expect(nowView(snap({ timeBoxSeconds: 7200, spentSeconds: 0 }), AT).label).toBe('2:00:00')
    expect(nowView(snap({ timeBoxSeconds: 3661, spentSeconds: 0 }), AT).label).toBe('1:01:01')
  })
  it('turns amber in the last minute, not before', () => {
    expect(nowView(snap({ spentSeconds: 1500 - WARNING_SECONDS - 1 }), AT).tone).toBe('normal')
    expect(nowView(snap({ spentSeconds: 1500 - WARNING_SECONDS }), AT).tone).toBe('warning')
    expect(nowView(snap({ spentSeconds: 1499 }), AT).label).toBe('0:01')
  })
  it('stays amber over the timebox and reads the overrun as +m:ss; the ring is full', () => {
    const v = nowView(snap({ spentSeconds: 1500 + 130 }), AT)
    expect(v).toMatchObject({ label: '+2:10', tone: 'warning', over: true, ring: 1 })
  })
  it('a task without a timebox shows the title only: no ring, no time, never amber', () => {
    expect(nowView(snap({ timeBoxSeconds: null, spentSeconds: 99_999 }), AT)).toEqual({ ring: null, label: null, tone: 'normal', over: false, paused: false })
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
