<!--
@component NowWindow
@kind block
@category display
@description The floating Now window (#383, #436, #565): a pill of system glass with the Jetzt task's title, its time and the pause and done buttons on one centre line, and a tint behind them that drains to the left with the time left; it floats over every other window, Kan-Do's own included
@usage Only inside the pill window's own route (`pages/overlay.vue`, a second Tauri window); never on the board
@avoid Not a control surface of the board: it shows one task and offers pause/resume, done and "open Kan-Do", nothing else
@responsibility
- The glass is the window's own (`src-tauri/src/overlay.rs`: Liquid Glass on macOS 26 and later, vibrancy before, a capsule, 30 px, as `--now-radius`, clipped by one circular mask on the window's content view); this component draws no glass of its own, only a faint scrim, the tint and the bevel rim, so the pill reads over a plain page (screenshots, the E2E stub; how they sit on the real glass is a manual check)
- Shows the title (cut with an ellipsis, `data-private`) and the time of the Jetzt task: the time left, `+m:ss` over the timebox, or without a timebox the time passed, counting up; title, time and buttons share the pill's middle line
- The tint (`now-fill`) is a countdown behind the content: full at the start, draining to the left with the time left, in the app's colours (primary until 80 % of the timebox is spent, warning above and over it, `lib/nowWindow.ts`), never narrower than a 30 px round cap; a task without a timebox shows plain glass, no tint; the tint is decorative (`aria-hidden`), the sr-only sentence carries the state
- The time is counted from the snapshot by the wall clock (`lib/nowWindow.ts`), so it runs on while the main window is throttled
- Paused (#405: the task sits in Wartet after the pill's pause, Jetzt is empty) fades the tint and sets the time in the regular weight; the button then resumes. No sound
- Pause/resume and done are always visible (no hover reveal: the slide-in cut the check off at the capsule edge), ghost buttons of the ladder's default 32 px with `NowGlyph` (pause.fill, play.fill, checkmark in one weight, #565); the window is not focusable, so a keyboard never reaches it: keyboard users act in the main window (ADR 020, D7)
- A click on the body asks Rust to bring Kan-Do forward; a press that travels 3 px drags the window (`startDragging`): `data-tauri-drag-region` would swallow the click
- Reads no store and calls no data command: it gets props only, emits what the user asked for
- Follows the system's light or dark appearance (`color-scheme: light dark` on the page), because it sits on whatever is behind it; label colours are `CanvasText`, the tint the app's primary and warning steps (the one place colours are not Nuxt UI semantic tokens: they are not themed for dark)
- The window is exactly the pill (340 x 60 pt, no margin): the shadow is the system's, and the bevel rim (light edge top left, dark edge bottom right, a faint inner glow) is drawn inside the box, above the tint, so a half-pixel offset cannot clip it
- Over the timebox the tint is full again and warning-coloured (it has run out, not "nothing left")
- Paused wins over warning for the time (regular weight, muted): a paused task keeps its tint colour, so the urgency stays readable there
- Motion: the tint eases one second per tick (linear) and only on the per-tick shrink, off under `prefers-reduced-motion`
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
      <span
        v-if="view.line !== null"
        class="now-fill"
        :class="{ 'is-gliding': glide }"
        :style="{ width: `${view.line * 100}%` }"
        aria-hidden="true"
        data-testid="now-fill"
      />
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
            :aria-label="view.paused ? t('nowWindow.resume') : t('nowWindow.pause')"
            data-testid="now-pause"
            @click="emit('action', 'toggle-pause')"
          >
            <NowGlyph :kind="view.paused ? 'play' : 'pause'" />
          </UButton>
          <UButton
            class="now-btn"
            color="neutral"
            variant="ghost"
            square
            :aria-label="t('nowWindow.done')"
            data-testid="now-done"
            @click="emit('action', 'done')"
          >
            <NowGlyph kind="check" />
          </UButton>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import NowGlyph from '~/components/overlay/NowGlyph.vue'
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

/** The tint glides only on the per-tick shrink; a new task, a new timebox or the step into the overrun set the width without motion (#436, #565). Decided in the render that changes the width, hence the sync flush. */
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
/* The pill's radius is the glass' (CORNER_RADIUS in overlay.rs): keep both in step (tests/config/overlay-contract.test.ts) */
.now-window {
  --now-radius: 9999px; /* a capsule: 30 px = CORNER_RADIUS in overlay.rs, the fill's round cap is 30 px wide */
  --now-tick: 1s linear; /* a progress line: one second per tick, linear on purpose, off the tokens (#593) */
  width: 340px;
  height: 60px;
  font-family: system-ui, -apple-system, sans-serif;
  /* Label colours of the system appearance (`color-scheme: light dark` on the page): black on light glass, white on dark */
  --now-text: CanvasText;
  --now-text-muted: color-mix(in srgb, CanvasText 68%, transparent);
  --now-accent: var(--ui-color-primary-500);
  --now-fill: color-mix(in srgb, var(--ui-color-primary-500) 40%, transparent);
  --now-fill-warning: color-mix(in srgb, var(--ui-color-warning-500) 46%, transparent);
  /* System colours: Canvas is white on light and black on dark, CanvasText the reverse, so the bevel needs no literal */
  --now-sheen: color-mix(in srgb, Canvas 34%, transparent);
  --now-rim-hi: color-mix(in srgb, Canvas 95%, transparent);
  --now-rim-lo: color-mix(in srgb, CanvasText 30%, transparent);
  --now-glow: color-mix(in srgb, Canvas 12%, transparent);
  --now-rim-edge: color-mix(in srgb, CanvasText 12%, transparent);
}
@media (prefers-color-scheme: dark) {
  .now-window {
    --now-accent: var(--ui-color-primary-400);
    --now-fill: color-mix(in srgb, var(--ui-color-primary-400) 44%, transparent);
    --now-fill-warning: color-mix(in srgb, var(--ui-color-warning-400) 50%, transparent);
    --now-sheen: color-mix(in srgb, CanvasText 20%, transparent);
    --now-rim-hi: color-mix(in srgb, CanvasText 60%, transparent);
    --now-rim-lo: color-mix(in srgb, Canvas 55%, transparent);
    --now-glow: color-mix(in srgb, CanvasText 12%, transparent);
    --now-rim-edge: color-mix(in srgb, Canvas 12%, transparent);
  }
}
.now-pill {
  position: relative;
  display: flex;
  height: 100%;
  align-items: center;
  padding: 0 14px 0 24px;
  overflow: hidden;
  user-select: none;
  color: var(--now-text);
  border-radius: var(--now-radius);
  background: color-mix(in srgb, Canvas 14%, transparent);
}
/* The bevel (#565): light edge top left, dark edge bottom right, a faint inner glow. Its own layer above the tint, inside the box */
.now-pill::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  box-shadow:
    inset 1.5px 1.5px 1px -1px var(--now-rim-hi),
    inset -1.5px -1.5px 1px -1px var(--now-rim-lo),
    inset 0 0 14px var(--now-glow),
    inset 0 0 0 0.5px var(--now-rim-edge);
}
/* The tint: the time left, anchored left and ending in a round cap; the rest is bare glass */
.now-fill {
  position: absolute;
  inset: 0 auto 0 -30px;
  /* The element reaches 30 px under the pill's left edge (padding), so its right end keeps a true 30 px radius at any
     share and the pill's own clip shapes the left end: the visible width is the share, at least a 30 px round cap */
  box-sizing: content-box;
  padding-left: 30px;
  min-width: 30px; /* content box: 30 px plus the padding = a 60 px element, 30 px of it visible */
  border-radius: var(--now-radius);
  background: linear-gradient(180deg, var(--now-sheen), transparent 60%), var(--now-fill);
  box-shadow: inset -1px 0 0 color-mix(in srgb, var(--now-accent) 35%, transparent);
  pointer-events: none;
}
.now-fill.is-gliding { transition: width var(--now-tick); }
.is-warning .now-fill {
  background: linear-gradient(180deg, var(--now-sheen), transparent 60%), var(--now-fill-warning);
  box-shadow: inset -1px 0 0 color-mix(in srgb, var(--ui-color-warning-500) 35%, transparent);
}
/* Paused: tint and time recede in colour and weight (not colour alone, WCAG 1.4.1) */
.is-paused .now-fill { opacity: 0.5; filter: saturate(0.5); }
.is-paused .now-time { color: var(--now-text-muted); font-weight: 400; }

.now-row { position: relative; display: flex; flex: 1; align-items: center; gap: 4px; min-width: 0; }
.now-open { display: flex; min-width: 0; flex: 1; align-items: center; min-height: 32px; gap: 10px; cursor: default; }
.now-title { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; line-height: var(--lh-snug); }
.now-time { flex-shrink: 0; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1; }
.now-actions { display: flex; flex-shrink: 0; align-items: center; gap: 4px; }
/* Ghost buttons in the glass' own label colour; Nuxt UI's neutral tokens are the light theme's */
.now-btn { color: var(--now-text-muted); border-radius: 9999px; }
.now-btn:hover { color: var(--now-text); background-color: color-mix(in srgb, CanvasText 12%, transparent); }
.now-btn:active { background-color: color-mix(in srgb, CanvasText 20%, transparent); }
.is-warning .now-btn { color: var(--now-text); } /* a full amber tint under the glyphs: the muted mix would fall under 3:1 (WCAG 1.4.11) */
.now-btn :deep(.now-glyph) { width: 20px; height: 20px; }
</style>
