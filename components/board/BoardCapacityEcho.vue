<!--
@component BoardCapacityEcho
@kind component
@category display
@description The echo of Offen's "Kapazität" line on the place "Alle" (#354, #334 D6): the same wavy line and label with one muted sentence, shown at the foot of Offen while the real line (BoardCapacityDivider) is out of view. A click shows the real line.
@usage Inside BoardCapacityDock only (desktop, the foot of Offen): shown while the day is full and the real line is outside the window.
@avoid Not the line itself (BoardCapacityDivider, in the Offen list) and not an alert or a limit: it informs, nothing is blocked, no numbers of time and no room-left counter. Never on Heute, never over "Meine Aufgaben" and not on a phone (#566).
@responsibility
- Reads the Offen column's own line (`useOpenCapacityLine`), so it follows the topic focus, the sorting and the stacks; it never calculates
- Sentence: "Damit ist dein Tag vermutlich voll." while nothing lies under the line, else how many tasks do
- One button: the label "Kapazität" and the sentence are its name; `show` asks the host to bring the real line into view
- Same tone as the line: `error-700` for the wave and the label only, the sentence muted; a page-coloured backing with a soft upper edge, because it lies over the cards at the column's foot
- Fades in and out (none under reduced motion)
-->
<template>
  <Transition name="capacity-echo">
    <UButton v-if="shown" color="neutral" variant="ghost" class="capacity-echo" data-testid="capacity-echo" @click="emit('show')">
      <span class="capacity-echo__line" aria-hidden="true">
        <svg class="capacity-echo__wave" width="100%" height="8">
          <defs>
            <pattern :id="patternId" width="16" height="8" patternUnits="userSpaceOnUse">
              <path d="M0 4 Q4 0 8 4 T16 4" fill="none" stroke="currentColor" stroke-width="1.5" />
            </pattern>
          </defs>
          <rect width="100%" height="8" :fill="`url(#${patternId})`" />
        </svg>
        <span class="capacity-echo__label">{{ t('board.capacity.label') }}</span>
        <svg class="capacity-echo__wave" width="100%" height="8">
          <rect width="100%" height="8" :fill="`url(#${patternId})`" />
        </svg>
      </span>
      <span class="sr-only">{{ t('board.capacity.label') }}: </span>
      <span class="capacity-echo__text">
        <span class="capacity-echo__sentence">{{ sentence }}</span>
        <UIcon name="i-ph-caret-down" class="capacity-echo__caret" aria-hidden="true" />
      </span>
    </UButton>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useOpenCapacityLine } from '~/composables/useOpenCapacityLine'

defineOptions({ name: 'BoardCapacityEcho' })


const emit = defineEmits<{
  /** The user asks for the real line */
  show: []
}>()

const { t } = useI18n()
const { line } = useOpenCapacityLine()
const patternId = `capacity-echo-wave-${useId()}`

/** Room at the window's foot the sticky footer covers: a line under it does not count as in view */
const FOOT_COVER_PX = 96

const lineInView = ref(true)
function measure() {
  const box = document.querySelector('#column-open [data-testid="capacity-divider"]')?.getBoundingClientRect()
  lineInView.value = !!box && box.top < window.innerHeight - FOOT_COVER_PX && box.bottom > 0
}
let frame = 0
const schedule = () => {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(measure)
}

onMounted(() => {
  // Capture: the list may scroll inside a column page, not only the document
  window.addEventListener('scroll', schedule, { passive: true, capture: true })
  window.addEventListener('resize', schedule, { passive: true })
  measure()
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', schedule, { capture: true })
  window.removeEventListener('resize', schedule)
  cancelAnimationFrame(frame)
})
// The line moved (a card planned, put back or reordered): look again once the list has rendered
watch(() => [line.value.full, line.value.below], schedule, { flush: 'post' })

const shown = computed(() => line.value.full && !lineInView.value)
const sentence = computed(() =>
  line.value.below === 0 ? t('board.notPlanned.capacityFull') : t('board.notPlanned.capacityBelow', { n: line.value.below }, line.value.below),
)
</script>

<style scoped>
.capacity-echo {
  /* A UButton for focus ring and semantics; its box is the line's, not a button's (unlayered, so it beats the theme) */
  display: block;
  height: auto;
  min-height: 0;
  font-weight: inherit;
  width: min(var(--task-card-width, 100%), 100%);
  max-width: var(--task-card-max-width);
  padding: 0.75rem 0 0.25rem;
  /* Page ground with a soft upper edge, so the cards scroll away under the line (unlayered, so on hover too: no button wash) */
  background: linear-gradient(transparent, var(--ui-page-bg) 0.75rem);
  border-radius: var(--radius-md);
  color: var(--ui-color-error-700);
  text-align: left;
  cursor: pointer;
}

.capacity-echo__line {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.capacity-echo__wave {
  flex: 1 1 0;
  min-width: 0;
  height: 0.5rem;
}

.capacity-echo__label {
  flex: none;
  font-size: var(--text-sm);
  font-weight: 600;
  line-height: var(--lh-snug);
  letter-spacing: 0.02em;
}

.capacity-echo__text {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-top: 0.25rem;
  font-size: var(--text-sm);
  line-height: var(--lh-snug);
  color: var(--ui-text-muted);
}

.capacity-echo__sentence {
  flex: 1 1 0;
  min-width: 0;
}

.capacity-echo__caret {
  flex: none;
  width: 1rem;
  height: 1rem;
}

.capacity-echo-enter-active,
.capacity-echo-leave-active {
  transition: opacity var(--duration-base) var(--ease-standard), transform var(--duration-base) var(--ease-standard);
}

.capacity-echo-enter-from,
.capacity-echo-leave-to {
  opacity: 0;
  transform: translateY(0.5rem);
}
</style>
