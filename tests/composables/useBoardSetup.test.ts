import { describe, it, expect, beforeEach, vi } from 'vitest'

// "Set up" is the exact negation of the condition under which pages/tasks.vue sends a user to /welcome (#561)
const configured = vi.fn(() => false)
const onboarded = { value: true }
vi.mock('~/store/board', () => ({ useBoardStore: () => ({ get isOnboarded() { return onboarded.value } }) }))
vi.mock('~/composables/useIntegrationManager', () => ({ useIntegrationManager: () => ({ isIntegrationConfigured: configured }) }))

describe('useBoardSetup (#561)', () => {
  beforeEach(async () => {
    vi.resetModules()
    configured.mockReturnValue(false)
    onboarded.value = true
    const { useKeychainStatus } = await import('~/composables/useKeychainStatus')
    useKeychainStatus().clearUnavailable()
  })

  it('is set up when the default source is usable', async () => {
    configured.mockReturnValue(true)
    const { useBoardSetup } = await import('~/composables/useBoardSetup')
    expect(useBoardSetup().isSetUp()).toBe(true)
  })

  it('is not set up without a usable default source', async () => {
    const { useBoardSetup } = await import('~/composables/useBoardSetup')
    expect(useBoardSetup().isSetUp()).toBe(false)
  })

  it('counts a board whose token is only unreachable (Keychain locked) as set up: tasks.vue stays on it', async () => {
    const { useKeychainStatus } = await import('~/composables/useKeychainStatus')
    useKeychainStatus().setUnavailable(['todoist-token'] as never)
    const { useBoardSetup } = await import('~/composables/useBoardSetup')
    expect(useBoardSetup().isSetUp()).toBe(true)
  })

  it('does not count an unreachable Keychain as set up on a board that never finished onboarding: /welcome stays reachable', async () => {
    onboarded.value = false
    const { useKeychainStatus } = await import('~/composables/useKeychainStatus')
    useKeychainStatus().setUnavailable(['todoist-token'] as never)
    const { useBoardSetup } = await import('~/composables/useBoardSetup')
    expect(useBoardSetup().isSetUp()).toBe(false)
  })
})
