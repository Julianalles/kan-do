<!--
@component BoardContinue
@kind component
@category action
@description The way on from the place "Planung" to the board (#354, epic #334): the primary button "Tag starten" (#367, without a count) and, above it, the echo of Offen's capacity line while that line is out of view
@usage Board.vue renders it twice, never both at once: on desktop in the footer slot of the Offen column (where Erledigt has "Tag abschließen"), on a phone (`phone`) as a bar fixed above the app bar on both pages of "Planung".
@avoid The page's one primary button, only on "Planung"; "Tag abschließen" on Heute keeps its own footer in Board.vue. Not a navigation bar: the places are in AppNav.
@responsibility
- The button is a link to Heute (`boardPlaceLocation('today')`), so the board travels there as with the app bar
- Desktop: the echo follows the window (`watch-window`); a click scrolls the real line into view
- Phone: the echo shows on the "Meine Aufgaben" page (`echo-active`); a tap emits `show-line`, and the board goes to the Offen page. `lifted` moves the bar above the topic focus pill, `hidden` fades it out while a card is dragged (like the app bar)
- The button sits on a page-coloured backing: on desktop the footer is sticky above the cards
-->
<template>
  <div
    class="board-continue"
    :class="{ 'board-continue--phone': phone, 'board-continue--lifted': phone && lifted, 'board-continue--hidden': hidden }"
    :data-testid="phone ? 'board-continue-bar' : 'board-continue-footer'"
  >
    <BoardCapacityEcho :watch-window="!phone" :active="echoActive" @show="showLine" />
    <span class="board-continue__back">
      <UButton
        :to="boardPlaceLocation('today')"
        size="lg"
        color="primary"
        :trailing-icon="ICONS.goOn"
        class="max-md:w-full max-md:justify-center"
        data-testid="board-continue"
      >
        {{ t('board.notPlanned.continue') }}
      </UButton>
    </span>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import BoardCapacityEcho from '~/components/board/BoardCapacityEcho.vue'
import { boardPlaceLocation } from '~/lib/boardPlace'
import { ICONS } from '~/lib/icons'

defineOptions({ name: 'BoardContinue' })

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

const { t } = useI18n()

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
.board-continue {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
}

.board-continue__back {
  display: flex;
  border-radius: var(--ui-radius);
  background: var(--ui-page-bg);
}

.board-continue--phone {
  position: fixed;
  z-index: var(--z-bar);
  inset-inline: 0;
  bottom: calc(var(--phone-bar-offset) + 0.5rem);
  padding-inline: 1rem;
  /* Only the echo and the button take the pointer: the page between them and the screen edge stays scrollable */
  pointer-events: none;
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.board-continue--phone > * {
  pointer-events: auto;
}

.board-continue--phone .board-continue__back {
  width: 100%;
  max-width: var(--task-card-max-width);
}

/* The focus pill (BoardFocusBar) floats above the app bar: the bar sits above it */
.board-continue--lifted {
  bottom: calc(var(--phone-bar-offset) + 3.75rem);
}

.board-continue--hidden {
  opacity: 0;
}

.board-continue--hidden > * {
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .board-continue--phone {
    transition: none;
  }
}
</style>
