<!--
@component BoardPlanNote
@kind component
@category feedback
@description The one-time note of the place "Alle" (#711, #741): after the user chose "Neuen Tag planen" it says what this step is for (pick what is on for today) and when to go to "Heute" (when they want to start). It stands where the picked tasks land: in the empty "Heute" column on desktop, as one line under the headline "Alle Aufgaben" on a phone. It has no button that moves on.
@usage <BoardPlanNote face="column" /> in the Offen column's list (Board.vue fills BoardColumn's `list-start` slot, desktop), <BoardPlanNote face="line" /> first in the body of BoardNotPlanned (phone). Each face renders only at its width. Whether the note is due lives in `useNewDay` (`planNoteShown`, `answerPlanNote`) and the persisted flag `dayRecap.planNoteSeen`.
@avoid Not a notice about the board's state (NewDayNote), not a toast, not a tour step or a tip anchored at another element: it stands where the step happens and goes once. Never for "Alle" opened any other way (pill, deep link, "Überspringen und Board anzeigen"). Not the empty state of a column (EmptyNote, the Offen column's own hints on "Heute").
@responsibility
- Shown while the note is due, the place "Alle" shows and nothing is planned for today yet (no Offen, Jetzt or Wartet card): it gives way to the first planned card and is back if that card is taken off again. The column face also steps aside while a card is dragged (the column shows its drop slot)
- `column` (desktop): plain text on the canvas, no box and no button (#741: one highlighted area on the page, the block): the arrow the sentence speaks of (the glyph of a card's "Für heute einplanen"), the title and one muted sentence, centred in a reading measure of 18 rem
- `line` (phone): one muted line with a close control (a ghost icon button named "Schließen", 44 px target), in the `lead` slot of a BoardNotPlannedGroup, so its text starts on the cards' left edge and the control ends on their right one (two lines at 390 px)
- Answered by the phone's close control or when the place changes from "Alle" to "Heute" while the note is due (the user went on; a page off the board such as Statistik is no answer, the note returns with "Alle"): both write the persisted flag, so it never returns, also after a restart. Opening a task sheet under `/all/:id` does not leave "Alle". Nothing is written to a connection and no task changes. When it shows at all and how it is dismissed for good belongs to the intro hints (#725, #803)
- `role="status"` on both faces; keyboard focus goes to the board region when the close control removes the focused button, never to `<body>`
-->
<template>
  <!-- Plain text on the canvas where the picked tasks land: no box, a reading measure of 18 rem, centred in the column -->
  <div v-if="shown && face === 'column'" class="mx-auto mt-6 flex max-w-72 flex-col items-center gap-1.5 text-center text-balance" role="status" data-testid="plan-note">
    <UIcon :name="ICONS.goOn" class="size-5 text-dimmed" />
    <p class="text-body font-medium text-default">{{ t('board.planNote.title') }}</p>
    <p class="text-body text-muted">{{ t('board.planNote.description') }}</p>
  </div>
  <!-- The group gives the line the measure of the cards below; a phone keeps the cards' inset -->
  <BoardNotPlannedGroup v-else-if="shown" class="mt-2 mb-4" data-testid="plan-note-host">
    <template #lead>
      <div class="flex items-start gap-2" role="status" data-testid="plan-note">
        <!-- pt-1: the line's first row is centred on the 2 rem close control -->
        <p class="min-w-0 flex-1 pt-1 text-body text-muted">{{ t('board.planNote.line') }}</p>
        <UButton
          color="neutral"
          variant="ghost"
          square
          :icon="ICONS.close"
          :aria-label="t('board.planNote.close')"
          class="shrink-0"
          data-testid="plan-note-close"
          @click="close"
        />
      </div>
    </template>
  </BoardNotPlannedGroup>
</template>

<script setup lang="ts">
import { computed, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BoardNotPlannedGroup from '~/components/board/BoardNotPlannedGroup.vue'
import { useNewDay } from '~/composables/useNewDay'
import { useBoardPlace } from '~/composables/useBoardPlace'
import { useBoardDragState } from '~/composables/useBoardDragState'
import { boardPlaceOfPath, currentBoardPath } from '~/lib/boardPlace'
import { useIsPhone } from '~/composables/useIsDesktop'
import { useTasksStore } from '~/store/tasks'
import { focusFirstAvailable } from '~/utils/focusRecovery'
import { ICONS } from '~/lib/icons'

defineOptions({ name: 'BoardPlanNote' })

const props = defineProps<{
  /** Where it stands: `column` in the empty "Heute" column (desktop), `line` under the headline "Alle Aufgaben" (phone) */
  face: 'column' | 'line'
}>()

const { t } = useI18n()
const { planNoteShown, answerPlanNote } = useNewDay()
const { isAll } = useBoardPlace()
const { dragState } = useBoardDragState()
const tasksStore = useTasksStore()
const isPhone = useIsPhone()

/** Nothing is planned for today yet: the note gives way to the first planned card */
const todayEmpty = computed(() => tasksStore.tasksOpen.length + tasksStore.tasksProgress.length + tasksStore.tasksWaiting.length === 0)

const shown = computed(() =>
  planNoteShown.value && isAll.value && todayEmpty.value
  && (props.face === 'column' ? !isPhone.value && !dragState.value.isDragging : isPhone.value))

// Going on to "Heute" answers it: the note exists to tell the user where to go, and they went. A page off the board (Statistik,
// Einstellungen) is not "Heute": the note stays unanswered and is there again on the way back to "Alle"
watch(isAll, (now) => {
  if (!now && planNoteShown.value && boardPlaceOfPath(currentBoardPath.value) === 'today') answerPlanNote()
})

/** The note leaves with its answer: focus goes to the board region instead of falling to <body>. */
async function focusBoard() {
  await nextTick()
  const active = document.activeElement
  if (active && active !== document.body && active.isConnected) return
  focusFirstAvailable([() => document.querySelector<HTMLElement>('[data-task-sheet-return]')])
}

function close() {
  answerPlanNote()
  void focusBoard()
}
</script>
