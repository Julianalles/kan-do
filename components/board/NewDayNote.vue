<!--
@component NewDayNote
@kind component
@category feedback
@description The one-time note of the first morning a new day sent cards back to "Nicht geplant" (#356, the user's decision D2): it says what happened and where the cards are, and offers "Alle wieder einplanen", which puts them all back on today's board this once.
@usage <NewDayNote /> above the board in pages/tasks.vue, below DataStorageNotice; it shows on Heute and on "Alle". State and both actions live in `useNewDay` (`noteShown`, `planAllAgain`, `closeNote`).
@avoid Not the daily pointer to yesterday's cards (the sentence in an empty Offen, BoardColumn) and not a toast: it stays until it is answered or its day ends. Never shown again after the first time.
@responsibility
- One neutral, persistent notice like DataStorageNotice (a subtle UAlert as the theme draws it, `role="status"`, no call-site `:ui`): title (the new rule), description (how many tasks lie where now), two link actions with the notices' 44 px hit area on touch (`kando-notice-actions`), beside the text on desktop and below it on a phone
- "Alle wieder einplanen" plans every task of today's group again at the end of Offen and closes the note; one polite line confirms it through the board's live region (`usePlanMoves().announcement`)
- "Schließen" closes the note and leaves the cards where they are; the note also ends with its day, and when the last task of the group was planned by hand
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
    :description="t('board.newDayNote.description', { n: count }, count)"
    :actions="actions"
    class="kando-notice-actions"
    data-testid="new-day-note"
  />
</template>

<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNewDay } from '~/composables/useNewDay'
import { usePlanMoves } from '~/composables/usePlanMoves'
import { useHeldWhileDragging } from '~/composables/useHeldWhileDragging'
import { useIsPhone } from '~/composables/useIsDesktop'

defineOptions({ name: 'NewDayNote', inheritAttrs: false })

const { t } = useI18n()
const { noteShown, groupIds, planAllAgain, closeNote } = useNewDay()
const { announcement } = usePlanMoves()
// A phone has no room for the actions beside the text: they go below it
const isPhone = useIsPhone()

// The note leaves by itself when the last card of the group is carried to Offen: never while that card is still held
const shownNow = computed(() => (noteShown.value ? true : null))
const shown = useHeldWhileDragging(shownNow)
const count = computed(() => groupIds.value.length)

function planAll() {
  const planned = planAllAgain()
  if (planned.length > 0) announcement.value = t('board.newDayNote.planned', { n: planned.length }, planned.length)
}

const actions = computed<ButtonProps[]>(() => {
  const base = { color: 'neutral' as const, variant: 'link' as const }
  return [
    // The one action with a consequence reads as the link it is (forest green); "Schließen" stays quiet
    { ...base, color: 'primary' as const, label: t('board.newDayNote.planAll'), onClick: planAll, 'data-testid': 'new-day-note-plan-all' } as ButtonProps,
    { ...base, label: t('board.newDayNote.close'), onClick: closeNote, 'data-testid': 'new-day-note-close' } as ButtonProps,
  ]
})
</script>
