<!--
@component StatsTiles
@kind block
@category display
@description Q2 to Q4 of the Statistik page: three question tiles in a three-column row (one column below `md`; tiles hug their content, top aligned) that open one at a time, plus the full-width work-rhythm tile "Wann arbeite ich?" (#600) under them, which shares the same open state
@usage Under the verdict in pages/statistics.vue
@avoid Only under the verdict on the Statistik page.
@responsibility
- Own the page state `open: 2 | 3 | 4 | 5 | null` (initial value from the `initialOpen` prop, i.e. `?open=`; never written back, never persisted)
- An opened tile holds its detail inside itself (#689, reverses #610 tile b): from `md` the open tile of Q2 to Q4 is first and spans all three columns (CSS `order`, so the DOM order stays 2, 3, 4 and a node never moves away from the toggle that has focus), the other tiles follow in the row below; opening a tile scrolls its toggle into view (`block: 'nearest'`, under the app bar; once more when the glide ends, because the old panel collapses above it) and the root sets `overflow-anchor: none`, so the browser's scroll anchoring does not pull the page back while the tile grows; below `md` it expands in place. From `md` opening, switching and closing glide over `--duration-place` (#789, `useTileGlide`: the change is instant, the boxes travel from their old place; the open tile animates its width under `overflow: hidden` with its summary and detail held at their final width, so no text re-wraps and the collapsible is measured at the width it ends with; the row's height glides so tile 5 and the page follow; `md:auto-rows-max` keeps the rows from being squeezed by that height); reduced motion has none. Each tile's toggle `aria-controls` names its own panel (`UCollapsible` over `--duration-slow`). While Q2 is open its small summary bars are not drawn, the detail shows them large with percent labels above the week table; the rings of Q3 and Q4 stay in the summary, which then puts the line left and the chart right (the open tile spans the row). Tile 5 is full width already, stays last and opens its panel inside itself
- Q2 to Q4 stay hidden on an empty review; tile 5 is always shown (its first-run state explains that recording has started, #600)
- Tile 5 (work rhythm, #600): in its first-run state it has no toggle and no panel
- Pick each tile's one-line answer; Q3 without any timebox is a plain heading with no toggle
- Q4 detail (#537): one muted line for the time the completion records do not hold (tasks still open, tasks deleted before completion); no line when both are 0
- Emit `open-task` when an outlier is chosen
-->
<template>
  <!-- overflow-anchor: the browser would otherwise pull the scroll down as the opened tile grows above the tiles it anchors on, undoing the scroll to the toggle (#689) -->
  <div ref="root" class="[overflow-anchor:none]">
    <div v-if="questionOrder.length" data-stats-grid class="mb-4 grid gap-4 md:mb-6 md:auto-rows-max md:grid-cols-3 md:content-start md:items-start md:gap-6">
      <!-- The open tile is first and spans the row from md, by CSS only: the DOM order stays 2, 3, 4 so a moved node never takes focus from its toggle (#689) -->
      <StatsTile
        v-for="n in questionOrder"
        :key="n"
        :n="n"
        :class="isOpen(n) ? 'md:order-first md:col-span-3' : ''"
        :question="t(`statistics.question.q${n}`)"
        :line="lines[n]"
        :open="isOpen(n)"
        :toggleable="n !== 3 || review.hasTimeboxes"
        @toggle="toggle(n)"
      >
        <!-- The summary chart stays unless the detail repeats it: Q2's bars come back large inside the open tile; Q3's and Q4's rings stay (the detail has none) -->
        <template v-if="n === 2">
          <StatsTrendBars v-if="!isOpen(2)" :weeks="review.weeks" />
        </template>
        <template v-else-if="n === 3">
          <StatsEstimateRing
            v-if="review.hasTimeboxes && review.estimate.n > 0"
            :estimate="review.estimate"
            :size="120"
            stacked
          />
        </template>
        <template v-else>
          <StatsTimeSplit
            v-if="review.split.taskCount > 0"
            :split="review.split"
            :by="by"
            :size="120"
            :legend-count="3"
            stacked
          />
        </template>

        <template #detail>
          <template v-if="n === 2">
            <StatsTrendBars class="mb-6" :weeks="review.weeks" labelled />
            <StatsWeekTable :weeks="review.weeks" />
          </template>
          <div v-else-if="n === 3" class="space-y-8">
            <StatsPatterns :patterns="review.patterns" :empty-text="lines[3]" />
            <StatsOutliers :outliers="review.outliers" @open="(id: string) => emit('open-task', id)" />
          </div>
          <div v-else-if="review.split.taskCount > 0 || unfinishedLine">
            <template v-if="review.split.taskCount > 0">
              <UTabs v-model="by" :items="byItems" :content="false" size="sm" :aria-label="t('statistics.split.by')" />
              <p class="mt-4 text-body text-default">{{ t('statistics.split.caption', { time: formatDuration(review.split.seconds, 'spaced') }) }}</p>
              <p v-if="review.split.unplannedShare !== null" class="mt-1 text-body text-default">
                {{ t('statistics.split.unplanned', { share: Math.round(review.split.unplannedShare) }) }}
              </p>
            </template>
            <p v-if="unfinishedLine" class="text-body text-muted" :class="review.split.taskCount > 0 ? 'mt-1' : ''" data-testid="stats-unfinished">{{ unfinishedLine }}</p>
            <StatsTimeSplit v-if="review.split.taskCount > 0" class="mt-3" :split="review.split" :by="by" mode="rows" />
          </div>
        </template>
      </StatsTile>
    </div>

    <StatsTile
      :n="5"
      :question="t('statistics.question.q5')"
      :line="rhythmLine"
      :open="isOpen(5)"
      :toggleable="rhythmReady"
      wide
      @toggle="toggle(5)"
    >
      <StatsRhythmBars v-if="rhythmReady" :hours="rhythm.hourSeconds" :peak="rhythm.peak" />
      <StatsRhythmBars v-else-if="!rhythmReady" ghost />
      <template v-if="!rhythmReady" #under-line>
        <p class="mt-2 text-sm text-muted tabular-nums" data-testid="stats-rhythm-days">{{ t('statistics.rhythm.days', { n: rhythm.days, min: RHYTHM.minDays }) }}</p>
      </template>

      <template #detail>
        <SectionHeader tag="h3" size="label" class="mb-0">{{ t('statistics.rhythm.heading') }}</SectionHeader>
        <StatsRhythmGrid class="mt-4" :rhythm="rhythm" :weekday-labels="weekdayShort" :longest-name="longestName" />
        <dl class="mt-6 divide-y divide-default border-y border-default text-sm" data-testid="stats-rhythm-rows">
          <div v-if="rhythm.start" class="flex min-h-11 items-center justify-between gap-4 py-2">
            <dt class="text-default">{{ t('statistics.rhythm.rowStart') }}<span v-if="rhythm.start.scope === 'workdays'" class="text-muted"> ({{ t('statistics.rhythm.workdaysOnly') }})</span></dt>
            <dd class="m-0 text-highlighted tabular-nums" data-private>{{ clock(rhythm.start.minutes) }}</dd>
          </div>
          <div v-if="rhythm.end" class="flex min-h-11 items-center justify-between gap-4 py-2">
            <dt class="text-default">{{ t('statistics.rhythm.rowEnd') }}</dt>
            <dd class="m-0 text-highlighted tabular-nums" data-private>{{ clock(rhythm.end.minutes) }}</dd>
          </div>
          <div v-if="longestName" class="flex min-h-11 items-center justify-between gap-4 py-2">
            <dt class="text-default">{{ t('statistics.rhythm.rowLongest') }}</dt>
            <dd class="m-0 text-highlighted" data-private>{{ longestName }}</dd>
          </div>
        </dl>
      </template>
    </StatsTile>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import { useI18n } from 'vue-i18n'
import { useLocaleFormat } from '~/composables/useLocaleFormat'
import { cancelTileGlide, useTileGlide } from '~/composables/useTileGlide'
import { NO_TOPIC, REVIEW, type Review, type UnfinishedTime } from '~/lib/statisticsReview'
import { RHYTHM, type WorkRhythm } from '~/lib/workRhythm'
import StatsTile from '~/components/statistics/StatsTile.vue'
import StatsRhythmBars from '~/components/statistics/StatsRhythmBars.vue'
import StatsRhythmGrid from '~/components/statistics/StatsRhythmGrid.vue'
import StatsEstimateRing from '~/components/statistics/StatsEstimateRing.vue'
import StatsOutliers from '~/components/statistics/StatsOutliers.vue'
import StatsPatterns from '~/components/statistics/StatsPatterns.vue'
import StatsTimeSplit from '~/components/statistics/StatsTimeSplit.vue'
import StatsTrendBars from '~/components/statistics/StatsTrendBars.vue'
import StatsWeekTable from '~/components/statistics/StatsWeekTable.vue'

defineOptions({ name: 'StatsTiles' })

type TileNumber = 2 | 3 | 4 | 5
type QuestionNumber = 2 | 3 | 4

const props = defineProps<{
  review: Review
  /** Time on tasks still open and on tasks deleted before completion (#537); absent = nothing to add. */
  unfinished?: UnfinishedTime
  /** When in the day work happens (#600). */
  rhythm: WorkRhythm
  /** Tile opened on first render (the page reads the deep link `?open=`); never written back. */
  initialOpen?: number | null
}>()
const emit = defineEmits<{ 'open-task': [taskId: string] }>()

const { t, locale } = useI18n()
const { formatDuration } = useLocaleFormat()

const open = ref<TileNumber | null>(props.initialOpen === 2 || props.initialOpen === 3 || props.initialOpen === 4 || props.initialOpen === 5 ? props.initialOpen : null)
const root = ref<HTMLElement | null>(null)
const by = ref<'topic' | 'activity'>('topic')

const rhythmReady = computed(() => props.rhythm.state === 'normal')
const toggleable = (n: TileNumber): boolean => n === 5 ? rhythmReady.value : n !== 3 || props.review.hasTimeboxes
const isOpen = (n: TileNumber): boolean => open.value === n && toggleable(n)

/** Q2 to Q4 are hidden on an empty review (nothing to compare yet). */
const questionOrder = computed<QuestionNumber[]>(() => (props.review.state === 'empty' ? [] : [2, 3, 4]))

const glide = useTileGlide()
onBeforeUnmount(cancelTileGlide)

function toggle(n: TileNumber) {
  const opening = open.value !== n
  // The change is instant and final; from `md` the tiles glide from their old boxes to the new ones (#789), and the toggle is brought back into view when the glide has ended
  void glide.around(root.value, () => { open.value = opening ? n : null }, opening ? () => scrollToggleIntoView(n) : undefined)
  if (opening) keepToggleInView(n)
}

const scrollToggleIntoView = (n: TileNumber) => root.value?.querySelector(`[data-testid="stats-tile-${n}-toggle"]`)?.scrollIntoView({ block: 'nearest' })

/**
 * The opened tile jumps to the first place by CSS order (from `md`) and the old panel collapses above it (below `md`) while the page stays scrolled:
 * bring the toggle (the focused element) back into view, now and once more when the old panel's collapse has ended, since the layout above it is only final then (#689);
 * from `md` the glide's own end scrolls once more (#789). Reduced motion has no glide, the first scroll is enough.
 */
function keepToggleInView(n: TileNumber) {
  const scroll = () => scrollToggleIntoView(n)
  void nextTick(scroll)
  const el = root.value
  if (!el) return
  const done = () => { el.removeEventListener('animationend', onEnd); window.clearTimeout(timer) }
  const onEnd = () => { done(); scroll() }
  const timer = window.setTimeout(done, 1000)
  el.addEventListener('animationend', onEnd)
}

const byItems = computed(() => [
  { label: t('statistics.split.byTopic'), value: 'topic' },
  { label: t('statistics.split.byActivity'), value: 'activity' },
])

const unfinishedLine = computed<string | null>(() => {
  const open = props.unfinished?.openSeconds ?? 0
  const discarded = props.unfinished?.discardedSeconds ?? 0
  const args = { open: formatDuration(open, 'spaced'), deleted: formatDuration(discarded, 'spaced') }
  if (open > 0 && discarded > 0) return t('statistics.split.unfinishedBoth', args)
  if (open > 0) return t('statistics.split.unfinishedOpen', args)
  if (discarded > 0) return t('statistics.split.unfinishedDiscarded', args)
  return null
})

const lines = computed<Record<QuestionNumber, string>>(() => {
  const { trend, hasTimeboxes, patterns, estimate, split } = props.review

  const q2 = trend.direction === 'few'
    ? t('statistics.trend.few')
    : trend.direction === 'flat'
      ? t('statistics.trend.flat')
      : t(`statistics.trend.${trend.direction}`, { early: Math.round(trend.early ?? 0), recent: Math.round(trend.recent ?? 0) })

  const top = patterns[0]
  const q3 = !hasTimeboxes
    ? t('statistics.patterns.noTimebox')
    : top
      ? t(top.deviation > 0 ? 'statistics.patterns.lineLonger' : 'statistics.patterns.lineShorter', { label: patternLabel(top.kind, top.key) })
      : estimate.n < REVIEW.patternMinTasks ? t('statistics.patterns.tooFew') : t('statistics.patterns.none')

  // The largest slice, no-topic included (Decision 6): "Meist in" must not skip tasks without a topic that take most of the time.
  const topSlice = split.byTopic[0]
  const topTopic = topSlice && topSlice.key !== NO_TOPIC ? topSlice : undefined
  const q4 = split.taskCount === 0
    ? t('statistics.split.empty')
    : topTopic
      ? t('statistics.split.lineTopic', { label: topTopic.key, share: Math.round(topTopic.share) })
      : t('statistics.split.lineTime', { time: formatDuration(split.seconds, 'spaced') })

  return { 2: q2, 3: q3, 4: q4 }
})

/** Local clock time of a minute count after midnight (past 24 h wraps to the next morning). */
function clock(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440
  return new Date(2000, 0, 1, Math.floor(wrapped / 60), wrapped % 60).toLocaleTimeString(locale.value, { hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
}

/** 2 Nov 2026 is a Monday. */
const weekdayDate = (weekday: number): Date => new Date(2026, 10, 2 + weekday)
const weekdayShort = computed(() => Array.from({ length: 7 }, (_, weekday) =>
  weekdayDate(weekday).toLocaleDateString(locale.value, { weekday: 'short' }).replace(/\.$/, '')))
const longestName = computed(() => props.rhythm.longestWeekday === null
  ? null
  : weekdayDate(props.rhythm.longestWeekday).toLocaleDateString(locale.value, { weekday: 'long' }))

const rhythmLine = computed<string>(() => {
  const { state, peak, start, outsideShare } = props.rhythm
  if (state === 'thin' || !peak) return t('statistics.rhythm.thin')
  const parts = [t('statistics.rhythm.line', { from: peak.from, to: peak.to, share: peak.share })]
  if (outsideShare >= RHYTHM.outsideNoteShare) parts.push(t('statistics.rhythm.lineOutside', { share: outsideShare, first: RHYTHM.firstHour, last: RHYTHM.firstHour + RHYTHM.hours }))
  if (start) parts.push(t(start.scope === 'workdays' ? 'statistics.rhythm.lineStartWorkdays' : 'statistics.rhythm.lineStart', { time: clock(start.minutes) }))
  return parts.join(' ')
})

function patternLabel(kind: string, key: string): string {
  if (kind === 'size') return t(`statistics.patterns.size.${key}`)
  if (kind === 'time') return t(`statistics.patterns.time.${key}`)
  return key
}
</script>
