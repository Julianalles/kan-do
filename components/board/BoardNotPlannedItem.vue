<!--
@component BoardNotPlannedItem
@kind component
@category layout
@description One card under "Meine Aufgaben" on the place "Alle" (#354, #355): the task's card, the arrow that plans it for today, and its registration with the board's drag so it can be carried onto Offen
@usage Rendered by BoardNotPlanned, one per task, as the list's `li` (one root node per list item)
@avoid Not a board card: no status, no card menu, no delete key, never a drop target for another card (SortableTaskWrapper is the card of a column). Not for a static list of cards (trash, recap).
@responsibility
- Card: TaskCard as the board shows it, always with the source icon; a click, a tap or Enter on the focused card opens its sheet (`open`)
- Pick: a round button ("Für heute einplanen", named with the task's title; `pick`). Desktop: on the paper right of the card, towards Offen, hidden at rest and shown on hover and keyboard focus (#373; touch-only devices keep it visible). Phone: in the card's top right corner. A press on it never starts a drag
- Drag (#355): the `li` is a dnd-kit sortable of the group `NOT_PLANNED_GROUP` that accepts only itself, so the cards of this side never make room for one another; the card box is the handle (pointer, touch hold, Space). dnd-kit moves the `li` into Offen's list while it previews a slot there; `useBoardDndKit` puts it back before it stores anything
- Named for assistive tech like a board card: role=group, the task's title, the board's role description
-->
<template>
  <li
    ref="element"
    class="not-planned__item"
    :class="[{ 'kando-dnd-dragged': isDragging }, dropMotionClasses]"
    :data-not-planned-id="task.id"
  >
    <div
      ref="handle"
      class="not-planned__card"
      role="group"
      tabindex="0"
      :aria-label="task.title"
      :aria-roledescription="t('board.dnd.roleDescription')"
      @keydown.enter.self="openFromKey"
    >
      <TaskCard :task="task" source-icon corner-room @open="(id: string) => emit('open', id)" />
    </div>
    <UTooltip :text="t('board.notPlanned.plan')" :disabled="isPhone">
      <UButton
        class="plan-arrow not-planned__pick"
        color="neutral"
        variant="ghost"
        square
        :icon="ICONS.goOn"
        :aria-label="t('board.notPlanned.planNamed', { title: task.title })"
        data-testid="not-planned-pick"
        @pointerdown.stop
        @click="emit('pick', task.id, $event)"
      />
    </UTooltip>
  </li>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import TaskCard from '~/components/task/TaskCard.vue'
import { useColumnSortable } from '~/composables/useColumnSortable'
import { useDropMotionClasses } from '~/composables/useDropMotion'
import { useIsPhone } from '~/composables/useIsDesktop'
import { NOT_PLANNED_GROUP } from '~/utils/planDrop'
import { ICONS } from '~/lib/icons'
import type { Task } from '~/types/task'

defineOptions({ name: 'BoardNotPlannedItem' })

const props = defineProps<{
  task: Task
  /** Place in the rendered list: the sortable's index within the side */
  index: number
}>()

const emit = defineEmits<{
  /** The card asks for its sheet */
  open: [id: string]
  /** "Für heute einplanen" was pressed; the event tells the list where focus was */
  pick: [id: string, event: MouseEvent]
}>()

const { t } = useI18n()
const isPhone = useIsPhone()

const element = ref<HTMLElement | null>(null)
const handle = ref<HTMLElement | null>(null)
const dropMotionClasses = useDropMotionClasses(() => props.task.id)

// Only itself: without its own droppable the dragged card would find a neighbour under the pointer in the slot it
// just took in Offen and be sorted again; no other card ever lands between the cards of this side (#355)
const { isDragging } = useColumnSortable(
  () => props.task.id,
  computed(() => props.index),
  NOT_PLANNED_GROUP,
  element,
  { handle, data: { notPlannedCard: true }, accept: source => String(source.id) === props.task.id },
)

/** Enter on the focused card: the card's own click handler opens it (as SortableTaskWrapper does on the board) */
function openFromKey(event: KeyboardEvent) {
  if (event.repeat) return
  event.preventDefault()
  ;(event.currentTarget as HTMLElement).querySelector<HTMLElement>('.task')?.dispatchEvent(new MouseEvent('click'))
}
</script>

<style scoped>
.not-planned__item {
  position: relative;
  display: flex;
  justify-content: center;
  width: 100%;
  /* The side room a card has in a board column on the phone (task list: px-3) */
  padding-inline: 0.75rem;
  -webkit-touch-callout: none;
}

/* Held in a column's list (Offen): the list's own padding is the side room. Here, not in the components layer:
   the unlayered scoped padding above beats any layered rule */
.task-list > .not-planned__item {
  padding-inline: 0;
}

/* The focusable card box: the card's own width, so the focus ring hugs the card */
.not-planned__card {
  display: flex;
  justify-content: center;
  width: min(var(--task-card-width), 100%);
  max-width: var(--task-card-max-width);
  border-radius: var(--task-card-radius);
  text-align: start;
}

/* The board's one focus ring (board-focus.css: the tokens of DESIGN.md "Focus"), drawn on the card box */
.not-planned__card:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

/* The pick button centred on the card's right edge, towards Offen (#467). Quiet at rest, full under the pointer and on focus. */
.not-planned__pick {
  position: absolute;
  top: 50%;
  left: calc(50% + min(var(--task-card-width), 100% - 1.5rem) / 2 - 1rem); /* #467: the button's centre on the card's right edge (2 rem button) */
  translate: 0 -50%;
}

/* A dragged card's slot carries no arrow */
.not-planned__item.kando-dnd-dragged > .not-planned__pick {
  display: none;
}

/* Desktop with a pointer (#373): hidden at rest, as "Nicht heute" beside an Offen card (SortableTaskWrapper); shown
   under the pointer and on keyboard focus of the card or the arrow. Opacity, not display: the arrow stays in the tab
   order. A touch-only device keeps it visible (no hover to find it with); a phone has it in the card's corner. */
@media (--desktop) and (hover: hover) {
  .not-planned__pick {
    opacity: 0;
  }

  .not-planned__item:hover .not-planned__pick,
  .not-planned__item:has(.not-planned__card:focus-visible) .not-planned__pick,
  .not-planned__pick:focus-visible {
    opacity: 1;
  }
}

@media (--phone) {
  /* No paper beside a phone card: the button sits in the card's top right corner, where a board card has its menu
     button (TaskCard: 28 px round, 6 px from the edges), with the 44 px target around it */
  .not-planned__pick {
    top: 0.375rem;
    left: auto;
    right: calc(50% - min(var(--task-card-max-width), 100% - 1.5rem) / 2 + 0.375rem);
    translate: none;
    z-index: calc(var(--z-card) + 1);
  }
}
</style>
