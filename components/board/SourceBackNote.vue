<!--
@component SourceBackNote
@kind component
@category feedback
@description The one-time note of the sync that took a connection's cards out of Offen (#357, the user's decision of 2026-11-16: every Todoist task starts under "Nicht geplant"): it says what happened and where the cards are, and offers "Alle wieder einplanen", which puts exactly those cards back at the end of Offen in their old order.
@usage <SourceBackNote /> above the board in pages/tasks.vue, with NewDayNote (the notes stack when several apply); it shows on Heute and on "Alle". State: `boardStore.sourceBackNotes`, written once per connection by `useIntegrationManager` from the merge's result.
@avoid Not the new day's note (NewDayNote: that one is about yesterday's cards and ends with its day) and not a toast: it stays until it is answered. Never for a task a connection delivers for the first time, and never a second time for the same connection.
@responsibility
- Same pattern as NewDayNote (DataStorageNotice): a subtle neutral UAlert, `role="status"`, no call-site `:ui`, two link actions with the notices' 44 px hit area on touch (`kando-notice-actions`), beside the text on desktop and below it on a phone
- Shows the first unanswered note that still has a card under "Nicht geplant"; the count is the cards still there
- "Alle wieder einplanen" plans those cards through `useTaskSync.planTasks` and closes the note; one polite line confirms it through the board's live region (`usePlanMoves().announcement`)
- "Schließen" closes the note and leaves the cards where they are; the note also ends when its last card was planned by hand or is gone
- Does nothing while the desktop data status blocks writes (ADR 011); held back while a card is dragged, so the board never shifts under it
-->
<template>
  <UAlert
    v-if="shown"
    v-bind="$attrs"
    role="status"
    variant="subtle"
    :orientation="isPhone ? 'vertical' : 'horizontal'"
    color="neutral"
    icon="i-ph-tray-arrow-down"
    :title="t('board.sourceBackNote.title', { source: sourceName })"
    :description="t('board.sourceBackNote.description', { n: count, source: sourceName }, count)"
    :actions="actions"
    class="kando-notice-actions"
    data-testid="source-back-note"
  />
</template>

<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBoardStore } from '~/store/board'
import { useTasksStore } from '~/store/tasks'
import { useTaskSync } from '~/composables/useTaskSync'
import { usePlanMoves } from '~/composables/usePlanMoves'
import { useHeldWhileDragging } from '~/composables/useHeldWhileDragging'
import { useIsPhone } from '~/composables/useIsDesktop'
import { dataState } from '~/lib/dataStorage'
import { isNotPlanned } from '~/lib/taskPlanning'
import type { SourceId } from '~/types/taskSource'

defineOptions({ name: 'SourceBackNote', inheritAttrs: false })

const { t } = useI18n()
const boardStore = useBoardStore()
const tasksStore = useTasksStore()
const { planTasks } = useTaskSync()
const { announcement } = usePlanMoves()
// A phone has no room for the actions beside the text: they go below it
const isPhone = useIsPhone()

/** Desktop only: nothing is written while the data file is in conflict or unavailable. */
const writesBlocked = () => dataState.available && dataState.status !== 'ok'

/** The first unanswered note with a card that is still not planned, in the cards' old Offen order. */
const open = computed<{ source: SourceId; ids: string[] } | null>(() => {
  const held = new Set(tasksStore.tasks.filter(task => isNotPlanned(task)).map(task => task.id))
  for (const [source, note] of Object.entries(boardStore.sourceBackNotes)) {
    if (note.closed) continue
    const ids = note.ids.filter(id => held.has(id))
    if (ids.length > 0) return { source: source as SourceId, ids }
  }
  return null
})

// The note leaves by itself when its last card is carried to Offen: never while that card is still held
const shownNow = computed(() => (open.value ? true : null))
const shown = useHeldWhileDragging(shownNow)
const count = computed(() => open.value?.ids.length ?? 0)
const sourceName = computed(() => (open.value ? t(`source.name.${open.value.source}`) : ''))

function planAll() {
  const note = open.value
  if (!note || writesBlocked()) return
  const planned = planTasks(note.ids)
  boardStore.closeSourceBackNote(note.source)
  if (planned.length > 0) announcement.value = t('board.newDayNote.planned', { n: planned.length }, planned.length)
}

function close() {
  const note = open.value
  if (!note || writesBlocked()) return
  boardStore.closeSourceBackNote(note.source)
}

const actions = computed<ButtonProps[]>(() => {
  const base = { color: 'neutral' as const, variant: 'link' as const }
  return [
    // The one action with a consequence reads as the link it is (forest green); "Schließen" stays quiet
    { ...base, color: 'primary' as const, label: t('board.newDayNote.planAll'), onClick: planAll, 'data-testid': 'source-back-note-plan-all' } as ButtonProps,
    { ...base, label: t('board.newDayNote.close'), onClick: close, 'data-testid': 'source-back-note-close' } as ButtonProps,
  ]
})
</script>
