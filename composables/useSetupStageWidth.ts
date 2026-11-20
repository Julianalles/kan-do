import { onBeforeUnmount, watchEffect, type Ref } from 'vue'
import { useState } from 'nuxt/app'

/**
 * A settings page that hosts a setup stage (#652, epic #607) widens the sub-page column to 768 px, the width of the welcome
 * sheet, while the stage shows. The layout reads `useState('sub-page-wide')` beside `sub-page-description-key`; the page
 * gives the column back when it leaves, so the other settings pages keep their 672 px.
 */
export function useSetupStageWidth(isStage: Ref<boolean>): void {
  const wide = useState<boolean>('sub-page-wide', () => false)
  watchEffect(() => { wide.value = isStage.value })
  onBeforeUnmount(() => { wide.value = false })
}
