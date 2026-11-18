<!--
@component DayCloseSummary
@kind component
@category display
@description Top of the day-close sheet (#237, #480): the progress text ("n von n geplanten Aufgaben erledigt", or "Alle Aufgaben erledigt" with a trophy when nothing is left open), or the one quiet line when nothing was done and nothing is planned.
@usage <DayCloseSummary :done-count="done.length" :open-count="open.length" /> at the top of the sheet in DayCloseStage. Planned = done today + still open (Offen, Jetzt, Wartet).
@avoid Not a chart (DayCloseTimebox, DayCloseTopics, StatsVerdict) and not a list of tasks; the date is the stage's subline, not part of this block.
@responsibility
- Headline from the two counts; nothing done and nothing open: the quiet "nothing done" line only, no numbers
- The trophy is decoration (`aria-hidden`); the text carries the meaning
-->
<template>
  <div>
    <p v-if="isEmpty" class="text-body text-toned" data-testid="day-close-headline">{{ t('dayClose.nothingDone') }}</p>
    <div v-else class="flex items-center gap-2.5">
      <UIcon v-if="allDone" name="i-ph-trophy-fill" class="size-6 shrink-0 text-primary" aria-hidden="true" data-testid="day-close-trophy" />
      <SectionHeader tag="h3" size="headline" data-testid="day-close-headline">{{ headline }}</SectionHeader>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SectionHeader from '~/components/ui/SectionHeader.vue'

defineOptions({ name: 'DayCloseSummary' })

interface Props {
  /** Tasks completed today. */
  doneCount: number
  /** Offen, Jetzt and Wartet tasks: the rest of the plan. */
  openCount: number
}

const props = defineProps<Props>()

const { t } = useI18n()

const planned = computed(() => props.doneCount + props.openCount)
const isEmpty = computed(() => planned.value === 0)
const allDone = computed(() => props.doneCount > 0 && props.openCount === 0)
const headline = computed(() =>
  allDone.value
    ? t('dayClose.allDone')
    : t('dayClose.headline', { done: props.doneCount, planned: planned.value }, planned.value),
)
</script>
