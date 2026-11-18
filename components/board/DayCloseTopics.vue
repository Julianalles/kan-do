<!--
@component DayCloseTopics
@kind component
@category display
@description The Themen chart of the day-close sheet (#480): today's done tasks by topic as one stacked bar in the ink ramp and a legend (topic mark, name, number of tasks).
@usage <DayCloseTopics :rows="topicRows(done)" /> in DayCloseStage; renders nothing when no done task has a named topic.
@avoid Not the four-week time donut (StatsTimeSplit: time, not count); the folding into "Sonstiges" lives in `topicRows` (`utils/dayClose.ts`), never here.
@responsibility
- Counted by tasks, not time: a task without tracked time still counts, so it matches the progress text
- The legend is the text equivalent (name and count); the bar is `aria-hidden`. A topic's hue stays on its TopicMark, never on the chart
- "Sonstiges" and "Ohne Thema" take the lightest ink step that holds 3:1 on the sheet (18 %); topic names are task text (`data-private`)
-->
<template>
  <section v-if="rows.length > 0" :aria-labelledby="headingId" data-testid="day-close-topics">
    <h4 :id="headingId" class="text-sm font-medium text-highlighted">{{ t('dayClose.topics.heading') }}</h4>
    <div class="mt-3 flex h-3 gap-0.5" aria-hidden="true">
      <span v-for="row in rows" :key="row.key" class="h-full min-w-1 rounded-full" :style="{ flexGrow: row.count, backgroundColor: inkColor(row.step) }" />
    </div>
    <ul class="mt-3 space-y-1.5 text-sm">
      <li v-for="row in rows" :key="row.key" class="flex items-center gap-2 text-default" data-testid="day-close-topic-row">
        <span class="size-3 shrink-0 rounded-full" :style="{ backgroundColor: inkColor(row.step) }" aria-hidden="true" />
        <TopicMark v-if="row.kind === 'topic'" :topic="row.key" />
        <span class="truncate" :data-private="row.kind === 'topic' ? '' : undefined">{{ labelOf(row) }}</span>
        <span class="ml-auto shrink-0 whitespace-nowrap text-muted tabular-nums">{{ t('dayClose.topics.count', { n: row.count }, row.count) }}</span>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { useId } from 'vue'
import { useI18n } from 'vue-i18n'
import TopicMark from '~/components/topic/TopicMark.vue'
import { inkColor } from '~/lib/inkRamp'
import type { TopicRow } from '~/utils/dayClose'

defineOptions({ name: 'DayCloseTopics' })

defineProps<{
  /** The rows from `topicRows(done)`. */
  rows: TopicRow[]
}>()

const { t } = useI18n()
const headingId = useId()

const labelOf = (row: TopicRow): string => {
  if (row.kind === 'other') return t('statistics.split.other')
  if (row.kind === 'none') return t('statistics.noTopic')
  return row.key
}
</script>
