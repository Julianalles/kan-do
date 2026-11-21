<!--
@component BoardNotPlanned
@kind block
@category layout
@description The "Alle Aufgaben" side of the place "Alle" (#354, epic #334): every task kan-do holds that is not on today's board, as cards under the column headline "Alle Aufgaben", each with the arrow that plans it for today
@usage Rendered once by Board.vue as the first child of `.board`, left of Offen (desktop: two column tracks wide, the cards in two columns one `--task-list-gap` apart and centred in it, #373, #469; phone: a swipe page of its own left of Offen). `active` says whether the place "Alle" shows, `rendered` whether the cards are in the DOM (also while the board travels to Heute).
@avoid Not a board column: no status, no sorting and no slot inside it (BoardColumn). Not for the trash or another static list of cards.
@responsibility
- Headline: BoardColumnHeader with the same 40 px row below it as every column, so the first card sits level with Offen's first. It reads "Alle Aufgaben" (#701; the app bar pill stays "Alle"), at the Display step on every width, as "Heute" heads Offen; the region's spoken name is the same key (`board.notPlanned.title`). It carries the round add button (#380; while the empty note offers "Aufgabe erstellen" the button fades out in place, 200 ms, #609): a task made on "Alle" is not planned and lands here, so the button sits where the task appears (#567: it opens the Heute flow, an AddTaskSlot `in-card` at the top of this list, which makes the task not planned; the empty note's "Aufgabe erstellen" opens the same card; the sheet under `/all/add` stays for the palette, nav and menu); Offen's header has none on "Alle". The card is one card wide, centred above the panel and the cards (a place in the first grid cell would leave a gap beside it, and moving it between groups would lose the typed title), and the note gives way while it is open; unsaved input is lost when "Alle" is left
- Cards: TaskCard as the board shows it (the source icon only on a board with two or more sources, #609: one rule for both columns); a click, a tap or Enter on the focused card opens its sheet under `/all/:id`, so closing returns to "Alle". No card menu. Each card is a BoardNotPlannedItem
- Drag (#355): a card can be carried onto Offen with the board's own drag (it is planned and lands where it is dropped). The side is one dnd-kit droppable (`data.notPlannedZone`) for a card or stack from Offen: while one is held over it the side shows a wash (no note: the model says it, #609, #581), and the drop takes it off today's board, on top of this list. The cards never make room for one another: no sorting here
- Pick: a round button per card ("Für heute einplanen", named with the task's title). In the card's top right corner at every width (#469 D2: #467's edge arrow would land on the neighbour card at the 12 px gap), in the soft primary look (primary wash, green arrow; #467); desktop hides it at rest and shows it on hover and keyboard focus, as "Nicht für heute planen" is in the Heute column (#373; it was quiet at rest so a first-time user found it, #354 D1e; a touch-only device keeps it visible); a phone has it always, where a board card has its menu button. The move is `usePlanMoves().planForToday`; keyboard focus goes on to the next card's button
- Order: `tasksStore.tasksNotPlanned` (put back by hand first, newest first); the topic focus filters it like a column (`useBoardFocus`)
- A new day (#356, #387, #469, #702): the tasks that were on yesterday's board and are still not planned stand on top in up to two panels (BoardNotPlannedGroup), for that one day only: "Gestern geplant" (the Jetzt and Offen tasks the user's fresh start of today took off the board, `useNewDay().groupIds`, in their board order) and "Gestern in Wartet" (the tasks it took out of Wartet, `waitingIds`, until each is planned again; a task in both shows once, in `groupIds`). Each panel has a sans label with its count and its own button "Alle für heute einplanen" (a phone: below the label row, "Alle einplanen"), which plans every task of the panel as a single pick does (`usePlanAll`: toast with "Rückgängig"; a waiting task lands in Offen). A panel with no tasks (also under the topic focus) is not in the DOM. Every other task follows plain, with no headline, a gap of 1.5 rem under the panels. The first panel's label row is the 40 px row under the headline, so its first card stays level with Offen's. Pick, drag and the focus hand-over work across the groups. A note for the first visit (#711) gets its place at the top of the body, above the panels
- Limit (#357): when Notion holds more "not planned" pages than a sync loads (`notionConfig.notPlannedLimited`, the most recently edited 500), one muted line under the list says so
- Empty: one muted note. Nothing held here: "Keine weiteren Aufgaben vorhanden." and the soft button "Aufgabe erstellen" (#367, the user's wording), which opens the card (#567); a task made while "Alle" shows is not planned, so it lands here; a focus without a match: "Keine Aufgaben gefunden."; a board without any task stays blank
- Many items: the side grows with its cards and the page is the only scroll area on desktop (#609; the capacity echo stays at Offen's foot); on a phone the swipe page scrolls like every column page
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
    <!-- The topic focus bar on the phone (#608), first in the page -->
    <slot name="head" />
    <!-- The add button (#380): a task made on "Alle" is not planned and lands here, so the button sits where the task appears -->
    <BoardColumnHeader
      ref="headerRef"
      :title="t('board.notPlanned.title')"
      :status="TaskStatus.Open"
      :task-count="shown.length"
      :show-add="true"
      :add-disabled="draftTask !== null || isDrafting || inCardAdding"
      :add-away="nothingHeld"
      add-test-id="not-planned-add"
      @add="addTask"
    />
    <!-- The 40 px row every column has under its title (the sorting control's), so the cards start on Offen's line.
         With a panel the panel's heading is that row (#469): the row has no height then -->
    <div class="shrink-0" :class="hasPanel ? 'h-0' : 'h-10'" aria-hidden="true" />

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
          :focus-fallback="focusFallback"
        />
      </div>
      <EmptyNote v-if="held.length > 0 && shown.length === 0" class="not-planned__note" data-testid="not-planned-no-match">
        {{ t('board.notPlanned.noMatch') }}
      </EmptyNote>
      <!-- Nothing held here (#367): the sentence and the one way to fill the side from here. The new task is not planned -->
      <div v-else-if="nothingHeld && !isDrafting" class="not-planned__note flex flex-col items-center gap-3">
        <EmptyNote data-testid="not-planned-empty">
          {{ t('board.notPlanned.empty') }}
        </EmptyNote>
        <UButton color="neutral" variant="soft" icon="i-ph-plus" data-testid="not-planned-create" @click="addTask">
          {{ t('board.notPlanned.create') }}
        </UButton>
      </div>

      <!-- A phone's first panel has 8 px of air under the headline (max-md:mt-2); on desktop it starts at the row's foot, so its
           first card is level with Offen's -->
      <!-- On a new day (#356, #387, #469, #702): what was on yesterday's board and is still not planned, in two panels, one per
           reason a task is here: "Gestern geplant" (Jetzt and Offen of the board) and "Gestern in Wartet" (what the fresh start
           took out of Wartet). Each has its label, count and "plan all" button, and is not in the DOM while it holds nothing
           (an empty list says "0 items"). The regular list below has no headline: a gap of the section rhythm separates it -->
      <BoardNotPlannedGroup
        v-if="plannedTasks.length > 0"
        panel
        class="max-md:mt-2"
        :title="t('board.notPlanned.panelPlanned')"
        :heading-id="plannedHeadingId"
        :count="plannedTasks.length"
        :action-label="t('board.notPlanned.planAll')"
        :action-short="t('board.notPlanned.planAllShort')"
        data-testid="not-planned-panel-planned"
        @add-all="planPanel(plannedTasks.map(task => task.id), $event)"
      >
        <TransitionGroup
          tag="ul"
          name="not-planned-item"
          class="not-planned__grid"
          data-testid="not-planned-list-planned"
        >
          <BoardNotPlannedItem
            v-for="(task, index) in plannedTasks"
            :key="task.id"
            :task="task"
            :index="index"
            @open="openTask"
            @pick="pick"
          />
        </TransitionGroup>
      </BoardNotPlannedGroup>
      <BoardNotPlannedGroup
        v-if="waitingTasks.length > 0"
        panel
        :class="{ 'max-md:mt-2': plannedTasks.length === 0 }"
        :title="t('board.notPlanned.panelWaiting')"
        :heading-id="waitingHeadingId"
        :count="waitingTasks.length"
        :action-label="t('board.notPlanned.planAll')"
        :action-short="t('board.notPlanned.planAllShort')"
        data-testid="not-planned-panel-waiting"
        @add-all="planPanel(waitingTasks.map(task => task.id), $event)"
      >
        <TransitionGroup
          tag="ul"
          name="not-planned-item"
          class="not-planned__grid"
          data-testid="not-planned-list-waiting"
        >
          <BoardNotPlannedItem
            v-for="(task, index) in waitingTasks"
            :key="task.id"
            :task="task"
            :index="plannedTasks.length + index"
            @open="openTask"
            @pick="pick"
          />
        </TransitionGroup>
      </BoardNotPlannedGroup>
      <BoardNotPlannedGroup
        v-show="others.length > 0"
        :class="{ 'mt-6': hasPanel }"
        data-testid="not-planned-group-others"
      >
        <TransitionGroup
          tag="ul"
          name="not-planned-item"
          class="not-planned__grid"
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
import { usePlanAll } from '~/composables/usePlanAll'
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
const { planAll } = usePlanAll()

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
 * The groups of "Alle Aufgaben" (#356, #387, #469): the panel of what was on yesterday's board and is still not planned
 * (the Jetzt and Offen tasks today's fresh start took off the board in the order they had, Jetzt first, then the tasks that
 * same start took out of Wartet; the panel ends with its day, so a Wartet task of an earlier start is under "Weitere
 * Aufgaben"; `waitingIds` never repeats a task of `groupIds`), and every other task
 * under "Weitere Aufgaben". Without a panel there is one plain list, as on any other day.
 */
const { groupIds, waitingIds } = useNewDay()
const { draftTask } = useTaskDraft()
const shownById = computed(() => new Map(shown.value.map(task => [task.id, task])))
const plannedTasks = computed(() => groupIds.value.map(id => shownById.value.get(id)).filter(task => task !== undefined))
const waitingTasks = computed(() => waitingIds.value.map(id => shownById.value.get(id)).filter(task => task !== undefined))
const panelTasks = computed(() => [...plannedTasks.value, ...waitingTasks.value])
const hasPanel = computed(() => panelTasks.value.length > 0)
const others = computed(() => {
  if (!hasPanel.value) return shown.value
  const inPanel = new Set(panelTasks.value.map(task => task.id))
  return shown.value.filter(task => !inPanel.has(task.id))
})
/** The cards in the order they are rendered, across the groups */
const renderedOrder = computed(() => [...panelTasks.value, ...others.value].map(task => task.id))
const plannedHeadingId = useId()
const waitingHeadingId = useId()

/** kan-do holds a task at all: only then "everything is planned for today" is true; a new board stays blank */
const hasTasks = computed(() => tasksStore.tasks.length > 0)
/** Nothing is held here and the board has tasks: the note and "Aufgabe erstellen" offer the add, so the round button steps aside (#609, #581) */
const nothingHeld = computed(() => held.value.length === 0 && hasTasks.value)

const openTask = (id: string) => void navigateTo({ path: `${basePath.value}/${id}` })
/** The add button and "Aufgabe erstellen" (#367, #567): the Heute flow in a card at the top of this list; the task is made not planned (NewCardFlow) */
const headerRef = ref<{ addButtonEl: () => HTMLElement | null } | null>(null)
const addSlotRef = ref<{ open: () => void, isDrafting: boolean } | null>(null)
const isDrafting = computed(() => addSlotRef.value?.isDrafting ?? false)
/** Where focus goes after a cancelled draft: the header's button, or "Aufgabe erstellen" while that button is away */
const focusFallback = () => bodyEl.value?.querySelector<HTMLElement>('[data-testid="not-planned-create"]') ?? headerRef.value?.addButtonEl() ?? null
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
  // The last card: "Aufgabe erstellen" of the now empty note (Offen has no add button on "Alle", #658)
  ;(next ?? focusFallback())?.focus({ preventScroll: true })
}

/**
 * "Alle für heute einplanen" of a panel. A panel whose tasks all moved leaves the DOM with the button that was focused, so a
 * keyboard user's focus goes on: to the button of the next panel, else to the first card's pick button of the plain list, else
 * to "Aufgabe erstellen" / the add button (the places a single pick hands on to as well).
 */
async function planPanel(ids: string[], event: MouseEvent) {
  const button = event.currentTarget as HTMLElement | null
  const hadFocus = button !== null && document.activeElement === button
  const done = await planAll(ids)
  if (done.length === 0 || !hadFocus) return
  await nextTick()
  // The button is still there (a task of the panel stayed): the focus is where it was
  if (button?.isConnected) return
  const body = bodyEl.value
  const target = body?.querySelector<HTMLElement>('[data-testid="nps-group-plan-all"]')
    ?? body?.querySelector<HTMLElement>('[data-testid="not-planned-list-others"] .not-planned__pick')
    ?? focusFallback()
  target?.focus({ preventScroll: true })
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
  .not-planned__body {
    flex: 1 0 auto;
    padding-bottom: 0.75rem;
  }
}
</style>
