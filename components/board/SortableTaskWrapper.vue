<!--
@component SortableTaskWrapper
@kind component
@category layout
@description Per-item sortable wrapper for dnd-kit. Each task card in a column
is wrapped in this component so it can be dragged and sorted within/across columns.
@usage Wraps every task card of a sortable column (BoardColumnItem)
@avoid Only for task cards in a sortable column; static lists (trash, recap, day close) render the card without it.
@responsibility
- Register with dnd-kit's DragDropManager via useColumnSortable
- Expose isDragging state for placeholder styling
- Name the card for assistive tech: role=group + aria-label = task title + localised role description.
  Not role=button: axe's label-content-name-mismatch (WCAG 2.5.3) would demand the whole visible card text in the name.
- Enter on the focused card opens the task details (Space starts the keyboard drag); a held key's repeats do not
- Delete or Backspace on the focused card deletes it with undo (#579): the shared deleteTaskWithUndo, focus on the
  neighbour card. Ignored for a held key, a modifier, a drag in progress and keys that bubble from a control inside the card
- Preserve data-task-id attribute for E2E tests and CSS targeting
- Describe a member of an expanded stack for assistive tech: a visually hidden "n of m in <group>"
  wired by aria-describedby (#154). The accessible name stays the task title.
- Mark a member of an expanded stack with data-from-stack="<group key>" (#147): a click on it is not
  an outside click for the column's expanded stacks
- "Nicht heute" (#354): on the place "Alle" an Offen card carries a round arrow button on the paper left of it (desktop
  only, shown on hover and keyboard focus, named with the task's title); it takes the card off today's board through
  `usePlanMoves().notToday`. Its click and keys stay out of the card's own handlers and the drag
-->
<script setup lang="ts">
import { ref, computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '~/store/tasks'
import { useColumnSortable } from '~/composables/useColumnSortable'
import { useDropMotionClasses } from '~/composables/useDropMotion'
import { useTaskDeletion } from '~/composables/useTaskDeletion'
import { findCardElement, neighbourCardId } from '~/utils/neighbourCard'
import { focusFirstAvailable } from '~/utils/focusRecovery'
import { TaskStatus } from '~/types/taskStatus'
import { useBoardPlace } from '~/composables/useBoardPlace'
import { usePlanMoves } from '~/composables/usePlanMoves'
import { useIsPhone } from '~/composables/useIsDesktop'
import { ICONS } from '~/lib/icons'

defineOptions({ name: 'SortableTaskWrapper' })

const props = defineProps<{
  taskId: string
  index: number
  taskStatus: TaskStatus
  /** Group key of the expanded stack this card belongs to */
  fromStack?: string
  /** Place in that stack; the spacing of the expanded group keys on it, not on DOM neighbours */
  stackPosition?: 'first' | 'middle' | 'last'
  /** 1-based place in that stack; with `stackSize` and `stackLabel` it forms the member description */
  stackIndex?: number
  /** Number of cards in the stack */
  stackSize?: number
  /** Readable group name */
  stackLabel?: string
}>()

const { t } = useI18n()
const tasksStore = useTasksStore()
const task = computed(() => tasksStore.tasks.find(item => item.id === props.taskId))
const element = ref<HTMLElement | null>(null)
const indexRef = computed(() => props.index)

const positionId = `task-wrapper-position-${useId()}`
const positionText = computed(() =>
  props.stackIndex !== undefined && props.stackSize !== undefined && props.stackLabel !== undefined
    ? t('board.stack.memberPosition', { n: props.stackIndex, total: props.stackSize, group: props.stackLabel })
    : null,
)

const dropMotionClasses = useDropMotionClasses(() => props.taskId)

const { isDragging } = useColumnSortable(
  props.taskId,
  indexRef,
  props.taskStatus,
  element
)

/**
 * Enter opens details. dnd-kit's keyboard sensor only starts on Space (see useBoardAnnouncements),
 * so Enter reaches us. Dispatches a click (detail 0) on the card, so TaskCard's open handler keeps the stack/drag
 * guards in one place. It does not bubble: the board's outside-click listeners must not take a key press for a pointer click.
 */
function openDetails(event: KeyboardEvent) {
  // A held Enter repeats: the one that expanded a stack lands here on its first member, and a
  // repeat must not open the sheet
  if (event.repeat) return
  event.preventDefault()
  element.value?.querySelector<HTMLElement>('.task')?.dispatchEvent(new MouseEvent('click'))
}

const { deleteTaskWithUndo } = useTaskDeletion()

// "Nicht heute" (#354): only an Offen card on the place "Alle", and never on a phone (no paper beside the card there)
const { isAll } = useBoardPlace()
const { notToday } = usePlanMoves()
const isPhone = useIsPhone()
const showNotToday = computed(() => isAll.value && props.taskStatus === TaskStatus.Open && !isPhone.value)

/** Takes the card off today's board. A keyboard user's focus was on the arrow that leaves with it: it goes to the neighbour card. */
async function putBack(event: MouseEvent) {
  const hadFocus = document.activeElement === event.currentTarget
  const neighbour = neighbourCardId(props.taskId)
  if (!(await notToday(props.taskId)) || !hadFocus) return
  if (neighbour) focusFirstAvailable([() => findCardElement(neighbour)])
}

/**
 * Delete (and Backspace, the Mac "delete" key) deletes the focused card (#579). `.self` on the listener keeps a key
 * pressed in a control inside the card out. A held key would delete the neighbour focus just moved to, so repeats are
 * ignored; so are modifier combos and a running keyboard drag.
 */
function deleteFocusedCard(event: KeyboardEvent) {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isDragging.value) return
  event.preventDefault()
  // Resolved before the delete: afterwards the card's own gap stands in its place
  const neighbour = neighbourCardId(props.taskId)
  if (!deleteTaskWithUndo(props.taskId)) return
  // No neighbour: the gap moves the lost focus on when its window closes
  if (neighbour) {
    focusFirstAvailable([() => findCardElement(neighbour)])
  }
}
</script>

<template>
  <div
    ref="element"
    class="task-wrapper"
    :data-task-id="taskId"
    :data-from-stack="fromStack"
    :data-stack-position="stackPosition"
    role="group"
    :aria-label="task?.title"
    :aria-describedby="positionText ? positionId : undefined"
    :aria-roledescription="t('board.dnd.roleDescription')"
    :class="[{ 'kando-dnd-dragged': isDragging, 'task-wrapper--not-today': showNotToday }, dropMotionClasses]"
    @keydown.enter.self="openDetails"
    @keydown.delete.self="deleteFocusedCard"
  >
    <slot />
    <!-- "Nicht heute" (#354): on "Alle" an Offen card has the mirrored arrow on the paper left of it, towards "Nicht
         geplant". Desktop only; on a phone the card menu does it -->
    <UTooltip v-if="showNotToday" :text="t('board.notPlanned.notToday')">
      <UButton
        class="plan-arrow task-wrapper__not-today"
        color="neutral"
        variant="ghost"
        square
        :icon="ICONS.stepBack"
        :aria-label="t('board.notPlanned.notTodayNamed', { title: task?.title ?? '' })"
        data-testid="not-today-arrow"
        @pointerdown.stop
        @click.stop="putBack"
        @keydown.stop
      />
    </UTooltip>
    <span v-if="positionText" :id="positionId" hidden>{{ positionText }}</span>
  </div>
</template>

<style scoped>
/* "Nicht heute" (#354): on the paper left of the card, towards "Meine Aufgaben"; the wrapper spans the list's width and
   the card is centred in it. Shown under the pointer and on keyboard focus (the pick arrow on the other side is the
   one a first-time user must find; Offen stays as calm as on Heute). */
/* Only while the arrow is there: a positioned wrapper on every card changes how the board is layered, which moved
   the Wartet headline's glyphs by a sub-pixel on Heute (visual baselines) */
.task-wrapper--not-today {
  position: relative;
}

.task-wrapper__not-today {
  position: absolute;
  top: 50%;
  right: calc(50% + min(var(--task-card-width), 100%) / 2 + 0.375rem);
  translate: 0 -50%;
  opacity: 0;
}

.task-wrapper:hover > .task-wrapper__not-today,
.task-wrapper:focus-visible > .task-wrapper__not-today,
.task-wrapper__not-today:focus-visible {
  opacity: 1;
}

/* A touch-only device at desktop width has no hover to reveal the arrow, and an invisible target that takes a card off
   the day must not exist: there the card's menu button (TaskCard, shown under the same query) carries "Nicht heute" */
@media (hover: none) {
  .task-wrapper__not-today {
    display: none;
  }
}

/* A dragged card and its placeholder carry no arrow */
.task-wrapper.kando-dnd-dragged > .task-wrapper__not-today {
  display: none;
}
</style>
