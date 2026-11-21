<!--
@component BoardCapacityDock
@kind component
@category layout
@description Where the capacity echo (BoardCapacityEcho) sits on the place "Alle" (#354, #373, #566): at the foot of Offen, the Today column, on desktop, and (placement top, #573) under the app bar for a line above the window. It holds only the echo; the way on to the board is the app bar's normal pill (#454 removed the green "Weiter zum Board" pill, #373 had replaced this component's button "Tag starten")
@usage Board.vue renders it twice, on desktop: in the footer slot of the Offen column (where Erledigt has "Tag abschließen") and, with placement top, in its top slot. It takes no room while the echo is not shown.
@avoid Not a navigation bar and not a button host: the places are in AppNav. Only on "Alle", only with Offen: never over "Alle Aufgaben" and not on a phone (#566: there Offen's own capacity line is in its list, as on Heute).
@responsibility
- The echo follows the window (shown while Offen's real line is out of view); a click scrolls the real line into view
- `placement="top"` (#573 case 2): the host is a zero-height sticky box under the app bar and its veil (BoardColumn's `top` slot), the echo hangs from it over the cards
-->
<template>
  <div class="capacity-dock" :data-testid="`capacity-dock-${placement === 'top' ? 'top' : 'footer'}`">
    <BoardCapacityEcho :placement="placement" @show="showLine" />
  </div>
</template>

<script setup lang="ts">
import BoardCapacityEcho from '~/components/board/BoardCapacityEcho.vue'

defineOptions({ name: 'BoardCapacityDock' })

const { placement = 'bottom' } = defineProps<{
  /** The foot of Offen (default) or under the app bar, for a line above the window (#573 case 2) */
  placement?: 'bottom' | 'top'
}>()

function showLine() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  document.querySelector('#column-open [data-testid="capacity-divider"]')?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
}
</script>

<style scoped>
.capacity-dock {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
}
</style>
