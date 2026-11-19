<!--
@component BoardNotPlanned
@kind block
@category layout
@description The "Meine Aufgaben" side of the place "Alle" (#354, epic #334): every task kan-do holds that is not on today's board, as cards under a column headline, each with the arrow that plans it for today
@usage Rendered once by Board.vue as the first child of `.board`, left of Offen (desktop: two column tracks wide, the cards in two columns one `--task-list-gap` apart and centred in it, #373, #469; phone: a swipe page of its own left of Offen). `active` says whether the place "Alle" shows, `rendered` whether the cards are in the DOM (also while the board travels to Heute).
@avoid Not a board column: no status, no sorting and no slot inside it (BoardColumn). Not for the trash or another static list of cards.
@responsibility
- Headline: BoardColumnHeader with the same 40 px row below it as every column, so the first card sits level with Offen's first. It carries the round add button (#380): a task made on "Alle" is not planned and lands here, so the button sits where the task appears (#567: it opens the Heute flow, an AddTaskSlot `in-card` at the top of this list, which makes the task not planned; the empty note's "Aufgabe erstellen" opens the same card; the sheet under `/all/add` stays for the palette, nav and menu); Offen's header has none on "Alle". The card is one card wide, centred above the panel and the cards (a place in the first grid cell would leave a gap beside it, and moving it between groups would lose the typed title), and the note gives way while it is open; unsaved input is lost when "Alle" is left
- Cards: TaskCard as the board shows it, always with the source icon (the question here is where a task comes from); a click, a tap or Enter on the focused card opens its sheet under `/all/:id`, so closing returns to "Alle". No card menu. Each card is a BoardNotPlannedItem
- Drag (#355): a card can be carried onto Offen with the board's own drag (it is planned and lands where it is dropped). The side is one dnd-kit droppable (`data.notPlannedZone`) for a card or stack from Offen: while one is held over it the side shows a wash and "Hier ablegen: nicht heute" under the headline, and the drop takes it off today's board, on top of this list. The cards never make room for one another: no sorting here
- Pick: a round button per card ("Für heute einplanen", named with the task's title). In the card's top right corner at every width (#469 D2: #467's edge arrow would land on the neighbour card at the 12 px gap), in the soft primary look (primary wash, green arrow; #467); desktop hides it at rest and shows it on hover and keyboard focus, as "Nicht heute" is in the Heute column (#373; it was quiet at rest so a first-time user found it, #354 D1e; a touch-only device keeps it visible); a phone has it always, where a board card has its menu button. The move is `usePlanMoves().planForToday`; keyboard focus goes on to the next card's button
- Order: `tasksStore.tasksNotPlanned` (put back by hand first, newest first); the topic focus filters it like a column (`useBoardFocus`)
- A new day (#356, #387, #469): the tasks that were on yesterday's board and are still not planned stand on top in one panel (BoardNotPlannedGroup) headed "Gestern auf dem Board" with their count, for that one day only: the Jetzt and Offen tasks the user's fresh start of today took off the board (`useNewDay().groupIds`) in their board order, then the tasks it took out of Wartet (`waitingIds`, until each is planned again; a task in both shows once, in `groupIds`). Every other task follows plain under "Weitere Aufgaben" (heading and count, no surface). The panel's heading is the 40 px row under the headline, so its first card stays level with Offen's; while an Offen card is held over the side the hint takes that row. Without a panel there are no headings at all; a panel the topic focus leaves empty is not shown. Pick, drag and the focus hand-over work across the groups
- Limit (#357): when Notion holds more "not planned" pages than a sync loads (`notionConfig.notPlannedLimited`, the most recently edited 500), one muted line under the list says so
- Empty: one muted note. Nothing held here: "Keine weiteren Aufgaben vorhanden." and the soft button "Aufgabe erstellen" (#367, the user's wording), which opens the card (#567); a task made while "Alle" shows is not planned, so it lands here; a focus without a match: "Keine Aufgaben gefunden."; a board without any task stays blank
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
    <!-- The add button (#380): a task made on "Alle" is not planned and lands here, so the button sits where the task appears -->
    <BoardColumnHeader
      ref="headerRef"
      :title="t('board.notPlanned.title')"
      :status="TaskStatus.Open"
      :task-count="shown.length"
      :show-add="true"
      :add-disabled="draftTask !== null || isDrafting || inCardAdding"
      add-test-id="not-planned-add"
      @add="addTask"
    />
    <!-- The 40 px row every column has under its title (the sorting control's), so the cards start on Offen's line.
         While an Offen card is held over the side it says what a drop does (#355), where Erledigt has its drop line.
         With a panel the panel's heading is that row (#469): the row has no height then and the hint takes the heading's place -->
    <div class="relative flex shrink-0 items-center justify-center" :class="hasPanel ? 'h-0' : 'h-10'">
      <Transition name="not-planned-hint">
        <p
          v-if="isDropTarget"
          class="not-planned__hint absolute inset-x-0 truncate px-3 text-center text-sm font-medium text-default"
          :class="{ 'not-planned__hint--over': hasPanel }"
          data-testid="not-planned-drop-hint"
        >
          {{ t('board.notPlanned.dropHere') }}
        </p>
      </Transition>
    </div>

    <div v-if="rendered" ref="bodyEl" class="not-planned__body">
      <!-- The draft host (#567): the Heute flow, in the card, at the top of the list. It has no box while no draft is open -->
      <div class="not-planned__draft">
        <AddTaskSlot
          ref="addSlotRef"
          :status="TaskStatus.Open"
          :label="t('board.addTask')"
          :show-button="false"
          :hidden="dragState.isDragging"
          :in-card="true"
          :focus-fallback="() => headerRef?.addButtonEl() ?? null"
        />
      </div>
      <EmptyNote v-if="held.length > 0 && shown.length === 0" class="not-planned__note" data-testid="not-planned-no-match">
        {{ t('board.notPlanned.noMatch') }}
      </EmptyNote>
      <!-- Nothing held here (#367): the sentence and the one way to fill the side from here. The new task is not planned -->
      <div v-else-if="held.length === 0 && hasTasks && !isDrafting" class="not-planned__note flex flex-col items-center gap-3">
        <EmptyNote data-testid="not-planned-empty">
          {{ t('board.notPlanned.empty') }}
        </EmptyNote>
        <UButton color="neutral" variant="soft" icon="i-ph-plus" data-testid="not-planned-create" @click="addTask">
          {{ t('board.notPlanned.create') }}
        </UButton>
      </div>

      <!-- On a new day (#356, #387, #469): what was on yesterday's board and is still not planned (Jetzt and Offen first, then
           what a fresh start took out of Wartet) in one panel with its heading and count, for that day. Not in the reader's
           tree while it holds nothing: an empty list says "0 items" -->
      <BoardNotPlannedGroup
        v-show="hasPanel"
        panel
        :title="t('board.notPlanned.groupBoardYesterday')"
        :heading-id="panelHeadingId"
        :count="panelTasks.length"
        icon="i-ph-arrow-u-up-left"
        :heading-hidden="isDropTarget"
        data-testid="not-planned-panel"
      >
        <TransitionGroup
          tag="ul"
          name="not-planned-item"
          class="not-planned__grid"
          data-testid="not-planned-list-panel"
        >
          <BoardNotPlannedItem
            v-for="(task, index) in panelTasks"
            :key="task.id"
            :task="task"
            :index="index"
            @open="openTask"
            @pick="pick"
          />
        </TransitionGroup>
      </BoardNotPlannedGroup>
      <!-- "Weitere Aufgaben" only says something beside the panel above it: without one the side looks as on any other day -->
      <BoardNotPlannedGroup
        v-show="others.length > 0"
        :title="hasPanel ? t('board.notPlanned.groupOthers') : undefined"
        :heading-id="othersHeadingId"
        :count="others.length"
        icon="i-ph-tray"
        data-testid="not-planned-group-others"
      >
        <TransitionGroup
          tag="ul"
          name="not-planned-item"
          class="not-planned__grid"
          :aria-labelledby="hasPanel ? othersHeadingId : undefined"
          data-testid="not-planned-list-others"
        >
          <BoardNotPlannedItem
            v-for="(task, index) in others"
            :key="task.id"
            :task="task"
            :index="panelTasks.length + index"
            @open="openTask"
            @pick="pick"
          />
        </TransitionGroup>
      </BoardNotPlannedGroup>
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
import AddTaskSlot from '~/components/board/AddTaskSlot.vue'
import BoardColumnHeader from '~/components/board/BoardColumnHeader.vue'
import EmptyNote from '~/components/ui/EmptyNote.vue'
import BoardNotPlannedGroup from '~/components/board/BoardNotPlannedGroup.vue'
import BoardNotPlannedItem from '~/components/board/BoardNotPlannedItem.vue'
import { useTasksStore } from '~/store/tasks'
import { useBoardFocus } from '~/composables/useBoardFocus'
import { useBoardPlace } from '~/composables/useBoardPlace'
import { usePlanMoves } from '~/composables/usePlanMoves'
import { useNewDay } from '~/composables/useNewDay'
import { inCardAdding } from '~/composables/useInCardAdding'
import { useTaskDraft } from '~/composables/useTaskDraft'
import { useBoardDragState } from '~/composables/useBoardDragState'
import { notPlannedZoneAccepts } from '~/utils/planDrop'
import { TaskStatus } from '~/types/taskStatus'
import { useNotionConfigStore } from '~/store/notionConfig'
import { useBoardStore } from '~/store/board'
import { NOT_PLANNED_PAGE_LIMIT } from '~/lib/notionLimits'

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
// Notion left "not planned" pages out of the last sync (#357); only while Notion is a connection of this board
const notionLimited = computed(() => useNotionConfigStore().notPlannedLimited === true && useBoardStore().isIntegrationConnected('notion'))
/** What the topic focus leaves of it (the funnel in the app bar filters this side like a column) */
const shown = computed(() => applyFocus(held.value))
/**
 * The groups of "Meine Aufgaben" (#356, #387, #469): the panel of what was on yesterday's board and is still not planned
 * (the Jetzt and Offen tasks today's fresh start took off the board in the order they had, Jetzt first, then the tasks that
 * same start took out of Wartet; the panel ends with its day, so a Wartet task of an earlier start is under "Weitere
 * Aufgaben"; `waitingIds` never repeats a task of `groupIds`), and every other task
 * under "Weitere Aufgaben". Without a panel there is one plain list, as on any other day.
 */
const { groupIds, waitingIds } = useNewDay()
const { draftTask } = useTaskDraft()
const shownById = computed(() => new Map(shown.value.map(task => [task.id, task])))
const panelTasks = computed(() => [...groupIds.value, ...waitingIds.value].map(id => shownById.value.get(id)).filter(task => task !== undefined))
const hasPanel = computed(() => panelTasks.value.length > 0)
const others = computed(() => {
  if (!hasPanel.value) return shown.value
  const inPanel = new Set(panelTasks.value.map(task => task.id))
  return shown.value.filter(task => !inPanel.has(task.id))
})
/** The cards in the order they are rendered, across the groups */
const renderedOrder = computed(() => [...panelTasks.value, ...others.value].map(task => task.id))
const panelHeadingId = useId()
const othersHeadingId = useId()

/** kan-do holds a task at all: only then "everything is planned for today" is true; a new board stays blank */
const hasTasks = computed(() => tasksStore.tasks.length > 0)

const openTask = (id: string) => void navigateTo({ path: `${basePath.value}/${id}` })
/** The add button and "Aufgabe erstellen" (#367, #567): the Heute flow in a card at the top of this list; the task is made not planned (NewCardFlow) */
const headerRef = ref<{ addButtonEl: () => HTMLElement | null } | null>(null)
const addSlotRef = ref<{ open: () => void, isDrafting: boolean } | null>(null)
const isDrafting = computed(() => addSlotRef.value?.isDrafting ?? false)
const addTask = () => {
  if (inCardAdding.value) return
  addSlotRef.value?.open()
}

/** Plans the card. A keyboard user's focus was on the button that now leaves: it goes on to the next card's button. */
async function pick(id: string, event: MouseEvent) {
  const button = event.currentTarget as HTMLElement
  const hadFocus = document.activeElement === button
  // The next card as rendered, also across the groups (#356, #387, #469); the last card hands on to the one before it
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

/* The draft card's row (#567): no box while no draft is open. Open, the card keeps the list's gap below it (the slot's
   own negative margin only cancels the gap inside Offen's flex list, here there is none) and enters from no margin */
.not-planned__draft :deep(.add-task-slot-draft-wrap) {
  margin-bottom: var(--task-list-gap);
}

.not-planned__draft :deep(.add-task-slot-draft-enter-from),
.not-planned__draft :deep(.add-task-slot-draft-leave-to) {
  margin-bottom: 0;
}

.not-planned__grid {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  justify-items: center;
  row-gap: var(--task-list-gap);
}

/* The hint of a drop takes the place of the panel's heading, which has the 40 px row (#469) */
.not-planned__hint--over {
  top: 0;
  z-index: 3;
  /* The heading's 40 px row as one line box (a single truncated line), so no padding sits off the 4 px grid */
  line-height: 2.5rem;
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
    /* Side margins; the scroll box clips on both axes, so the card shadow and the focus ring need them (#430) */
    padding-inline: 1rem;
    /* Room for the card shadow and the focus ring at the scroll box's upper edge */
    padding-top: 0.25rem;
    margin-top: -0.25rem;
  }

  /* A card put back flies in from Offen: the scroll box must not clip it on the way (usePlanMoves sets the class) */
  .not-planned.is-receiving .not-planned__body {
    overflow: visible;
  }

  /* Two card columns one gap apart and centred in the side (#469): the gap is the one cards have below them
     (--task-list-gap), BoardNotPlannedGroup sets the width of the pair, the pick arrow sits in each card's corner.
     The header's add button (#380) sits on the left edge of the two card columns, as Offen's does on its cards' */
  .not-planned {
    --add-row-width: calc(2 * var(--task-card-width) + var(--task-list-gap));
    --add-row-max: none;
  }

  .not-planned__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: var(--task-list-gap);
    justify-items: stretch;
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
