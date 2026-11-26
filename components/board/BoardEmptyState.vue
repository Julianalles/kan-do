<!--
@component BoardEmptyState
@kind component
@category feedback
@description The empty state of the board (#853): where a new or cleared board has nothing to show, it says what belongs here and offers the one way to start, a green button that adds the first task. One component for the empty Offen on "Heute" and for "Alle Aufgaben" on a board without any task.
@usage <BoardEmptyState icon="i-ph-sun-horizon-light" :lead="t('board.emptyOpenHint')" :action="t('board.addTask')" @add="…">the muted line (text, or an i18n-t with the link to "Alle")</BoardEmptyState> in BoardColumn (Offen on "Heute", with no task in any column) and BoardNotPlanned ("Alle" with no task on the board). The caller decides when it shows, hides the round add button of its header meanwhile and opens its own add flow on `add`.
@avoid Not for a page or tab panel off the board (EmptyState: left-aligned, no action), not for one sentence inside a section or for a filter without a result (EmptyNote), not for an empty column of a board that has tasks (those stay blank; "Alle Aufgaben" with everything planned keeps its own sentence). Never two on one screen, and never before the board's first load has ended.
@responsibility
- EmptyState's build, centred in its column (the board's columns are centred, a page is not): one Phosphor icon in the light weight at 40 px (`text-dimmed`, decorative), the lead as body text in the ink, one muted line capped at a reading measure, then the button
- The button is the screen's one filled green button while it shows (DESIGN.md "The One Lamp Rule"): `color="primary"`, solid, with the add icon the round add button carries, so that button looks familiar when it returns with the first card
- The line is the default slot, so a caller can put a link into the sentence
- Same sizes at 390 and 1280; on a phone the button keeps the 44 px height of every button
- No state of its own; attributes (testid) land on the root
-->
<template>
  <div class="mx-auto flex w-full max-w-80 flex-col items-center gap-3 pt-2 text-center text-balance">
    <UIcon :name="icon" class="size-10 text-dimmed" aria-hidden="true" />
    <div class="space-y-1">
      <p class="text-default" data-testid="board-empty-lead">{{ lead }}</p>
      <p class="text-body text-muted" data-testid="board-empty-line"><slot /></p>
    </div>
    <UButton color="primary" variant="solid" :icon="appConfig.ui.icons.plus" class="mt-1" data-testid="board-empty-add" @click="emit('add')">
      {{ action }}
    </UButton>
  </div>
</template>

<script setup lang="ts">
import { useAppConfig } from 'nuxt/app'

defineOptions({ name: 'BoardEmptyState' })

defineProps<{
  /** A Phosphor icon in the light weight (`i-ph-*-light`). */
  icon: `i-ph-${string}`
  /** The leading sentence. */
  lead: string
  /** The button's label. */
  action: string
}>()

const emit = defineEmits<{ add: [] }>()
const appConfig = useAppConfig()
</script>
