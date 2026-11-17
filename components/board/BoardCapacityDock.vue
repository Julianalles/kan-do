<!--
@component BoardCapacityDock
@kind component
@category layout
@description Where the capacity echo (BoardCapacityEcho) sits on the place "Alle" (#354, #373): at the foot of Offen on desktop, as a bar fixed above the app bar on a phone. It holds only the echo; the way on to the board is the app bar's green pill "Weiter zum Board" (#373, it replaced this component's button "Tag starten")
@usage Board.vue renders it twice, never both at once: on desktop in the footer slot of the Offen column (where Erledigt has "Tag abschließen"), on a phone (`phone`) as a bar fixed above the app bar on both pages of "Alle". It takes no room while the echo is not shown.
@avoid Not a navigation bar and not a button host: the places are in AppNav. Only on "Alle".
@responsibility
- Desktop: the echo follows the window (`watch-window`); a click scrolls the real line into view
- Phone: the echo shows on the "Meine Aufgaben" page (`echo-active`); a tap emits `show-line`, and the board goes to the Offen page. `lifted` moves the bar above the topic focus pill, `hidden` fades it out while a card is dragged (like the app bar)
- The echo has a page-coloured backing of its own (BoardCapacityEcho), so this wrapper adds none
-->
<template>
  <div
    class="capacity-dock"
    :class="{ 'capacity-dock--phone': phone, 'capacity-dock--lifted': phone && lifted, 'capacity-dock--hidden': hidden }"
    :data-testid="phone ? 'capacity-dock-bar' : 'capacity-dock-footer'"
  >
    <BoardCapacityEcho :watch-window="!phone" :active="echoActive" @show="showLine" />
  </div>
</template>

<script setup lang="ts">
import BoardCapacityEcho from '~/components/board/BoardCapacityEcho.vue'

defineOptions({ name: 'BoardCapacityDock' })

const props = withDefaults(defineProps<{
  /** The phone bar (fixed above the app bar) instead of the column footer */
  phone?: boolean
  /** Phone: the "Meine Aufgaben" page shows, so Offen's line is out of view */
  echoActive?: boolean
  /** Phone: the topic focus pill floats above the app bar; the bar steps up above it */
  lifted?: boolean
  /** A card is dragged: the bar steps back like the app bar */
  hidden?: boolean
}>(), { phone: false, echoActive: false, lifted: false, hidden: false })

const emit = defineEmits<{
  /** Phone: bring Offen's capacity line into view (the board owns its pages) */
  showLine: []
}>()

function showLine() {
  if (props.phone) {
    emit('showLine')
    return
  }
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

.capacity-dock--phone {
  position: fixed;
  z-index: var(--z-bar);
  inset-inline: 0;
  bottom: calc(var(--phone-bar-offset) + 0.5rem);
  padding-inline: 1rem;
  /* Only the echo takes the pointer: the page between them and the screen edge stays scrollable */
  pointer-events: none;
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.capacity-dock--phone > * {
  pointer-events: auto;
}

/* The focus pill (BoardFocusBar) floats above the app bar: the echo sits above it */
.capacity-dock--lifted {
  bottom: calc(var(--phone-bar-offset) + 3.75rem);
}

.capacity-dock--hidden {
  opacity: 0;
}

.capacity-dock--hidden > * {
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .capacity-dock--phone {
    transition: none;
  }
}
</style>
