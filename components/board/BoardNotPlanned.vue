<!--
@component BoardNotPlanned
@kind block
@category layout
@description The "Meine Aufgaben" side of the place "Planung" (#354, epic #334): every task kan-do holds that is not on today's board, as cards under a column headline, each with the arrow that plans it for today
@usage Rendered once by Board.vue as the first child of `.board`, left of Offen (desktop: two column tracks wide, the cards in two columns close together and centred in it, #373; phone: a swipe page of its own left of Offen). `active` says whether the place "Planung" shows, `rendered` whether the cards are in the DOM (also while the board travels to Heute).
@avoid Not a board column: no status, no sorting and no slot inside it (BoardColumn). Not for the trash or another static list of cards.
@responsibility
- Headline: BoardColumnHeader with the same 40 px row below it as every column, so the first card sits level with Offen's first. It carries the round add button (#380): a task made on "Planung" is not planned and lands here, so the button sits where the task appears (the sheet's add form under `/all/add`, as "Aufgabe erstellen" in the empty note); Offen's header has none on "Planung"
- Cards: TaskCard as the board shows it, always with the source icon (the question here is where a task comes from); a click, a tap or Enter on the focused card opens its sheet under `/all/:id`, so closing returns to "Planung". No card menu. Each card is a BoardNotPlannedItem
- Drag (#355): a card can be carried onto Offen with the board's own drag (it is planned and lands where it is dropped). The side is one dnd-kit droppable (`data.notPlannedZone`) for a card or stack from Offen: while one is held over it the side shows a wash and "Hier ablegen: nicht heute" under the headline, and the drop takes it off today's board, on top of this list. The cards never make room for one another: no sorting here
- Pick: a round button per card ("Für heute einplanen", named with the task's title). Desktop: on the paper right of the card, towards Offen, hidden at rest and shown on hover and keyboard focus, as "Nicht heute" is in the Heute column (#373; it was quiet at rest so a first-time user found it, #354 D1e; a touch-only device keeps it visible). Phone: in the card's top right corner, where a board card has its menu button. The move is `usePlanMoves().planForToday`; keyboard focus goes on to the next card's button
- Order: `tasksStore.tasksNotPlanned` (put back by hand first, newest first); the topic focus filters it like a column (`useBoardFocus`)
- A new day (#356, #387): the Jetzt and Offen tasks the user's fresh start of today took off the board (`useNewDay().groupIds`) stand on top as the group "Gestern geplant, noch offen", for that one day only. Below it the tasks a fresh start took out of Wartet stand in their own category "Zuletzt in Wartet" (`waitingIds`), so the user still knows they were waiting; that category lasts until each task is planned again. Every other task follows under "Weitere Aufgaben". The first shown category's `h3` sits in the row under the headline; on desktop every heading starts on the left edge of the card pair (the add button's line, #404), on a phone it is centred; a category the topic focus leaves empty is not shown, and without the first two there are no headings at all. Pick, drag and the focus hand-over work across the headings
- Limit (#357): when Notion holds more "not planned" pages than a sync loads (`notionConfig.notPlannedLimited`, the most recently edited 500), one muted line under the list says so
- Empty: one muted note. Nothing held here: "Keine weiteren Aufgaben vorhanden." and the soft button "Aufgabe erstellen" (#367, the user's wording), which opens the sheet's add form under `/all/add`; a task made while "Planung" shows is not planned, so it lands here; a focus without a match: "Keine Aufgaben gefunden."; a board without any task stays blank
- Many items: on desktop the side is as tall as the window and its list scrolls inside it, so Offen and the capacity echo stay in view; on a phone the page scrolls like every column page
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
    <!-- The add button (#380): a task made on "Planung" is not planned and lands here, so the button sits where the task appears -->
    <BoardColumnHeader
      :title="t('board.notPlanned.title')"
      :status="TaskStatus.Open"
      :task-count="shown.length"
      :show-add="true"
      :add-disabled="draftTask !== null"
      add-test-id="not-planned-add"
      @add="createTask"
    />
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
      <!-- The first category's heading sits in this row, so its first card stays level with Offen's (#356, #387) -->
      <SectionHeader
        v-if="rendered && yesterday.length > 0 && !isDropTarget"
        :id="yesterdayHeadingId"
        tag="h3"
        size="label"
        class="not-planned__group mb-0"
        data-testid="not-planned-group-yesterday"
      >
        {{ t('board.notPlanned.groupYesterday') }}
      </SectionHeader>
      <SectionHeader
        v-else-if="rendered && waiting.length > 0 && !isDropTarget"
        :id="waitingHeadingId"
        tag="h3"
        size="label"
        class="not-planned__group mb-0"
        data-testid="not-planned-group-waiting"
      >
        {{ t('board.notPlanned.groupWaiting') }}
      </SectionHeader>
    </div>

    <div v-if="rendered" ref="bodyEl" class="not-planned__body">
      <EmptyNote v-if="held.length > 0 && shown.length === 0" class="not-planned__note" data-testid="not-planned-no-match">
        {{ t('board.notPlanned.noMatch') }}
      </EmptyNote>
      <!-- Nothing held here (#367): the sentence and the one way to fill the side from here. The new task is not planned -->
      <div v-else-if="held.length === 0 && hasTasks" class="not-planned__note flex flex-col items-center gap-3">
        <EmptyNote data-testid="not-planned-empty">
          {{ t('board.notPlanned.empty') }}
        </EmptyNote>
        <UButton color="neutral" variant="soft" icon="i-ph-plus" data-testid="not-planned-create" @click="createTask">
          {{ t('board.notPlanned.create') }}
        </UButton>
      </div>

      <!-- On a new day (#356): what was planned yesterday and not finished, on top as a group of its own, for that day.
           Not in the reader's tree while it holds nothing: an empty list says "0 items" -->
      <TransitionGroup
        v-show="yesterday.length > 0"
        tag="ul"
        name="not-planned-item"
        class="not-planned__grid"
        :aria-labelledby="yesterdayHeadingId"
        data-testid="not-planned-list-yesterday"
      >
        <BoardNotPlannedItem
          v-for="(task, index) in yesterday"
          :key="task.id"
          :task="task"
          :index="index"
          @open="openTask"
          @pick="pick"
        />
      </TransitionGroup>
      <!-- What a fresh start took out of Wartet (#387): its own category, so the earlier waiting stays known. Its
           heading is here only below the first group; alone it sits in the row under the headline -->
      <SectionHeader
        v-if="yesterday.length > 0 && waiting.length > 0"
        :id="waitingHeadingId"
        tag="h3"
        size="label"
        class="not-planned__group not-planned__group--next"
        data-testid="not-planned-group-waiting"
      >
        {{ t('board.notPlanned.groupWaiting') }}
      </SectionHeader>
      <TransitionGroup
        v-show="waiting.length > 0"
        tag="ul"
        name="not-planned-item"
        class="not-planned__grid"
        :aria-labelledby="waitingHeadingId"
        data-testid="not-planned-list-waiting"
      >
        <BoardNotPlannedItem
          v-for="(task, index) in waiting"
          :key="task.id"
          :task="task"
          :index="yesterday.length + index"
          @open="openTask"
          @pick="pick"
        />
      </TransitionGroup>
      <!-- "Weitere Aufgaben" only says something beside a category above it: without one the side looks as on any other day -->
      <SectionHeader
        v-if="hasCategories && others.length > 0"
        :id="othersHeadingId"
        tag="h3"
        size="label"
        class="not-planned__group not-planned__group--next"
        data-testid="not-planned-group-others"
      >
        {{ t('board.notPlanned.groupOthers') }}
      </SectionHeader>
      <TransitionGroup
        v-show="others.length > 0"
        tag="ul"
        name="not-planned-item"
        class="not-planned__grid"
        :aria-labelledby="hasCategories ? othersHeadingId : undefined"
        data-testid="not-planned-list-others"
      >
        <BoardNotPlannedItem
          v-for="(task, index) in others"
          :key="task.id"
          :task="task"
          :index="yesterday.length + waiting.length + index"
          @open="openTask"
          @pick="pick"
        />
      </TransitionGroup>
      <!-- Notion holds more "not planned" pages than one sync loads (#357): said here, so the list never reads as complete -->
      <EmptyNote v-if="notionLimited && held.length > 0" class="not-planned__note mt-6" data-testid="not-planned-limit">
        {{ t('board.notPlanned.notionLimit', { n: NOT_PLANNED_PAGE_LIMIT }) }}
      </EmptyNote>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import { useDroppable } from '@dnd-kit/vue'
import { useI18n } from 'vue-i18n'
import { navigateTo } from 'nuxt/app'
import BoardColumnHeader from '~/components/board/BoardColumnHeader.vue'
import EmptyNote from '~/components/ui/EmptyNote.vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import BoardNotPlannedItem from '~/components/board/BoardNotPlannedItem.vue'
import { useTasksStore } from '~/store/tasks'
import { useBoardFocus } from '~/composables/useBoardFocus'
import { useBoardPlace } from '~/composables/useBoardPlace'
import { usePlanMoves } from '~/composables/usePlanMoves'
import { useNewDay } from '~/composables/useNewDay'
import { useTaskDraft } from '~/composables/useTaskDraft'
import { useBoardDragState } from '~/composables/useBoardDragState'
import { notPlannedZoneAccepts } from '~/utils/planDrop'
import { TaskStatus } from '~/types/taskStatus'
import { useNotionConfigStore } from '~/store/notionConfig'
import { useBoardStore } from '~/store/board'
import { NOT_PLANNED_PAGE_LIMIT } from '~/lib/notionLimits'

defineOptions({ name: 'BoardNotPlanned' })

defineProps<{
  /** The place "Planung" shows: the side takes pointer, keyboard and reader */
  active: boolean
  /** The cards are in the DOM: while "Planung" shows and while the board travels away from it */
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
// Notion left "not planned" pages out of the last sync (#357); only while Notion is a connection of this board
const notionLimited = computed(() => useNotionConfigStore().notPlannedLimited === true && useBoardStore().isIntegrationConnected('notion'))
/** What the topic focus leaves of it (the funnel in the app bar filters this side like a column) */
const shown = computed(() => applyFocus(held.value))
/**
 * The categories of "Meine Aufgaben" (#356, #387): the Jetzt and Offen tasks today's fresh start took off the board
 * that are still not planned, in the order they had on the board (Jetzt first); the tasks a fresh start took out of
 * Wartet, until each is planned again; and every other task. Without the first two there is one plain list, as on
 * any other day.
 */
const { groupIds, waitingIds } = useNewDay()
const { draftTask } = useTaskDraft()
const shownById = computed(() => new Map(shown.value.map(task => [task.id, task])))
const yesterday = computed(() => groupIds.value.map(id => shownById.value.get(id)).filter(task => task !== undefined))
const waiting = computed(() => waitingIds.value.map(id => shownById.value.get(id)).filter(task => task !== undefined))
const hasCategories = computed(() => yesterday.value.length > 0 || waiting.value.length > 0)
const others = computed(() => {
  if (!hasCategories.value) return shown.value
  const inCategory = new Set([...yesterday.value, ...waiting.value].map(task => task.id))
  return shown.value.filter(task => !inCategory.has(task.id))
})
/** The cards in the order they are rendered, across the categories */
const renderedOrder = computed(() => [...yesterday.value, ...waiting.value, ...others.value].map(task => task.id))
const yesterdayHeadingId = useId()
const waitingHeadingId = useId()
const othersHeadingId = useId()

/** kan-do holds a task at all: only then "everything is planned for today" is true; a new board stays blank */
const hasTasks = computed(() => tasksStore.tasks.length > 0)

const openTask = (id: string) => void navigateTo({ path: `${basePath.value}/${id}` })
/** "Aufgabe erstellen" (#367): the sheet's add form under "Planung"; `createTask` makes the task not planned there */
const createTask = () => void navigateTo({ path: `${basePath.value}/add` })

/** Plans the card. A keyboard user's focus was on the button that now leaves: it goes on to the next card's button. */
async function pick(id: string, event: MouseEvent) {
  const button = event.currentTarget as HTMLElement
  const hadFocus = document.activeElement === button
  // The next card as rendered, also across the category headings (#356, #387); the last card hands on to the one before it
  const order = renderedOrder.value
  const at = order.indexOf(id)
  const neighbour = at === -1 ? null : order[at + 1] ?? order[at - 1] ?? null
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

.not-planned__group {
  justify-content: center;
  text-align: center;
}

.not-planned__group--next {
  margin: 1.5rem 0 0.75rem;
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

  /* Two card columns close together and centred in the side (#373): a cell is a card plus the 1.5rem the item keeps
     free (BoardNotPlannedItem), the gap between the two cards is 4.5rem and holds the arrow of the left one, so the pair
     reads as one group and the Heute column, a clear step further right, as another */
  /* The header's add button (#380) sits on the left edge of the two card columns, as Offen's does on its cards' */
  .not-planned {
    --add-row-width: calc(2 * var(--task-card-width) + 4.5rem);
    --add-row-max: none;
  }

  .not-planned__grid {
    grid-template-columns: repeat(2, minmax(0, calc(var(--task-card-width) + 1.5rem)));
    column-gap: 3rem;
    justify-content: center;
  }

  /* A category heading (#404) starts on the left edge of the first card, the line the add button and the first card
     share, so it stands over its first card however many cards the category has; centred over two tracks it hung
     beside a single card. It is as wide as the grid and indented by the free space beside the card in its track, so
     the edge holds while the tracks shrink on a narrow desktop (the side is the container: its width less the body's
     2 x 1rem margins and the 3rem gap, halved, is a track). A phone (one track) keeps its centred headings. */
  .not-planned {
    container-type: inline-size;
  }

  .not-planned__group {
    --track: min(calc(var(--task-card-width) + 1.5rem), calc((100cqw - 5rem) / 2));
    /* the free space beside the card in its track */
    --inset: calc((var(--track) - min(var(--task-card-width), var(--track) - 1.5rem)) / 2);
    position: relative;
    inset-inline-start: calc(var(--inset) / 2);
    justify-content: flex-start;
    width: calc(2 * var(--track) + 3rem - var(--inset));
    max-width: 100%;
    margin-inline: auto;
    text-align: start;
  }
}

@media (--phone) {
  /* The add button (#380) takes the left 2.75rem of the card width; "Meine Aufgaben" at the display size (258 px at 390)
     would run under it, so this one headline steps down one notch on a phone and keeps clear of the button on both sides */
  .not-planned :deep(.column-header h2) {
    font-size: calc(var(--text-display) * 0.75);
  }

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
