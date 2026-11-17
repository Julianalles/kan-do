<!--
@component NowWindow
@kind block
@category display
@description The floating Now window (#383, #436): a pill of system glass with the Jetzt task's title, its time and a timer line that shrinks with the time left; it floats over every other window, Kan-Do's own included
@usage Only inside the pill window's own route (`pages/overlay.vue`, a second Tauri window); never on the board
@avoid Not a control surface of the board: it shows one task and offers pause/resume, done and "open Kan-Do", nothing else
@responsibility
- The glass is the window's own (`src-tauri/src/overlay.rs`: Liquid Glass on macOS 26 and later, vibrancy before, a capsule, 30 px, as `--now-radius`); this component draws no background of its own, only a hairline and a faint scrim so the pill reads over a plain page (screenshots, the E2E stub; whether they muddy the real glass is a manual check)
- Shows the title (cut with an ellipsis, `data-private`) and the time of the Jetzt task: the time left, `+m:ss` over the timebox, or without a timebox the time passed, counting up
- The timer line below the title and controls is a countdown: full at the start, shrinking with the time left, in the app's colours (primary until 80 % of the timebox is spent, warning above and over it, `lib/nowWindow.ts`); a task without a timebox has no line; the line is decorative (`aria-hidden`), the sr-only sentence carries the state
- The time is counted from the snapshot by the wall clock (`lib/nowWindow.ts`), so it runs on while the main window is throttled
- Paused (#405: the task sits in Wartet after the pill's pause, Jetzt is empty) dims time and line and sets the time in the regular weight; the button then resumes. No sound
- Pause/resume and done are always visible (no hover reveal: the slide-in cut the check off at the capsule edge), Phosphor filled pause/play and bold check in the ladder's default 32 px ghost buttons; the window is not focusable, so a keyboard never reaches it: keyboard users act in the main window (ADR 020, D7)
- A click on the body asks Rust to bring Kan-Do forward; a press that travels 3 px drags the window (`startDragging`): `data-tauri-drag-region` would swallow the click
- Reads no store and calls no data command: it gets props only, emits what the user asked for
- Follows the system's light or dark appearance (`color-scheme: light dark` on the page, label colours from `CanvasText`), because it sits on whatever is behind it; accent colours are the app's primary and warning steps (the one place text colours are not Nuxt UI semantic tokens: they are not themed for dark)
- The window is exactly the pill (340 x 60 pt, no margin): the shadow is the system's
- Over the timebox the line is full again and warning-coloured (it has run out, not "nothing left"); it never shrinks below 6 px before that
- Paused wins over warning for the time (regular weight, muted): a paused task keeps its line colour, so the urgency stays readable there
- Motion: the line eases one second per tick (linear), off under `prefers-reduced-motion`
-->
<template>
  <div class="now-window" data-testid="now-window">
    <div
      v-if="snapshot"
      role="group"
      :aria-label="t('nowWindow.region')"
      class="now-pill"
      :class="{ 'is-warning': view.tone === 'warning', 'is-paused': view.paused }"
      data-testid="now-pill"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
    >
      <div class="now-row">
        <div
          role="button"
          class="now-open"
          :aria-label="t('nowWindow.open')"
          aria-describedby="now-title now-left now-paused"
          data-testid="now-open"
          @click="onOpen"
        >
          <span id="now-title" class="now-title" data-private data-testid="now-title">{{ snapshot.title }}</span>
          <span class="now-time" aria-hidden="true" data-testid="now-time">{{ view.label }}</span>
          <span id="now-left" class="sr-only">{{ left }}</span>
          <span v-if="view.paused" id="now-paused" class="sr-only">{{ t('nowWindow.paused') }}</span>
        </div>
        <span class="now-actions" data-testid="now-actions">
          <UButton
            class="now-btn"
            color="neutral"
            variant="ghost"
            square
            :icon="view.paused ? 'i-ph-play-fill' : 'i-ph-pause-fill'"
            :aria-label="view.paused ? t('nowWindow.resume') : t('nowWindow.pause')"
            data-testid="now-pause"
            @click="emit('action', 'toggle-pause')"
          />
          <UButton
            class="now-btn"
            color="neutral"
            variant="ghost"
            square
            icon="i-ph-check-bold"
            :aria-label="t('nowWindow.done')"
            data-testid="now-done"
            @click="emit('action', 'done')"
          />
        </span>
      </div>
      <div v-if="view.line !== null" class="now-line" aria-hidden="true" data-testid="now-line">
        <span class="now-line__fill" :class="{ 'is-gliding': glide }" :style="{ width: `${view.line * 100}%` }" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { lineAnimates, lineFrame, nowView, type LineFrame, type NowSnapshot, type OverlayAction } from '~/lib/nowWindow'

defineOptions({ name: 'NowWindow' })

interface Props {
  /** The Jetzt task, or none (nothing is drawn; Rust hides the window anyway) */
  snapshot: NowSnapshot | null
}
const props = defineProps<Props>()
const emit = defineEmits<{ action: [kind: OverlayAction] }>()

const { t } = useI18n()

/** A press that travels this far is a drag, not a click */
const DRAG_THRESHOLD_PX = 3

const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null
onMounted(() => { ticker = setInterval(() => { now.value = Date.now() }, 1000) })
onBeforeUnmount(() => { if (ticker) clearInterval(ticker) })

const shown = computed<NowSnapshot>(() => props.snapshot ?? { taskId: '', title: '', timeBoxSeconds: null, spentSeconds: 0, at: now.value, running: false, locale: 'de' })
const view = computed(() => nowView(shown.value, now.value))

/** The line glides only on the per-tick shrink; a new task, a new timebox or the step into the overrun set the width without motion (#436). Decided in the render that changes the width, hence the sync flush. */
const glide = ref(false)
let lastFrame: LineFrame | null = null
watch(view, (next) => {
  const frame = lineFrame(shown.value, next)
  glide.value = lineAnimates(lastFrame, frame)
  lastFrame = frame
}, { immediate: true, flush: 'sync' })

/** The time as a sentence for assistive technology: left, over the timebox, or (no timebox) passed */
const left = computed(() => {
  if (view.value.mode === 'over') return t('nowWindow.over', { time: view.value.label.slice(1) })
  return t(view.value.mode === 'left' ? 'nowWindow.left' : 'nowWindow.elapsed', { time: view.value.label })
})

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
/* The pill's radius is the glass' (CORNER_RADIUS in overlay.rs): keep both in step */
.now-window {
  --now-radius: 9999px; /* a capsule, 30 px = CORNER_RADIUS in overlay.rs */
  --now-tick: 1s linear;
  width: 340px;
  height: 60px;
  font-family: system-ui, -apple-system, sans-serif;
  /* Label colours of the system appearance (`color-scheme: light dark` on the page): black on light glass, white on dark */
  --now-text: CanvasText;
  --now-text-muted: color-mix(in srgb, CanvasText 68%, transparent);
  --now-track: color-mix(in srgb, CanvasText 16%, transparent);
  --now-accent: var(--ui-color-primary-500);
  --now-time-warning: var(--ui-color-warning-700);
  --now-line-warning: var(--ui-color-warning-500);
}
@media (prefers-color-scheme: dark) {
  .now-window { --now-accent: var(--ui-color-primary-400); --now-time-warning: var(--ui-color-warning-300); --now-line-warning: var(--ui-color-warning-400); }
}
.now-pill {
  display: flex;
  height: 100%;
  flex-direction: column;
  justify-content: center;
  gap: 7px;
  padding: 0 14px 0 24px;
  user-select: none;
  color: var(--now-text);
  border-radius: var(--now-radius);
  background: color-mix(in srgb, Canvas 14%, transparent);
  box-shadow: inset 0 0 0 0.5px color-mix(in srgb, CanvasText 14%, transparent);
}
.now-row { display: flex; align-items: center; gap: 4px; min-width: 0; }
.now-open { display: flex; min-width: 0; flex: 1; align-items: center; min-height: 32px; gap: 10px; cursor: default; }
.now-title { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; line-height: 1; }
.now-time { flex-shrink: 0; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
.now-actions { display: flex; flex-shrink: 0; align-items: center; gap: 4px; }
/* Ghost buttons in the glass' own label colour; Nuxt UI's neutral tokens are the light theme's */
.now-btn { color: var(--now-text-muted); border-radius: 9999px; }
.now-btn:hover { color: var(--now-text); background-color: color-mix(in srgb, CanvasText 12%, transparent); }
.now-btn:active { background-color: color-mix(in srgb, CanvasText 20%, transparent); }

.now-line { height: 4px; overflow: hidden; border-radius: 9999px; background: var(--now-track); margin-right: 4px; }
.now-line__fill {
  display: block;
  height: 100%;
  min-width: 6px; /* the last seconds stay visible */
  border-radius: 9999px;
  background: var(--now-accent);
}
.now-line__fill.is-gliding { transition: width var(--now-tick); }
.is-warning .now-line__fill { background: var(--now-line-warning); }
.is-warning .now-time { color: var(--now-time-warning); }
/* Paused: time and line recede in colour and weight (not colour alone, WCAG 1.4.1) */
.is-paused .now-time { color: var(--now-text-muted); font-weight: 400; }
.is-paused .now-line__fill { opacity: 0.45; }
@media (prefers-reduced-motion: reduce) {
  .now-line__fill.is-gliding { transition: none; }
}
</style>
