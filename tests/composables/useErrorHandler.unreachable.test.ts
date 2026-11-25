/**
 * #851: a source that cannot be reached is told once per outage, with the reassurance that the changes are kept.
 * Runs the real error handler against the real health store; the toast is the mock of `useToast`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { useErrorHandler } from '~/composables/useErrorHandler'
import { informUnreachable } from '~/composables/useUnreachableNotice'
import { setTestLocale } from '~/tests/helpers/i18n'
import { toastAddMock } from '~/tests/mocks/nuxt-imports'

/** What `NotionClientAPI` throws: status 0 for a failed request (the desktop client's text is "Network error"), else the HTTP status. */
const apiError = (statusCode: number, message: string) => Object.assign(new Error(message), { name: 'NotionAPIError', statusCode })
/** The handler keeps its window for identical messages across tests: the clock only ever moves forward. */
let clock = Date.now()
const toasts = () => toastAddMock.mock.calls.map((call) => call[0] as { title: string; description: string; color: string })

describe('unreachable source: one toast per outage (#851)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(clock)
    setActivePinia(createPinia())
    useBoardStore().setSources({ connected: ['notion', 'todoist'], default: 'notion' })
    useIntegrationHealthStore().recordSuccessfulSync('notion')
    useIntegrationHealthStore().recordSuccessfulSync('todoist')
    toastAddMock.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /** One failing action, reported the way `NotionIntegration` does, later than the handler's window for identical messages. */
  const fail = (error: unknown, source: 'notion' | 'todoist' = 'notion') => {
    vi.setSystemTime(clock += 10_000)
    useErrorHandler().handleError(error as Error, 'task_operation', { source })
  }

  it('a desktop network failure (status 0, "Network error") is told once, however many actions fail', () => {
    fail(apiError(0, 'Network error'))
    fail(apiError(0, 'Network error'))
    fail(apiError(0, 'Network error'))

    expect(toasts()).toHaveLength(1)
    expect(toasts()[0]).toMatchObject({
      title: 'Notion ist gerade nicht erreichbar',
      description: 'Deine Änderungen bleiben gespeichert und werden synchronisiert, sobald Notion wieder erreichbar ist.',
      color: 'warning',
    })
    expect(useIntegrationHealthStore().statusOf('notion')).toBe('offline')
  })

  it('a 5xx is told once too and leaves the source health alone', () => {
    fail(apiError(502, 'Bad Gateway'))
    fail(apiError(503, 'Service Unavailable'))

    expect(toasts()).toHaveLength(1)
    expect(toasts()[0]!.color).toBe('warning')
    expect(useIntegrationHealthStore().statusOf('notion')).toBe('healthy')
  })

  it('a browser fetch failure followed by a 5xx is still one outage', () => {
    fail(new TypeError('Failed to fetch'))
    fail(apiError(502, 'Bad Gateway'))
    expect(toasts()).toHaveLength(1)
  })

  it('tells again after the source answered: a fetch that recovers it, or a write that went through', () => {
    fail(apiError(0, 'Network error'))
    useIntegrationHealthStore().markHealthy('notion') // the fetch of the recovered source
    fail(apiError(0, 'Network error'))
    expect(toasts()).toHaveLength(2)

    useIntegrationHealthStore().noteReachable('notion') // a write went through
    fail(apiError(502, 'Bad Gateway'))
    expect(toasts()).toHaveLength(3)
  })

  it('a fetch that succeeds while the source was healthy does not reset a 5xx outage of the writes', () => {
    fail(apiError(500, 'Internal Server Error'))
    useIntegrationHealthStore().markHealthy('notion')
    useIntegrationHealthStore().recordSuccessfulSync('notion')
    fail(apiError(500, 'Internal Server Error'))
    expect(toasts()).toHaveLength(1)
  })

  it('tells each source once and names it', () => {
    fail(apiError(0, 'Network error'), 'notion')
    fail(apiError(0, 'Network error'), 'todoist')
    fail(apiError(0, 'Network error'), 'todoist')

    expect(toasts().map((toast) => toast.title)).toEqual(['Notion ist gerade nicht erreichbar', 'Todoist ist gerade nicht erreichbar'])
  })

  it('writes the English copy', () => {
    setTestLocale('en')
    fail(apiError(0, 'Network error'))
    expect(toasts()[0]).toMatchObject({
      title: "Notion can't be reached right now",
      description: 'Your changes stay saved and sync as soon as Notion is reachable again.',
    })
  })

  it('a rejected token keeps the broken path: an error toast, no reassurance (#319)', () => {
    fail(apiError(401, 'Unauthorized'))
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0]!.color).toBe('error')
    expect(useIntegrationHealthStore().statusOf('notion')).toBe('broken')
  })

  it('a 5xx during setup stays an error: nothing was kept there', () => {
    vi.setSystemTime(clock += 10_000)
    useErrorHandler().handleError(apiError(502, 'Database request failed') as Error, 'notion_setup', { source: 'notion' })
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0]!.color).toBe('error')
  })

  it('informUnreachable tells once and answers whether it did', () => {
    expect(informUnreachable('notion')).toBe(true)
    expect(informUnreachable('notion')).toBe(false)
    fail(apiError(0, 'Network error'))
    expect(toasts()).toHaveLength(1)
  })

  it('a disconnect or a fresh connect forgets the outage', () => {
    informUnreachable('notion')
    useIntegrationHealthStore().resetSource('notion')
    expect(informUnreachable('notion')).toBe(true)
    useIntegrationHealthStore().markUnconfigured('notion')
    expect(informUnreachable('notion')).toBe(true)
  })

  it('the told state is not persisted', () => {
    informUnreachable('notion')
    expect(Object.keys(useIntegrationHealthStore().$state)).toEqual(['sources'])
  })
})
