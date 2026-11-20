<!--
@component BoardFocusBar
@kind compound
@category layout
@description The two things the topic focus shows on the board (#161): the chip row to pick a topic (each with its card count) and, while a focus is on, the pill "Thema: <topic>, n ausgeblendet" with its ✕. Never both at once, and nothing at rest.
@usage `<BoardFocusBar />` once in Board.vue, before the columns (desktop), and `<BoardFocusBar phone />` at the head of the active page of the phone board (#608); it reads `useBoardFocus` and is opened by BoardFocusTrigger.
@avoid Not a filter toolbar: one property (topic), one row, shown only on demand. The pill is a status, not a control bar; its ✕ is the only control.
@responsibility
- Desktop: a centred row at the top of the board in the flow; its height grows 0 → full over `--duration-base` (200 ms, rule 82: the columns move with it, no one-frame jump; reduced motion: instant) and back when the row or pill goes
- Phone (#608, rule 85: only the app bar is fixed over a list): the bar is the first item of the active page's scroll container (`phone`), so it scrolls away with the list; nothing floats over the cards. Every page carries a bar (only the `active` one is exposed, the rest are inert and aria-hidden), so a page change mounts nothing mid-slide and the lists never jump; a bar opening on a scrolled page scrolls the list back to the top
- The chip row scrolls sideways when the topics do not fit; a chip is a ChoiceChip, the topic shortened in the middle (MiddleEllipsis); Esc closes it (focus stays on the funnel, BoardFocusTrigger)
- The pill is a polite status region, so the hidden number is read out when it changes; ✕ is named "Thema beenden"
- Task text (the topic name) is private: `data-private`
-->
<template>
  <div
    v-if="mounted"
    :id="active ? 'board-focus-bar' : undefined"
    ref="rootEl"
    class="board-focus-bar"
    :class="{ 'is-open': grown, 'is-phone': phone }"
    :data-testid="active ? 'focus-bar' : undefined"
    :inert="active ? undefined : true"
    :aria-hidden="active ? undefined : 'true'"
  ><div class="board-focus-bar__inner"><div class="board-focus-bar__body">
    <div
      v-if="kind === 'row'"
      class="board-focus-bar__row"
      role="group"
      :aria-label="t('board.focus.chips')"
      :data-testid="active ? 'focus-chips' : undefined"
      @keydown.esc="closeChips"
    >
      <ChoiceChip
        v-for="choice in shownChoices"
        :key="choice.topic"
        :aria-label="t('board.focus.chip', { topic: choice.topic, n: choice.count }, choice.count)"
        :data-testid="active ? 'focus-chip' : undefined"
        @click="setFocus(choice.topic)"
      >
        <MiddleEllipsis :text="choice.topic" data-private />
        <span class="board-focus-bar__count" aria-hidden="true">{{ choice.count }}</span>
      </ChoiceChip>
    </div>
    <div v-else-if="kind === 'pill'" class="board-focus-bar__pill" :data-testid="active ? 'focus-pill' : undefined">
      <p class="board-focus-bar__text" role="status" aria-live="polite" :data-testid="active ? 'focus-pill-text' : undefined">
        {{ t('board.focus.pillLead') }} <span class="board-focus-bar__topic" data-private>{{ shownTopic }}</span>, {{ t('board.focus.hidden', { n: shownHidden }) }}
      </p>
      <UTooltip :text="t('board.focus.end')" :disabled="isPhone">
        <UButton
          icon="i-ph-x-bold"
          color="neutral"
          variant="ghost"
          class="board-focus-bar__end"
          data-round="sm"
          data-fill="none"
          :aria-label="t('board.focus.end')"
          :data-testid="active ? 'focus-end' : undefined"
          @click="clearFocus"
        />
      </UTooltip>
    </div>
  </div></div></div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIsPhone } from '~/composables/useIsDesktop'
import ChoiceChip from '~/components/ui/ChoiceChip.vue'
import MiddleEllipsis from '~/components/ui/MiddleEllipsis.vue'
import { useBoardFocus } from '~/composables/useBoardFocus'

defineOptions({ name: 'BoardFocusBar' })

/** Mirrors `--duration-base` (DESIGN.md "Motion") */
const BAR_MS = 200

/**
 * Phone: rendered inside the page's scroll container, in the flow (#608). Every page carries a bar so a page change mounts
 * nothing mid-slide (rule 82); only the `active` page's is exposed (ids, test ids, a11y tree), the others are inert and hidden.
 */
const props = withDefaults(defineProps<{ phone?: boolean, active?: boolean }>(), { active: true })
const rootEl = ref<HTMLElement | null>(null)

const { t } = useI18n()
const isPhone = useIsPhone()
const { focusTopic, topicChoices, hiddenCount, chipsOpen, setFocus, clearFocus, closeChips } = useBoardFocus()

const showsRow = computed(() => chipsOpen.value && focusTopic.value === null && topicChoices.value.length > 0)
const showsPill = computed(() => focusTopic.value !== null)

/**
 * The height grows in the flow (#608): `mounted` is the element, `grown` its open state. Opening mounts it closed and grows it
 * on the next frame; closing shrinks it and unmounts after the transition. A bar that is open when it mounts (the phone's page
 * changed) starts grown, so nothing animates. Reduced motion (the global rule zeroes the transition) unmounts at once.
 */
const wanted = computed(() => showsRow.value || showsPill.value)
/** What the bar shows, kept while it shrinks away: its content must not vanish before the height has gone (#608) */
const kind = ref<'row' | 'pill'>(showsPill.value ? 'pill' : 'row')
const shownChoices = ref(topicChoices.value)
const shownTopic = ref(focusTopic.value)
const shownHidden = ref(hiddenCount.value)
watchEffect(() => {
  if (!wanted.value) return
  kind.value = showsPill.value ? 'pill' : 'row'
  shownChoices.value = topicChoices.value
  shownTopic.value = focusTopic.value
  shownHidden.value = hiddenCount.value
})
const mounted = ref(wanted.value)
const grown = ref(wanted.value)
let hideTimer: ReturnType<typeof setTimeout> | undefined
watch(wanted, async (open) => {
  clearTimeout(hideTimer)
  if (open) {
    mounted.value = true
    await nextTick()
    // Force a frame at height 0 before growing: the browser needs the closed style once
    if (import.meta.client) void rootEl.value?.offsetHeight
    grown.value = true
    revealOnPhone()
    return
  }
  grown.value = false
  const still = import.meta.client && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  hideTimer = setTimeout(() => { mounted.value = false }, still ? 0 : BAR_MS)
})
/** Phone: a bar that opens above the fold of a scrolled page is brought into view, else the tap seems to do nothing (#608) */
function revealOnPhone() {
  if (!props.phone || !props.active || !import.meta.client) return
  let node = rootEl.value?.parentElement ?? null
  while (node && node !== document.body) {
    const oy = getComputedStyle(node).overflowY
    if ((oy === 'auto' || oy === 'scroll') && node.scrollTop > 0) {
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      node.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' })
      return
    }
    node = node.parentElement
  }
}
onBeforeUnmount(() => clearTimeout(hideTimer))
</script>

<style scoped>
/* The bar grows in the flow (#608): 0fr -> 1fr over the neighbours' 200 ms, so the columns move with it */
.board-focus-bar {
  display: grid;
  grid-template-rows: 0fr;
  min-width: 0;
  transition: grid-template-rows var(--duration-base) var(--ease-standard);
}

.board-focus-bar.is-open {
  grid-template-rows: 1fr;
}

.board-focus-bar__inner {
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

/* The bar's own space (0.5rem above, 0.25rem below) sits inside the clipped box, so it grows and shrinks with the height */
.board-focus-bar__body {
  display: flex;
  justify-content: center;
  padding: 0.5rem 1rem 0.25rem;
}

.board-focus-bar__row {
  display: flex;
  gap: 0.375rem;
  max-width: 100%;
  /* Many topics: the row scrolls sideways */
  overflow-x: auto;
  scrollbar-width: none;
  padding: 0.125rem;
}

.board-focus-bar__row::-webkit-scrollbar {
  display: none;
}

.board-focus-bar__count {
  color: var(--ui-text-muted);
  font-variant-numeric: tabular-nums;
}

/* The pill: the answer chip's primary wash, so it reads as the state of the control that made it */
.board-focus-bar__pill {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  max-width: 100%;
  height: var(--field-h);
  /* The same block height as the chip row (its 0.125rem padding), so swapping the row for the pill does not move the board */
  margin-block: 0.125rem;
  padding: 0 0.25rem 0 0.75rem;
  border-radius: 9999px;
  background: var(--primary-wash);
  color: var(--ui-primary);
  font-size: var(--text-sm);
  line-height: var(--lh-snug);
}

.board-focus-bar__text {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.board-focus-bar__topic {
  font-weight: 500;
}

/* The round look is the button theme's `data-round="sm"` with `data-fill="none"` (#602) */

/* Phone (#608): the first item of the page's list, in the flow like the cards (the page's own gutter is the inset) */
.board-focus-bar.is-phone .board-focus-bar__body {
  padding-inline: 0.75rem;
}
</style>
