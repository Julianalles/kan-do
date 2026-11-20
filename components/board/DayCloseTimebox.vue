<!--
@component DayCloseTimebox
@kind component
@category display
@description The Timebox chart of the day-close sheet (#480): how many of today's done tasks with a timebox and tracked time ran longer than planned, as planned and shorter than planned, three equal cells with the count, the label and one dot per task, and a caption naming the base. Same words, order and ink as the Statistik ring (#604).
@usage <DayCloseTimebox :groups="timeBoxGroups(done)" /> in DayCloseStage; renders nothing without a base (no done task has a timebox and tracked time).
@avoid Not the four-week estimate ring (StatsEstimateRing) and not a per-task row; the thresholds live in `utils/dayClose.ts` (the larger of 5 minutes and 20 % of the box), never here.
@responsibility
- Three cells in one `<ul>` in the order of `ESTIMATE_GROUPS` (longer, as planned, shorter; test ids keep the group keys over, within, under): the visible count and label are the text equivalent, the dots are `aria-hidden` and wrap inside their cell
- Ink ramp only (DESIGN.md "Charts"), the step of each group from `ESTIMATE_GROUPS` as in `StatsEstimateRing`; no red, no green (PRODUCT: the app does not judge)
- The words are the `statistics.estimate.*` keys, shared with the ring
- The caption names the base ("Basis: n erledigte Aufgaben mit Timebox und erfasster Zeit.")
-->
<template>
  <section v-if="groups.total > 0" :aria-labelledby="headingId" data-testid="day-close-timebox">
    <h4 :id="headingId" class="text-sm font-medium text-highlighted">{{ t('dayClose.timebox.heading') }}</h4>
    <ul class="mt-3 grid grid-cols-3 divide-x divide-default border-y border-default">
      <li v-for="cell in cells" :key="cell.key" class="flex min-w-0 flex-col items-center px-2 py-3 text-center" :data-testid="`day-close-timebox-${cell.key}`">
        <span class="text-3xl font-semibold text-highlighted tabular-nums">{{ cell.count }}</span>
        <span class="mt-1 text-xs text-toned">{{ t(`statistics.estimate.${cell.label}`) }}</span>
        <span class="mt-3 flex min-h-5 flex-wrap justify-center gap-1" aria-hidden="true">
          <span v-for="n in cell.count" :key="n" class="size-2 rounded-full" :style="{ backgroundColor: cell.color }" />
        </span>
      </li>
    </ul>
    <p class="mt-2 text-xs text-muted">{{ t('dayClose.timebox.caption', { n: groups.total }, groups.total) }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { ESTIMATE_GROUPS, inkColor } from '~/lib/inkRamp'
import type { TimeBoxGroups } from '~/utils/dayClose'

defineOptions({ name: 'DayCloseTimebox' })

const props = defineProps<{
  /** The counts from `timeBoxGroups(done)`. */
  groups: TimeBoxGroups
}>()

const { t } = useI18n()
const headingId = useId()

const cells = computed(() => ESTIMATE_GROUPS.map(g => ({
  key: g.group,
  label: g.key,
  count: props.groups[g.group],
  color: inkColor(g.step),
})))
</script>
