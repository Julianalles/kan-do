/**
 * @module ui-scale
 * @description Applies the setting "Größe der Anzeige" (#845, `settingsStore.uiScale`, steps in `lib/uiScale.ts`):
 * the root font size in percent, so everything sized in rem (type, spacing, controls) scales together, on web and
 * desktop alike. At 100 % nothing is set: the page renders exactly as without the setting. `--ui-scale` carries the
 * factor for the few rules that must not scale (the desktop title row, `assets/css/app-nav.css`). Runs after
 * `plugins/pinia.ts` (file order), so the stored step is on `<html>` before the first render. The floating Now
 * window (#383) is a fixed 280 x 42 pt pill and has no settings of its own: it never scales.
 */
import { watch } from 'vue'
import { useSettingsStore } from '~/store/settings'
import { isOverlayWindow } from '~/lib/overlayWindow'
import { DEFAULT_UI_SCALE } from '~/lib/uiScale'

export default defineNuxtPlugin({
  name: 'ui-scale',
  dependsOn: ['pinia'],
  setup() {
    if (isOverlayWindow()) return
    const settingsStore = useSettingsStore()
    const root = document.documentElement
    watch(() => settingsStore.uiScale, (scale) => {
      if (scale === DEFAULT_UI_SCALE) {
        root.style.removeProperty('font-size')
        root.style.removeProperty('--ui-scale')
        return
      }
      root.style.setProperty('font-size', `${scale}%`)
      root.style.setProperty('--ui-scale', String(scale / 100))
    }, { immediate: true })
  },
})
