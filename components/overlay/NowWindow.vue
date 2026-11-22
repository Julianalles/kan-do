<!--
@component NowWindow
@kind block
@category display
@description The floating Now window (#383, #436, #565): a pill of system glass with the Jetzt task's title, its time and the pause and done buttons on one centre line, and coloured light in the glass behind them that drains to the left with the time left, ending in a straight, soft edge that breathes while the task runs; it floats over every other window, Kan-do's own included
@usage Only inside the pill window's own route (`pages/overlay.vue`, a second Tauri window); never on the board
@avoid Not a control surface of the board: it shows one task and offers pause/resume, done and "open Kan-do", nothing else
@responsibility
- The glass is the window's own (`src-tauri/src/overlay.rs`: Liquid Glass on macOS 26 and later, vibrancy before, a capsule, 21 px (half the height), as `--now-radius`, clipped by one circular mask on the window's content view); this component draws no glass of its own, only a faint scrim, the light and the bevel rim, so the pill reads over a plain page (screenshots, the E2E stub; how they sit on the real glass is a manual check)
- Shows the title (cut with an ellipsis, `data-private`) and the time of the Jetzt task: the time left, `+m:ss` over the timebox, or without a timebox the time passed, counting up; title, time and buttons share the pill's middle line
- The light (`now-fill`, #703) is a countdown behind the content, not a filling: a full-width layer in the pill that is moved left by `transform` (`--now-share`, 0 to 1, the time left), full at the start, in the app's colours (primary until 80 % of the timebox is spent, warning above and over it, `lib/nowWindow.ts`); its right end is a straight edge with a soft falloff (a mask), never a round cap, also when the light is narrower than the corner radius (the pill clips the left end); a task without a timebox shows plain glass, no light; the light is decorative (`aria-hidden`), the sr-only sentence carries the state
- The band at the edge (`now-edge`) breathes while the task runs: opacity and a 4 px shift on a 4.8 s loop, nothing else moves per frame (compositor only). It is the window's own look (glass over unknown content); the in-app timebox bar (#704) stays a flat fill with a straight edge and shares the edge position, the colours and the warning threshold
- The time is counted from the snapshot by the wall clock (`lib/nowWindow.ts`), so it runs on while the main window is throttled
- Paused (#405: the task sits in Wartet after the pill's pause, Jetzt is empty) dims the light, stops the band and sets the time in the regular weight; the button then resumes. No sound
- Pause/resume and done are always visible (no hover reveal: the slide-in cut the check off at the capsule edge), ghost buttons of 28 px (the window is 42 pt high; the ladder's 32 px do not fit) with `NowGlyph` (pause.fill, play.fill, checkmark in one weight, #565); the window is not focusable, so a keyboard never reaches it: keyboard users act in the main window (ADR 020, D7)
- A click on the body asks Rust to bring Kan-do forward; a press that travels 3 px drags the window (`startDragging`): `data-tauri-drag-region` would swallow the click
- Reads no store and calls no data command: it gets props only, emits what the user asked for
- Follows the system's light or dark appearance (`color-scheme: light dark` on the page), because it sits on whatever is behind it; label colours are `CanvasText`, the light the app's primary and warning steps (the one place colours are not Nuxt UI semantic tokens: they are not themed for dark)
- The window is exactly the pill (280 x 42 pt, no margin): the shadow is the system's, and the bevel rim (light edge top left, dark edge bottom right, a faint inner glow) is drawn inside the box, above the light, so a half-pixel offset cannot clip it
- Over the timebox the light is full again and warning-coloured (it has run out, not "nothing left")
- Paused dims the light and sets the time in regular weight and the muted colour (weight too, not colour alone); the warning tone never recolours the time, which keeps the label colour, so a paused task keeps its light colour
- Motion: the light eases one second per tick (linear) and only on the per-tick shrink; the band breathes on a loop and stops while paused; with no task Rust sends the empty snapshot before it hides the window, so the pill (and its band) unmounts, and `visibilitychange` holds it as a second guard; under `prefers-reduced-motion` the animation is off (also when paused or hidden), the band rests at mid brightness and the position follows the time by tick
-->
<template>
  <div class="now-window" data-testid="now-window">
    <div
      v-if="snapshot"
      role="group"
      :aria-label="t('nowWindow.region')"
      class="now-pill"
      :class="{ 'is-warning': view.tone === 'warning', 'is-paused': view.paused, 'is-hidden': hidden }"
      data-testid="now-pill"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
    >
      <span
        v-if="view.line !== null"
        class="now-fill"
        :class="{ 'is-gliding': glide }"
        :style="{ '--now-share': view.line }"
        aria-hidden="true"
        data-testid="now-fill"
      >
        <span class="now-body" />
        <span class="now-edge" />
      </span>
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
/** Belt and braces: the band holds while the document is hidden. It does not rely on this: Rust tells the pill when no task is shown (`overlay::apply` emits the empty snapshot before it hides the window), `v-if="snapshot"` then unmounts the band, so nothing animates in a hidden window even if WKWebView never fires `visibilitychange` (unverified, #703). The 1 s ticker runs on, one cheap ref write a second. */
const hidden = ref(false)
function onVisibility(): void { hidden.value = document.visibilityState === 'hidden' }
onMounted(() => {
  ticker = setInterval(() => { now.value = Date.now() }, 1000)
  onVisibility()
  document.addEventListener('visibilitychange', onVisibility)
})
onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
  document.removeEventListener('visibilitychange', onVisibility)
})

const shown = computed<NowSnapshot>(() => props.snapshot ?? { taskId: '', title: '', timeBoxSeconds: null, spentSeconds: 0, at: now.value, running: false, locale: 'de' })
const view = computed(() => nowView(shown.value, now.value))

/** The light glides only on the per-tick shrink; a new task, a new timebox or the step into the overrun set the position without motion (#436, #565). Decided in the render that changes the width, hence the sync flush. */
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
  --now-radius: 9999px; /* a capsule: 21 px = CORNER_RADIUS in overlay.rs */
  --now-tick: 1s linear; /* a progress line: one second per tick, linear on purpose, off the tokens (#593) */
  --now-fall: 22px; /* the soft falloff at the light's straight edge */
  width: 280px;
  height: 42px;
  font-family: system-ui, -apple-system, sans-serif;
  /* Label colours of the system appearance (`color-scheme: light dark` on the page): black on light glass, white on dark */
  --now-text: CanvasText;
  --now-text-muted: color-mix(in srgb, CanvasText 68%, transparent);
  /* The light: the app's primary step, warning above 80 %; the band is the same hue one step lighter */
  --now-light: var(--ui-color-primary-500);
  --now-light-hi: var(--ui-color-primary-300);
  --now-a0: 42%; /* the light's strength at its left end, at the edge, and of the band: white labels on dark glass need less (#703 contrast) */
  --now-a1: 70%;
  --now-ab: 70%;
  /* System colours: Canvas is white on light and black on dark, CanvasText the reverse, so the bevel needs no literal */
  --now-rim-hi: color-mix(in srgb, Canvas 95%, transparent);
  --now-rim-lo: color-mix(in srgb, CanvasText 30%, transparent);
  --now-glow: color-mix(in srgb, Canvas 12%, transparent);
  --now-rim-edge: color-mix(in srgb, CanvasText 12%, transparent);
}
@media (prefers-color-scheme: dark) {
  .now-window {
    --now-light: var(--ui-color-primary-400);
    --now-light-hi: var(--ui-color-primary-200);
    --now-a0: 24%;
    --now-a1: 34%;
    --now-ab: 26%;
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
  padding: 0 8px 0 16px;
  overflow: hidden;
  user-select: none;
  color: var(--now-text);
  border-radius: var(--now-radius);
  background: color-mix(in srgb, Canvas 14%, transparent);
}
.now-pill.is-warning { --now-light: var(--ui-color-warning-500); --now-light-hi: var(--ui-color-warning-300); }
@media (prefers-color-scheme: dark) {
  .now-pill.is-warning { --now-light: var(--ui-color-warning-400); --now-light-hi: var(--ui-color-warning-200); }
}
/* The bevel (#565): light edge top left, dark edge bottom right, a faint inner glow. Its own layer above the light, inside the box */
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
/* The light (#703): a layer as wide as the pill, slid left by the time that is gone. Only `transform` moves (compositor);
   the mask gives its right end a falloff, so the end is a straight, soft edge at any share, and the pill's own clip shapes
   the left end (a narrow share is a blob at the left cap, never a round cap of its own). */
.now-fill {
  position: absolute;
  inset: 0;
  transform: translateX(calc((var(--now-share) - 1) * 100%));
  will-change: transform;
  pointer-events: none;
  -webkit-mask-image: linear-gradient(90deg, CanvasText calc(100% - var(--now-fall)), transparent 100%);
  mask-image: linear-gradient(90deg, CanvasText calc(100% - var(--now-fall)), transparent 100%);
}
.now-fill.is-gliding { transition: transform var(--now-tick); }
.now-body,
.now-edge { position: absolute; }
/* Light in the glass: stronger towards the edge, faded at the top and bottom (body and band alike) so it never reads as a bar */
.now-body,
.now-edge {
  -webkit-mask-image: linear-gradient(180deg, transparent 0%, CanvasText 35%, CanvasText 70%, transparent 100%);
  mask-image: linear-gradient(180deg, transparent 0%, CanvasText 35%, CanvasText 70%, transparent 100%);
}
.now-body {
  inset: 0;
  background: linear-gradient(90deg, color-mix(in srgb, var(--now-light) var(--now-a0), transparent), color-mix(in srgb, var(--now-light) var(--now-a1), transparent));
}
/* The band at the edge breathes (opacity and a 4 px shift, 4.8 s). At rest (reduced motion ends the animation) it stays at mid brightness */
.now-edge {
  inset: 0 0 0 auto;
  width: 40px;
  opacity: 0.7;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--now-light-hi) var(--now-ab), transparent) 70%, transparent);
  animation: now-breathe 4.8s ease-in-out infinite;
}
@keyframes now-breathe {
  0%, 100% { opacity: 0.35; transform: translateX(0); }
  50% { opacity: 1; transform: translateX(-4px); }
}
/* Paused: the light dims and the band holds still; the time recedes in weight (not colour alone, WCAG 1.4.1). Hidden: the band holds too */
.is-paused .now-fill { opacity: 0.5; filter: saturate(0.5); }
.is-paused .now-edge,
.is-hidden .now-edge { animation-play-state: paused; }
/* Reduced motion ends the animation outright: a paused or hidden pill would otherwise sit at keyframe 0 (0.35) instead of the mid brightness at rest (0.7) */
@media (prefers-reduced-motion: reduce) { .now-edge { animation: none; } }
.is-paused .now-time { color: var(--now-text-muted); font-weight: 400; }

.now-row { position: relative; display: flex; flex: 1; align-items: center; gap: 2px; min-width: 0; }
.now-open { display: flex; min-width: 0; flex: 1; align-items: center; min-height: 28px; gap: 8px; cursor: default; }
.now-title { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; line-height: var(--lh-snug); }
.now-time { flex-shrink: 0; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1; }
.now-actions { display: flex; flex-shrink: 0; align-items: center; gap: 2px; }
/* Ghost buttons in the glass' own label colour; Nuxt UI's neutral tokens are the light theme's. 28 px: the window is 42 pt high */
.now-btn { width: 28px; min-width: 28px; height: 28px; min-height: 28px; padding: 0; justify-content: center; color: var(--now-text-muted); border-radius: 9999px; }
.now-btn:hover { color: var(--now-text); background-color: color-mix(in srgb, CanvasText 12%, transparent); }
.now-btn:active { background-color: color-mix(in srgb, CanvasText 20%, transparent); }
.is-warning .now-btn { color: var(--now-text); } /* a warning light under the glyphs: the muted mix would fall under 3:1 (WCAG 1.4.11) */
.now-btn :deep(.now-glyph) { width: 18px; height: 18px; }
</style>
