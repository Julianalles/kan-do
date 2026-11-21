<!--
@component BoardPlanNote
@kind component
@category feedback
@description The one-time note at the top of "Alle Aufgaben" (#711): after the user chose "Tag neu planen" it says what this step is for (pick what is on for today) and when to go to "Heute" (when they want to start). Replaces the green continue button that #454 and #708 removed on purpose; it has no button that moves on.
@usage <BoardPlanNote /> first in the body of BoardNotPlanned, above the draft host and the yesterday panels. It shows only while the user arrived through "Tag neu planen" in this window and has not answered it; whether it shows lives in `useNewDay` (`planNoteShown`, `answerPlanNote`) and the persisted flag `dayRecap.planNoteSeen`.
@avoid Not a notice about the board's state (NewDayNote), not a toast, not a tour step or a tip anchored at another element: it stands where the step happens and goes once. Never for "Alle" opened any other way (pill, deep link, "Überspringen und Board anzeigen").
@responsibility
- One neutral, boxed note like NewDayNote and NewDayTimeNote (a subtle UAlert as the theme draws it, `role="status"`, no call-site `:ui`): title (what the step is), description (when to go to "Heute"), one link action "Schließen" with the notices' 44 px hit area on touch (`kando-notice-actions`), beside the text on desktop and below it on a phone
- Answered by "Schließen" or when the place leaves "Alle" while the note is up (the user went on to "Heute"): both write the persisted flag, so it never returns, also after a restart. Opening a task sheet under `/all/:id` does not leave "Alle". Nothing is written to a connection and no task changes
- Width: hosted in a BoardNotPlannedGroup without label or panel, so it is as wide as the pair of card columns on desktop and the page's width less the cards' inset on a phone; the panels and cards below it move down while it stands (it is one-time)
- Keyboard focus goes to the board region when "Schließen" removes the focused button, never to `<body>`
-->
<template>
  <!-- The group gives the note the measure of the cards below (two columns and their gap on desktop, centred); a phone keeps the cards' inset -->
  <BoardNotPlannedGroup v-if="shown" class="mt-2 mb-4 max-md:px-3" data-testid="plan-note-host">
    <UAlert
      v-bind="$attrs"
      role="status"
      variant="subtle"
      :orientation="isPhone ? 'vertical' : 'horizontal'"
      color="neutral"
      icon="i-ph-list-checks"
      :title="t('board.planNote.title')"
      :description="t('board.planNote.description')"
      :actions="actions"
      class="kando-notice-actions"
      data-testid="plan-note"
    />
  </BoardNotPlannedGroup>
</template>

<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'
import { computed, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BoardNotPlannedGroup from '~/components/board/BoardNotPlannedGroup.vue'
import { useNewDay } from '~/composables/useNewDay'
import { useBoardPlace } from '~/composables/useBoardPlace'
import { useIsPhone } from '~/composables/useIsDesktop'
import { focusFirstAvailable } from '~/utils/focusRecovery'

defineOptions({ name: 'BoardPlanNote', inheritAttrs: false })

const { t } = useI18n()
const { planNoteShown, answerPlanNote } = useNewDay()
const { isAll } = useBoardPlace()
// A phone has no room for the action beside the text: it goes below it
const isPhone = useIsPhone()

const shown = computed(() => planNoteShown.value && isAll.value)

// Going on to "Heute" answers it: the note exists to tell the user where to go, and they went
watch(isAll, (now) => {
  if (!now && planNoteShown.value) answerPlanNote()
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

const actions = computed<ButtonProps[]>(() => [
  { color: 'neutral', variant: 'link', label: t('board.planNote.close'), onClick: close, 'data-testid': 'plan-note-close' } as ButtonProps,
])
</script>
