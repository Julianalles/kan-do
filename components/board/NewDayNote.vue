<!--
@component NewDayNote
@kind component
@category feedback
@description The notice of a day the user has not started fresh (#387): the board still shows yesterday's plan, because planning was skipped ("Direkt zum Board") or no recap was due. It says so and offers the fresh start with one button, "Tag neu planen", which takes everything unfinished off the board and archives yesterday's done tasks, onto "Meine Aufgaben", and leads to "Alle"; "Schließen" keeps the board as it is.
@usage <NewDayNote /> above the board in pages/tasks.vue, below DataStorageNotice; it shows on Heute and on "Alle". State and both actions live in `useNewDay` (`noticeShown`, `freshStart`, `closeNotice`).
@avoid Not the question about time after midnight (NewDayTimeNote), not the pointer to yesterday's cards in an empty Offen (BoardColumn) and not a toast: it stays until it is answered or its day ends. Never a dialog: the app moves no card by itself, and skipping is the user's choice.
@responsibility
- One neutral, persistent notice like DataStorageNotice and NewDayTimeNote (a subtle UAlert as the theme draws it, `role="status"`, no call-site `:ui`): title (the board's state), description (what "Tag neu planen" does), two link actions with the notices' 44 px hit area on touch (`kando-notice-actions`), beside the text on desktop and below it on a phone
- "Tag neu planen" is the same action as the recap's button of that name: `useNewDay().freshStart()` (once per day) and the archive of the tasks done before today (#462, `useArchiveDoneTasks`), then the move to "Alle" (on "Alle" the place stays); one polite line says how many tasks lie under "Meine Aufgaben" now, through the board's live region (`usePlanMoves().announcement`); keyboard focus goes to the board region, never to `<body>`
- "Schließen" hides the notice for the local day; it is back the next morning while something unfinished is still on the board
- Not shown while the recap is open (its two buttons ask the same question), on a day that was started fresh, or on a day whose board had nothing unfinished; it comes with the day check (app start, return after an absence), never at midnight under the hands of someone working
- Held back while a card is dragged, so the board never shifts under it
-->
<template>
  <UAlert
    v-if="shown"
    v-bind="$attrs"
    role="status"
    variant="subtle"
    :orientation="isPhone ? 'vertical' : 'horizontal'"
    color="neutral"
    icon="i-ph-sun-horizon"
    :title="t('board.newDayNote.title')"
    :description="t('board.newDayNote.description')"
    :actions="actions"
    class="kando-notice-actions"
    data-testid="new-day-note"
  />
</template>

<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'
import { computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { navigateTo } from 'nuxt/app'
import { useNewDay } from '~/composables/useNewDay'
import { useNewDayRecap } from '~/composables/useNewDayRecap'
import { usePlanMoves } from '~/composables/usePlanMoves'
import { useBoardPlace } from '~/composables/useBoardPlace'
import { boardPlaceLocation } from '~/lib/boardPlace'
import { useHeldWhileDragging } from '~/composables/useHeldWhileDragging'
import { useIsPhone } from '~/composables/useIsDesktop'
import { useTasksStore } from '~/store/tasks'
import { useArchiveDoneTasks } from '~/composables/useArchiveDoneTasks'
import { focusFirstAvailable } from '~/utils/focusRecovery'

defineOptions({ name: 'NewDayNote', inheritAttrs: false })

const { t } = useI18n()
const { noticeShown, freshStart, closeNotice } = useNewDay()
const { isOpen: recapOpen } = useNewDayRecap()
const { announcement } = usePlanMoves()
const tasksStore = useTasksStore()
const { archiveTasks } = useArchiveDoneTasks()
const { isAll } = useBoardPlace()
// A phone has no room for the actions beside the text: they go below it
const isPhone = useIsPhone()

// The recap asks the same question with its two buttons: the notice waits until it is left. It also leaves by itself
// (the last unfinished card is done or carried away): never while that card is still held
const shownNow = computed(() => noticeShown.value && !recapOpen.value)
const shown = useHeldWhileDragging(shownNow)

/** The notice leaves with its answer: focus goes to the board region instead of falling to <body>. */
async function focusBoard() {
  await nextTick()
  const active = document.activeElement
  if (active && active !== document.body && active.isConnected) return
  focusFirstAvailable([() => document.querySelector<HTMLElement>('[data-task-sheet-return]')])
}

function start() {
  // Like the recap's button of the same name (#462): what was done before today is archived with the fresh start
  const doneBefore = tasksStore.tasksDonePrevious.map(task => task.id)
  const sent = freshStart()
  if (sent.length > 0) archiveTasks(doneBefore)
  if (sent.length > 0) announcement.value = t('board.newDayNote.started', { n: sent.length }, sent.length)
  // The fresh start leads to "Alle", where the day is planned; there the place stays
  if (!isAll.value) void navigateTo(boardPlaceLocation('all'))
  void focusBoard()
}

function close() {
  closeNotice()
  void focusBoard()
}

const actions = computed<ButtonProps[]>(() => {
  const base = { color: 'neutral' as const, variant: 'link' as const }
  return [
    // The one action with a consequence reads as the link it is (forest green); "Schließen" stays quiet
    { ...base, color: 'primary' as const, label: t('board.newDayNote.start'), onClick: start, 'data-testid': 'new-day-note-start' } as ButtonProps,
    { ...base, label: t('board.newDayNote.close'), onClick: close, 'data-testid': 'new-day-note-close' } as ButtonProps,
  ]
})
</script>
