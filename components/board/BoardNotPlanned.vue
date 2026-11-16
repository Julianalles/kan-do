<!--
@component BoardNotPlanned
@kind block
@category layout
@description The "Nicht geplant" side of the place "Alle" (#354, epic #334): every task kan-do holds that is not on today's board, as cards under a column headline, each with the arrow that plans it for today
@usage Rendered once by Board.vue as the first child of `.board`, left of Offen (desktop: two column tracks wide, cards in two columns; phone: a swipe page of its own left of Offen). `active` says whether the place "Alle" shows, `rendered` whether the cards are in the DOM (also while the board travels to Heute).
@avoid Not a board column: no status, no sorting and no slot inside it (BoardColumn). Not for the trash or another static list of cards.
@responsibility
- Headline: BoardColumnHeader with the same 40 px row below it as every column, so the first card sits level with Offen's first
- Cards: TaskCard as the board shows it, always with the source icon (the question here is where a task comes from); a click, a tap or Enter on the focused card opens its sheet under `/all/:id`, so closing returns to "Alle". No card menu. Each card is a BoardNotPlannedItem
- Drag (#355): a card can be carried onto Offen with the board's own drag (it is planned and lands where it is dropped). The side is one dnd-kit droppable (`data.notPlannedZone`) for a card or stack from Offen: while one is held over it the side shows a wash and "Hier ablegen: nicht heute" under the headline, and the drop takes it off today's board, on top of this list. The cards never make room for one another: no sorting here
- Pick: a round button per card ("Für heute einplanen", named with the task's title). Desktop: on the paper right of the card, towards Offen, quiet at rest and full on hover and focus, so a first-time user finds it (#354 D1e). Phone: in the card's top right corner, where a board card has its menu button. The move is `usePlanMoves().planForToday`; keyboard focus goes on to the next card's button
- Order: `tasksStore.tasksNotPlanned` (put back by hand first, newest first); the topic focus filters it like a column (`useBoardFocus`)
- Empty: one muted note. Nothing held here: "Noch keine weiteren Aufgaben. Alles ist für heute geplant." plus how a task gets here (#354 D1c: until #357 nothing arrives by itself); a focus without a match: "Keine Aufgaben gefunden."; a board without any task stays blank
- Many items: on desktop the side is as tall as the window and its list scrolls inside it, so Offen and "Weiter zu Heute" stay in view; on a phone the page scrolls like every column page
- Out of view (`active` false) the side is `inert`; Board.vue's CSS takes it out of layout or view once the move is over
-->
<template>
  <section
    id="column-not-planned"
    ref="sideEl"
    class="column not-planned"
    :class="{ 'is-drop-target': isDropTarget }"
    :aria-label="t('board.notPlanned.title')"
    :inert="!active || undefined"
    data-testid="not-planned"
  >
    <BoardColumnHeader :title="t('board.notPlanned.title')" :status="TaskStatus.Open" :task-count="shown.length" />
    <!-- The 40 px row every column has under its title (the sorting control's), so the cards start on Offen's line.
         While an Offen card is held over the side it says what a drop does (#355), where Erledigt has its drop line -->
    <div class="relative flex h-10 shrink-0 items-center justify-center">
      <Transition name="not-planned-hint">
        <p
          v-if="isDropTarget"
          class="not-planned__hint absolute inset-x-0 truncate px-3 text-center text-sm font-medium text-default"
          data-testid="not-planned-drop-hint"
        >
          {{ t('board.notPlanned.dropHere') }}
        </p>
      </Transition>
    </div>

    <div v-if="rendered" ref="bodyEl" class="not-planned__body">
      <EmptyNote v-if="held.length > 0 && shown.length === 0" class="not-planned__note" data-testid="not-planned-no-match">
        {{ t('board.notPlanned.noMatch') }}
      </EmptyNote>
      <EmptyNote v-else-if="held.length === 0 && hasTasks" class="not-planned__note" data-testid="not-planned-empty">
        {{ t('board.notPlanned.empty') }} {{ t('board.notPlanned.emptyHow') }}
      </EmptyNote>

      <!-- Not in the reader's tree while it holds nothing: an empty list says "0 items" beside the note -->
      <TransitionGroup v-show="shown.length > 0" tag="ul" name="not-planned-item" class="not-planned__grid">
        <BoardNotPlannedItem
          v-for="(task, index) in shown"
          :key="task.id"
          :task="task"
          :index="index"
          @open="openTask"
          @pick="pick"
        />
      </TransitionGroup>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useDroppable } from '@dnd-kit/vue'
import { useI18n } from 'vue-i18n'
import { navigateTo } from 'nuxt/app'
import BoardColumnHeader from '~/components/board/BoardColumnHeader.vue'
import EmptyNote from '~/components/ui/EmptyNote.vue'
import BoardNotPlannedItem from '~/components/board/BoardNotPlannedItem.vue'
import { useTasksStore } from '~/store/tasks'
import { useBoardFocus } from '~/composables/useBoardFocus'
import { useBoardPlace } from '~/composables/useBoardPlace'
import { usePlanMoves } from '~/composables/usePlanMoves'
import { useBoardDragState } from '~/composables/useBoardDragState'
import { notPlannedZoneAccepts } from '~/utils/planDrop'
import { TaskStatus } from '~/types/taskStatus'

defineOptions({ name: 'BoardNotPlanned' })

defineProps<{
  /** The place "Alle" shows: the side takes pointer, keyboard and reader */
  active: boolean
  /** The cards are in the DOM: while "Alle" shows and while the board travels away from it */
  rendered: boolean
}>()

const { t } = useI18n()
const tasksStore = useTasksStore()
const { applyFocus } = useBoardFocus()
const { basePath } = useBoardPlace()
const { planForToday } = usePlanMoves()

const bodyEl = ref<HTMLElement | null>(null)
const sideEl = ref<HTMLElement | null>(null)

// The side is one drop target (#355): an Offen card dropped anywhere on it is taken off today's board. Lowest
// priority, like a column's drop zone. `accept` is wrapped in a getter: the binding would call a bare function.
useDroppable({
  id: 'not-planned-zone',
  element: sideEl,
  data: { notPlannedZone: true },
  accept: () => notPlannedZoneAccepts as never,
  collisionPriority: 0,
})
const { dragState } = useBoardDragState()
/** An Offen card is held over the side: the wash and the line. A card of the side itself gets no answer here, a drop puts it back. */
const isDropTarget = computed(() => dragState.value.isDragging && dragState.value.overNotPlanned && !dragState.value.fromNotPlanned)

/** Everything that is not on today's board */
const held = computed(() => tasksStore.tasksNotPlanned)
/** What the topic focus leaves of it (the funnel in the app bar filters this side like a column) */
const shown = computed(() => applyFocus(held.value))
/** kan-do holds a task at all: only then "everything is planned for today" is true; a new board stays blank */
const hasTasks = computed(() => tasksStore.tasks.length > 0)

const openTask = (id: string) => void navigateTo({ path: `${basePath.value}/${id}` })

/** Plans the card. A keyboard user's focus was on the button that now leaves: it goes on to the next card's button. */
async function pick(id: string, event: MouseEvent) {
  const button = event.currentTarget as HTMLElement
  const item = button.closest('.not-planned__item')
  const hadFocus = document.activeElement === button
  const neighbour = (item?.nextElementSibling ?? item?.previousElementSibling)?.getAttribute('data-not-planned-id') ?? null
  if (!(await planForToday(id)) || !hadFocus) return
  await nextTick()
  const next = neighbour ? bodyEl.value?.querySelector<HTMLElement>(`[data-not-planned-id="${CSS.escape(neighbour)}"] .not-planned__pick`) : null
  ;(next ?? document.querySelector<HTMLElement>('#column-open [data-testid="add-task-header-button"]'))?.focus({ preventScroll: true })
}
</script>

<style scoped>
.not-planned__body {
  padding-bottom: 2rem;
}

.not-planned__grid {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  justify-items: center;
  row-gap: var(--task-list-gap);
}

.not-planned__note {
  /* A reading measure, centred: the side is two tracks wide on desktop */
  max-width: 28rem;
  margin-inline: auto;
  padding: 0 1.5rem;
  text-align: center;
}

/* The answer to an Offen card held over the side (#355): a wash on the side itself (never on .board, DnD invariant) and
   one line under the headline. Neutral: nothing is completed or lost, the task only leaves today. */
.not-planned {
  border-radius: var(--task-card-radius);
  transition: background-color var(--duration-base) var(--ease-standard);
}

.not-planned.is-drop-target {
  background-color: var(--fill-on-canvas);
}

.not-planned-hint-enter-active,
.not-planned-hint-leave-active {
  transition: opacity var(--duration-base) var(--ease-standard);
}

.not-planned-hint-enter-from,
.not-planned-hint-leave-to {
  opacity: 0;
}

/* The gap a planned card leaves closes; a card that comes back opens its place */
.not-planned-item-move {
  transition: transform var(--duration-base) var(--ease-standard);
}

.not-planned-item-leave-active {
  position: absolute;
  visibility: hidden;
}

.not-planned-item-enter-active {
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.not-planned-item-enter-from {
  opacity: 0;
}

@media (--desktop) {
  /* As tall as the window under the app bar and pinned there: the list scrolls inside, Offen scrolls the page */
  .not-planned {
    position: sticky;
    top: var(--app-bar-offset-top);
    align-self: start;
    height: calc(100vh - var(--app-bar-offset-top));
    height: calc(100dvh - var(--app-bar-offset-top));
  }

  .not-planned__body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    margin-inline: 1rem;
    /* Room for the card shadow and the focus ring at the scroll box's upper edge */
    padding-top: 0.25rem;
    margin-top: -0.25rem;
  }

  /* A card put back flies in from Offen: the scroll box must not clip it on the way (usePlanMoves sets the class) */
  .not-planned.is-receiving .not-planned__body {
    overflow: visible;
  }

  .not-planned__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (--phone) {
  .not-planned__body {
    flex: 1 0 auto;
    padding-bottom: 0.75rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .not-planned,
  .not-planned-item-move,
  .not-planned-item-enter-active,
  .not-planned-hint-enter-active,
  .not-planned-hint-leave-active {
    transition: none;
  }
}
</style>
