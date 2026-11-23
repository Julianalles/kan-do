/**
 * #746: the launch update check runs only while "Automatisch nach Updates suchen" is on. Off: no request at all, not even
 * the version read; the manual check on /settings/updates is the user's own action and is not gated.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const check = vi.fn(async () => ({ status: 'up-to-date' as const }))
const loadVersion = vi.fn(async () => {})
const announceAvailable = vi.fn()

vi.mock('~/utils/isTauri', () => ({ isTauri: () => true }))
vi.mock('~/lib/overlayWindow', () => ({ isOverlayWindow: () => false }))
vi.mock('~/composables/useAppUpdater', () => ({ useAppUpdater: () => ({ check, loadVersion, announceAvailable }) }))

type Plugin = { setup: (app: unknown) => void }

async function launch(): Promise<void> {
  vi.stubGlobal('defineNuxtPlugin', (plugin: Plugin) => plugin)
  const { default: plugin, LAUNCH_CHECK_DELAY_MS } = await import('~/plugins/updater.client') as unknown as { default: Plugin, LAUNCH_CHECK_DELAY_MS: number }
  let mounted: (() => void) | undefined
  plugin.setup({
    hook: (name: string, fn: () => void) => { if (name === 'app:mounted') mounted = fn },
    vueApp: { runWithContext: (fn: () => unknown) => fn() },
  })
  mounted?.()
  await vi.advanceTimersByTimeAsync(LAUNCH_CHECK_DELAY_MS)
}

describe('plugins/updater.client.ts (#746)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    setActivePinia(createPinia())
    check.mockClear()
    loadVersion.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('checks once after the launch delay while the setting is on (the default)', async () => {
    await launch()
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('never calls the update API when the setting is off', async () => {
    const { useSettingsStore } = await import('~/store/settings')
    useSettingsStore().setAutoUpdateCheck(false)
    await launch()
    expect(check).not.toHaveBeenCalled()
    expect(loadVersion).not.toHaveBeenCalled()
  })

  it('reads the setting when the delay ends: switched off during the first seconds, nothing is sent', async () => {
    const { useSettingsStore } = await import('~/store/settings')
    vi.stubGlobal('defineNuxtPlugin', (plugin: Plugin) => plugin)
    const { default: plugin } = await import('~/plugins/updater.client') as unknown as { default: Plugin }
    let mounted: (() => void) | undefined
    plugin.setup({ hook: (_: string, fn: () => void) => { mounted = fn }, vueApp: { runWithContext: (fn: () => unknown) => fn() } })
    mounted?.()
    await vi.advanceTimersByTimeAsync(2000)
    useSettingsStore().setAutoUpdateCheck(false)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(check).not.toHaveBeenCalled()
  })
})
