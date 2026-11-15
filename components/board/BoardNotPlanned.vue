<!--
@component BoardNotPlanned
@kind block
@category layout
@description The "Nicht geplant" side of the place "Alle" (#354, epic #334): every task kan-do holds that is not on today's board, as cards under a column headline, each with the arrow that plans it for today
@usage Rendered once by Board.vue as the first child of `.board`, left of Offen (desktop: two column tracks wide, cards in two columns; phone: a swipe page of its own left of Offen). `active` says whether the place "Alle" shows, `rendered` whether the cards are in the DOM (also while the board travels to Heute).
@avoid Not a board column: no status, no drag, no drop, no sorting (BoardColumn); drag between this side and Offen is #355. Not for the trash or another static list of cards.
@responsibility
- Headline: BoardColumnHeader with the same 40 px row below it as every column, so the first card sits level with Offen's first
- Cards: TaskCard as the board shows it, always with the source icon (the question here is where a task comes from); a click, a tap or Enter on the focused card opens its sheet under `/all/:id`, so closing returns to "Alle". No card menu, no drag
- Pick: a round button per card ("Für heute einplanen", named with the task's title). Desktop: on the paper right of the card, towards Offen, quiet at rest and full on hover and focus, so a first-time user finds it (#354 D1e). Phone: in the card's top right corner, where a board card has its menu button. The move is `usePlanMoves().planForToday`; keyboard focus goes on to the next card's button
- Order: `tasksStore.tasksNotPlanned` (put back by hand first, newest first); the topic focus filters it like a column (`useBoardFocus`)
- Empty: one muted note. Nothing held here: "Noch keine weiteren Aufgaben. Alles ist für heute geplant." plus how a task gets here (#354 D1c: until #357 nothing arrives by itself); a focus without a match: "Keine Aufgaben gefunden."; a board without any task stays blank
- Many items: on desktop the side is as tall as the window and its list scrolls inside it, so Offen and "Weiter zu Heute" stay in view; on a phone the page scrolls like every column page
- Out of view (`active` false) the side is `inert`; Board.vue's CSS takes it out of layout or view once the move is over
-->
<template>
  <section
    id="column-not-planned"
    class="column not-planned"
    :aria-label="t('board.notPlanned.title')"
    :inert="!active || undefined"
    data-testid="not-planned"
  >
    <BoardColumnHeader :title="t('board.notPlanned.title')" :status="TaskStatus.Open" :task-count="shown.length" />
    <!-- The 40 px row every column has under its title (the sorting control's), so the cards start on Offen's line -->
    <div class="h-10 shrink-0" aria-hidden="true" />

    <div v-if="rendered" ref="bodyEl" class="not-planned__body">
      <EmptyNote v-if="held.length > 0 && shown.length === 0" class="not-planned__note" data-testid="not-planned-no-match">
        {{ t('board.notPlanned.noMatch') }}
      </EmptyNote>
      <EmptyNote v-else-if="held.length === 0 && hasTasks" class="not-planned__note" data-testid="not-planned-empty">
        {{ t('board.notPlanned.empty') }} {{ t('board.notPlanned.emptyHow') }}
      </EmptyNote>

      <TransitionGroup tag="ul" name="not-planned-item" class="not-planned__grid">
        <li v-for="task in shown" :key="task.id" class="not-planned__item" :data-not-planned-id="task.id">
          <div
            class="not-planned__card"
            role="group"
            tabindex="0"
            :aria-label="task.title"
            @keydown.enter.self="openFromKey"
          >
            <TaskCard :task="task" source-icon corner-room @open="openTask" />
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
              @click="pick(task.id, $event)"
            />
          </UTooltip>
        </li>
      </TransitionGroup>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { navigateTo } from 'nuxt/app'
import BoardColumnHeader from '~/components/board/BoardColumnHeader.vue'
import EmptyNote from '~/components/ui/EmptyNote.vue'
import TaskCard from '~/components/task/TaskCard.vue'
import { useTasksStore } from '~/store/tasks'
import { useBoardFocus } from '~/composables/useBoardFocus'
import { useBoardPlace } from '~/composables/useBoardPlace'
import { usePlanMoves } from '~/composables/usePlanMoves'
import { useIsPhone } from '~/composables/useIsDesktop'
import { TaskStatus } from '~/types/taskStatus'
import { ICONS } from '~/lib/icons'

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
const isPhone = useIsPhone()

const bodyEl = ref<HTMLElement | null>(null)

/** Everything that is not on today's board */
const held = computed(() => tasksStore.tasksNotPlanned)
/** What the topic focus leaves of it (the funnel in the app bar filters this side like a column) */
const shown = computed(() => applyFocus(held.value))
/** kan-do holds a task at all: only then "everything is planned for today" is true; a new board stays blank */
const hasTasks = computed(() => tasksStore.tasks.length > 0)

const openTask = (id: string) => void navigateTo({ path: `${basePath.value}/${id}` })

/** Enter on the focused card: the card's own click handler opens it (as SortableTaskWrapper does on the board) */
function openFromKey(event: KeyboardEvent) {
  if (event.repeat) return
  event.preventDefault()
  ;(event.currentTarget as HTMLElement).querySelector<HTMLElement>('.task')?.dispatchEvent(new MouseEvent('click'))
}

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
  padding: 0 1.5rem;
  text-align: center;
}

.not-planned__item {
  position: relative;
  display: flex;
  justify-content: center;
  width: 100%;
  /* The side room a card has in a board column on the phone (task list: px-3) */
  padding-inline: 0.75rem;
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

.not-planned__card:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

/* The pick button on the paper right of the card, towards Offen. Quiet at rest, full under the pointer and on focus. */
.not-planned__pick {
  position: absolute;
  top: 50%;
  left: calc(50% + min(var(--task-card-width), 100% - 1.5rem) / 2 + 0.375rem);
  translate: 0 -50%;
}

@media (hover: hover) {
  .not-planned__pick:not(:hover, :focus-visible) {
    background-color: transparent;
    color: var(--ui-text-muted);
  }

  .not-planned__item:hover .not-planned__pick {
    background-color: var(--fill-on-canvas);
    color: var(--ui-text);
  }

  .not-planned__item:hover .not-planned__pick:hover {
    background-color: var(--fill-on-canvas-hover);
  }
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

@media (prefers-reduced-motion: reduce) {
  .not-planned-item-move,
  .not-planned-item-enter-active {
    transition: none;
  }
}
</style>
