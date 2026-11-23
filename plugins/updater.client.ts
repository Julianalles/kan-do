/**
 * @module updater
 * @description Desktop only: one silent update check per launch, about ten seconds after mount, so the
 * board never waits for it. The token is optional (public releases; without one the check runs
 * unauthenticated). A found update shows one dismissible toast per session; every other outcome (up to
 * date, offline, rate limited, rejected, errors) stays silent. Web: no-op. The setting "Automatisch nach Updates suchen"
 * (`settingsStore.autoUpdateCheck`, #746) off: no automatic check at all; read when the delay ends, so a switch flipped
 * in the first seconds counts. See composables/useAppUpdater.ts and ADR 009.
 */
import { isTauri } from '~/utils/isTauri'
import { useAppUpdater } from '~/composables/useAppUpdater'
import { isOverlayWindow } from '~/lib/overlayWindow'
import { useSettingsStore } from '~/store/settings'

export const LAUNCH_CHECK_DELAY_MS = 10_000

export default defineNuxtPlugin({
  name: 'updater',
  dependsOn: ['secrets'],
  setup(nuxtApp) {
    if (!isTauri() || isOverlayWindow()) return
    nuxtApp.hook('app:mounted', () => {
      setTimeout(() => {
        void nuxtApp.vueApp.runWithContext(async () => {
          if (!useSettingsStore().autoUpdateCheck) return
          const updater = useAppUpdater()
          await updater.loadVersion()
          const result = await updater.check()
          if (result?.status === 'available') updater.announceAvailable()
        })
      }, LAUNCH_CHECK_DELAY_MS)
    })
  },
})
