<!--
@component NowWindow
@kind block
@category display
@description The floating Now window (#383): a capsule with the Jetzt task's progress ring, title and remaining time that floats over other apps while Kan-Do is not in front
@usage Only inside the pill window's own route (`pages/overlay.vue`, a second Tauri window); never on the board
@avoid Not a control surface of the board: it shows one task and offers pause/resume, done and "open Kan-Do", nothing else
@responsibility
- Shows the ring, the title (cut with an ellipsis, `data-private`) and the remaining time of the Jetzt task; a task without a timebox shows the title only
- The time is counted from the snapshot by the wall clock (`lib/nowWindow.ts`), so it runs on while the main window is throttled
- The last minute turns ring and time amber, over the timebox they stay amber and read `+m:ss`; paused dims the time and sets it in the regular weight. No sound, no animation of the ring
- Hover (or assistive-technology focus) slides in pause/resume and done; the window is not focusable, so a keyboard never reaches it: keyboard users act in the main window (ADR 020, D7)
- A click on the body asks Rust to bring Kan-Do forward; a press that travels 3 px drags the window (`startDragging`): `data-tauri-drag-region` would swallow the click
- Reads no store and calls no data command: it gets props only, emits what the user asked for
- Capsule 300×40 inside a window of 324×64: the transparent margin is where the CSS shadow lives (the window has none); `shadow-md` stays inside the 12 px margin, a larger one would be cut at the window edge
- Motion is CSS only and off under `prefers-reduced-motion`; the amber time uses the 700 step, the ring the 600 step (4.5:1 text, 3:1 graphic on the surface)
-->
<template>
  <div class="now-window flex h-16 w-81 items-center justify-center p-3" data-testid="now-window">
    <div
      v-if="snapshot"
      role="group"
      :aria-label="t('nowWindow.region')"
      class="now-pill group flex h-10 w-75 select-none items-center rounded-full border border-default bg-default pl-2.5 pr-1.5 shadow-md"
      :class="{ 'is-warning': view.tone === 'warning', 'is-paused': view.paused }"
      data-testid="now-pill"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
    >
      <div
        role="button"
        class="flex min-w-0 flex-1 cursor-default items-center gap-2.5 rounded-full"
        :aria-label="t('nowWindow.open')"
        aria-describedby="now-title now-left now-paused"
        data-testid="now-open"
        @click="onOpen"
      >
        <svg v-if="view.ring !== null" class="now-ring size-6 shrink-0" viewBox="0 0 24 24" aria-hidden="true" data-testid="now-ring">
          <circle class="now-ring__track" cx="12" cy="12" r="9" />
          <circle class="now-ring__fill" cx="12" cy="12" r="9" :style="{ strokeDashoffset: RING_LENGTH * (1 - view.ring) }" />
        </svg>
        <span id="now-title" class="min-w-0 flex-1 truncate text-sm font-medium text-default" data-private data-testid="now-title">{{ snapshot.title }}</span>
        <template v-if="view.label !== null">
          <span class="now-time shrink-0 text-sm font-semibold tabular-nums" aria-hidden="true" data-testid="now-time">{{ view.label }}</span>
          <span id="now-left" class="sr-only">{{ view.over ? t('nowWindow.over', { time: view.label.slice(1) }) : t('nowWindow.left', { time: view.label }) }}</span>
        </template>
        <span v-if="view.paused" id="now-paused" class="sr-only">{{ t('nowWindow.paused') }}</span>
      </div>
      <span class="now-actions flex shrink-0 items-center gap-0.5 overflow-hidden" data-testid="now-actions">
        <UButton
          color="neutral"
          variant="ghost"
          :icon="view.paused ? 'i-ph-play' : 'i-ph-pause'"
          :aria-label="view.paused ? t('nowWindow.resume') : t('nowWindow.pause')"
          data-testid="now-pause"
          @click="emit('action', 'toggle-pause')"
        />
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-ph-check"
          :aria-label="t('nowWindow.done')"
          data-testid="now-done"
          @click="emit('action', 'done')"
        />
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { nowView, type NowSnapshot, type OverlayAction } from '~/lib/nowWindow'

defineOptions({ name: 'NowWindow' })

interface Props {
  /** The Jetzt task, or none (nothing is drawn; Rust hides the window anyway) */
  snapshot: NowSnapshot | null
}
const props = defineProps<Props>()
const emit = defineEmits<{ action: [kind: OverlayAction] }>()

const { t } = useI18n()

/** Circumference of the ring (r = 9) */
const RING_LENGTH = 56.55
/** A press that travels this far is a drag, not a click */
const DRAG_THRESHOLD_PX = 3

const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null
onMounted(() => { ticker = setInterval(() => { now.value = Date.now() }, 1000) })
onBeforeUnmount(() => { if (ticker) clearInterval(ticker) })

const view = computed(() => nowView(props.snapshot ?? { taskId: '', title: '', timeBoxSeconds: null, spentSeconds: 0, at: now.value, running: false, locale: 'de' }, now.value))

let pressStart: { x: number; y: number } | null = null
let dragged = false

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || (event.target as Element).closest('button')) return
  pressStart = { x: event.clientX, y: event.clientY }
  dragged = false
}

function onPointerMove(event: PointerEvent): void {
  if (!pressStart || dragged || (event.buttons & 1) === 0) return
  if (Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) < DRAG_THRESHOLD_PX) return
  dragged = true
  pressStart = null
  void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().startDragging())
}

function onOpen(): void {
  if (dragged) {
    dragged = false
    return
  }
  emit('action', 'open')
}
</script>

<style scoped>
.now-ring__track { fill: none; stroke: var(--ui-border-accented); stroke-width: 3; }
.now-ring__fill {
  fill: none;
  stroke: var(--ui-primary);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-dasharray: 56.55;
  transform: rotate(-90deg);
  transform-origin: 12px 12px;
}
.is-warning .now-ring__fill { stroke: var(--ui-color-warning-600); }
.is-warning .now-time { color: var(--ui-color-warning-700); }
/* Paused: the time recedes in colour and weight (not colour alone, WCAG 1.4.1); the ring keeps its colour so the state it stopped in stays readable */
.is-paused .now-time { color: var(--ui-text-muted); font-weight: 400; }

.now-actions { width: 0; opacity: 0; transition: width var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard); }
.now-pill:hover .now-actions,
.now-pill:focus-within .now-actions { width: 4.5rem; opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .now-actions { transition: none; }
}
</style>
