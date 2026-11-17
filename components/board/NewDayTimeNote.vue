<!--
@component NewDayTimeNote
@kind component
@category feedback
@description The question after a night in which the Jetzt timer ran on while kan-do was not in focus (#356, the user's decision of 2026-11-16: nothing is removed silently; since #387 it comes with the app's start or return, whether or not the user starts the day fresh, and a task that stayed in Jetzt keeps tracking): it says how long the timer ran on after midnight, names the task, and offers "Zeit abziehen" and "Zeit behalten".
@usage <NewDayTimeNote /> above the board in pages/tasks.vue, next to NewDayNote (the two stack when both apply); it shows on Heute and on "Alle". State and both actions live in `useNewDay` (`timeOffer`, `takeOffTime`, `keepTime`).
@avoid Not the notice that offers the fresh start (NewDayNote) and not a blocking dialog: unanswered, the time stays as recorded and the question ends with its day. Never asked for a stretch under a minute.
@responsibility
- Same pattern as NewDayNote (DataStorageNotice): a subtle neutral UAlert, `role="status"`, no call-site `:ui`, two link actions with the notices' 44 px hit area on touch (`kando-notice-actions`), beside the text on desktop and below it on a phone
- The title carries the duration (whole minutes), the task's title is the first line of the description and is masked in feedback screenshots (`data-private`)
- "Zeit abziehen" takes the time off the task and out of the Statistik work sessions once, never below zero; "Zeit behalten" leaves everything as recorded; both end the question and say so in one polite line through the board's live region (`usePlanMoves().announcement`)
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
    icon="i-ph-moon"
    :title="t('board.newDayTimeNote.title', { duration })"
    :actions="actions"
    class="kando-notice-actions"
    data-testid="new-day-time-note"
  >
    <template #description>
      <span class="block truncate font-medium" data-private data-testid="new-day-time-note-task">{{ shown.title }}</span>
      <span class="block">{{ t('board.newDayTimeNote.description') }}</span>
    </template>
  </UAlert>
</template>

<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNewDay } from '~/composables/useNewDay'
import { usePlanMoves } from '~/composables/usePlanMoves'
import { useHeldWhileDragging } from '~/composables/useHeldWhileDragging'
import { useIsPhone } from '~/composables/useIsDesktop'
import { useLocaleFormat } from '~/composables/useLocaleFormat'

defineOptions({ name: 'NewDayTimeNote', inheritAttrs: false })

const { t } = useI18n()
const { timeOffer, takeOffTime, keepTime } = useNewDay()
const { announcement } = usePlanMoves()
const { formatDuration } = useLocaleFormat()
// A phone has no room for the actions beside the text: they go below it
const isPhone = useIsPhone()

// The question leaves by itself when it is answered: never while a card is held in a drag
const shown = useHeldWhileDragging(timeOffer)
// Whole minutes: an offer is at least one
const duration = computed(() => formatDuration(Math.floor((shown.value?.seconds ?? 0) / 60) * 60, 'spaced'))

function takeOff() {
  const removed = takeOffTime()
  if (removed > 0) announcement.value = t('board.newDayTimeNote.tookOff', { duration: formatDuration(Math.floor(removed / 60) * 60, 'spaced') })
  else announcement.value = t('board.newDayTimeNote.kept')
}

function keep() {
  keepTime()
  announcement.value = t('board.newDayTimeNote.kept')
}

const actions = computed<ButtonProps[]>(() => {
  const base = { color: 'neutral' as const, variant: 'link' as const }
  return [
    // Taking time off is the action with a consequence: the forest-green link, as in NewDayNote; keeping stays quiet
    { ...base, color: 'primary' as const, label: t('board.newDayTimeNote.takeOff'), onClick: takeOff, 'data-testid': 'new-day-time-note-take-off' } as ButtonProps,
    { ...base, label: t('board.newDayTimeNote.keep'), onClick: keep, 'data-testid': 'new-day-time-note-keep' } as ButtonProps,
  ]
})
</script>
