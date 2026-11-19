import { describe, it, expect, beforeEach, vi } from 'vitest'

// The guard sends a board that is already set up away from /welcome (#561): one predicate with pages/tasks.vue
// (useBoardSetup), so the two redirects can never point at each other.
const setUp = vi.fn(() => false)
vi.mock('~/composables/useBoardSetup', () => ({ useBoardSetup: () => ({ isSetUp: setUp }) }))

const navigateToMock = vi.fn((...args: unknown[]) => ({ redirected: args }))

async function run(to: { path: string; query: Record<string, unknown> }) {
  vi.stubGlobal('defineNuxtRouteMiddleware', (fn: unknown) => fn)
  vi.stubGlobal('navigateTo', navigateToMock)
  const { default: middleware } = await import('~/middleware/welcome-guard')
  return (middleware as unknown as (to: unknown) => unknown)(to)
}

describe('welcome-guard middleware (#561)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    setUp.mockReturnValue(false)
  })

  it('lets a board that is not set up open the welcome page', async () => {
    expect(await run({ path: '/welcome', query: {} })).toBeUndefined()
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('sends a set-up board to Heute, replacing the history entry', async () => {
    setUp.mockReturnValue(true)
    await run({ path: '/welcome', query: {} })
    expect(navigateToMock).toHaveBeenCalledWith('/tasks', { replace: true })
  })

  it('leaves a request with ?code= alone (Todoist OAuth callback), set up or not', async () => {
    setUp.mockReturnValue(true)
    expect(await run({ path: '/welcome', query: { code: 'abc' } })).toBeUndefined()
    expect(navigateToMock).not.toHaveBeenCalled()
  })
})
