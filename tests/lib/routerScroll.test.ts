import { afterEach, describe, expect, it, vi } from 'vitest'
import routerOptions from '~/app/router.options'

const scroll = (to: string, from: string) =>
  (routerOptions as any).scrollBehavior({ path: to }, { path: from }, null)

describe('scrollBehavior: place change (#354)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([['/all', '/tasks'], ['/tasks', '/all']])('keeps the window scroll going to %s from %s', (to, from) => {
    vi.stubGlobal('window', { scrollX: 0, scrollY: 600 })
    expect(scroll(to, from)).toEqual({ left: 0, top: 600, behavior: 'instant' })
  })

  it('still scrolls to the top for other navigations', () => {
    vi.stubGlobal('window', { scrollX: 0, scrollY: 600 })
    expect(scroll('/settings', '/tasks')).toEqual({ top: 0, left: 0 })
  })
})
