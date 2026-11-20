<!--
@component BoardCapacityDock
@kind component
@category layout
@description Where the capacity echo (BoardCapacityEcho) sits on the place "Alle" (#354, #373, #566): at the foot of Offen, the Today column, on desktop. It holds only the echo; the way on to the board is the app bar's normal pill (#454 removed the green "Weiter zum Board" pill, #373 had replaced this component's button "Tag starten")
@usage Board.vue renders it once, on desktop, in the footer slot of the Offen column (where Erledigt has "Tag abschließen"). It takes no room while the echo is not shown.
@avoid Not a navigation bar and not a button host: the places are in AppNav. Only on "Alle", only with Offen: never over "Alle Aufgaben" and not on a phone (#566: there Offen's own capacity line is in its list, as on Heute).
@responsibility
- The echo follows the window (shown while Offen's real line is out of view); a click scrolls the real line into view
-->
<template>
  <div class="capacity-dock" data-testid="capacity-dock-footer">
    <BoardCapacityEcho @show="showLine" />
  </div>
</template>

<script setup lang="ts">
import BoardCapacityEcho from '~/components/board/BoardCapacityEcho.vue'

defineOptions({ name: 'BoardCapacityDock' })

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
