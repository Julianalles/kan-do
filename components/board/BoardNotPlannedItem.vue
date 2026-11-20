<!--
@component BoardNotPlannedItem
@kind component
@category layout
@description One card under "Alle Aufgaben" on the place "Alle" (#354, #355): the task's card, the arrow that plans it for today, and its registration with the board's drag so it can be carried onto Offen
@usage Rendered by BoardNotPlanned, one per task, as the list's `li` (one root node per list item)
@avoid Not a board card: no status, no card menu, no delete key, never a drop target for another card (SortableTaskWrapper is the card of a column). Not for a static list of cards (trash, recap).
@responsibility
- Card: TaskCard as the board shows it (the source icon by the board's one rule: two or more sources, #609); a click, a tap or Enter on the focused card opens its sheet (`open`)
- Pick: a round button ("Für heute einplanen", named with the task's title; `pick`). Soft primary look (#467, not the solid button: One Lamp Rule). In the card's top right corner at every width (#469 D2; #467's edge arrow would cover the neighbour card in the pair 12 px apart); desktop hides it at rest and shows it on hover and keyboard focus (#373; touch-only devices keep it visible), a phone has it always. A press on it never starts a drag
- Drag (#355): the `li` is a dnd-kit sortable of the group `NOT_PLANNED_GROUP` that accepts only itself, so the cards of this side never make room for one another; the card box is the handle (pointer, touch hold, Space). dnd-kit moves the `li` into Offen's list while it previews a slot there; `useBoardDndKit` puts it back before it stores anything
- Named for assistive tech like a board card: role=group, the task's title, the board's role description
-->
<template>
  <li
    ref="element"
    class="not-planned__item scroll-mt-[calc(var(--app-bar-offset-top)+var(--app-bar-veil-hang)+1rem)]"
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
      <TaskCard :task="task" corner-room @open="(id: string) => emit('open', id)" />
    </div>
    <UTooltip :text="t('board.notPlanned.plan')" :disabled="isPhone">
      <UButton
        class="plan-arrow not-planned__pick"
        data-round="arrow"
        data-fill="primary"
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
  /* The side room a card has in a board column on the phone (task list: px-3); the desktop pair has none (below) */
  --item-pad: 0.75rem;
  padding-inline: var(--item-pad);
  -webkit-touch-callout: none;
}

/* Held in a column's list (Offen): the list's own padding is the side room. Here, not in the components layer:
   the unlayered scoped padding above beats any layered rule */
.task-list > .not-planned__item {
  --item-pad: 0px;
}

/* The pair of columns has no paper beside a card: the gap between them is the cards' own (#469) */
@media (--desktop) {
  .not-planned__item {
    --item-pad: 0px;
  }
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

/* The pick button in the card's top right corner (#469 D2), where a board card has its menu button (TaskCard: 28 px round,
   6 px from the edges), with the 44 px target around it on a phone. #467's soft look; at rest quiet on desktop (below). */
.not-planned__pick {
  position: absolute;
  top: 0.375rem;
  right: calc(50% - min(var(--task-card-max-width), var(--task-card-width), 100% - 2 * var(--item-pad)) / 2 + 0.375rem);
  z-index: calc(var(--z-card) + 1);
}

/* A dragged card's slot carries no arrow */
.not-planned__item.kando-dnd-dragged > .not-planned__pick {
  display: none;
}

/* Desktop with a pointer (#373): hidden at rest, as "Nicht für heute planen" beside an Offen card (SortableTaskWrapper); shown
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
</style>
