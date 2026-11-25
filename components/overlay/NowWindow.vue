<!--
@component NowWindow
@kind block
@category display
@description The floating Now window (#383, #436, #565): a pill of system glass with the Jetzt task's title, its time and the pause and done buttons on one centre line, and coloured light in the glass behind them that drains to the left with the time left and fades out in a long, soft end with a bloom, a glint crossing it now and then while the task runs; it floats over every other window, Kan-do's own included
@usage Only inside the pill window's own route (`pages/overlay.vue`, a second Tauri window); never on the board
@avoid Not a control surface of the board: it shows one task and offers pause/resume, done and "open Kan-do", nothing else
@responsibility
- The glass is the window's own (`src-tauri/src/overlay.rs`: Liquid Glass on macOS 26 and later, vibrancy before, a capsule, 21 px (half the height), as `--now-radius`, clipped by one circular mask on the window's content view); this component draws no glass of its own, only a faint scrim, the light, its tint and the bevel rim, so the pill reads over a plain page (screenshots, the E2E stub; how they sit on the real glass is a manual check)
- Shows the title (cut with an ellipsis, `data-private`) and the time of the Jetzt task: the time left, `+m:ss` over the timebox, or without a timebox the time passed, counting up; title, time and buttons share the pill's middle line
- The light (`now-fill`, #703, #812) is a countdown behind the content, not a filling: a layer in the pill that is moved left by `transform` (`--now-share`, 0 to 1, the time left), full at the start, in the app's colours (primary until 80 % of the timebox is spent, warning above and over it, `lib/nowWindow.ts`). It is light in glass (#812, user, 2026-11-25): weak behind the text, gathered in a blurred line at the lower rim (`now-rim`) and in a bloom at its end (`now-head`), and the whole pill takes a 5 % tint of it (`now-tint`) with a top highlight and a coloured lower rim in the bevel. The end is a 92 px eased falloff that lightens as it thins, part of the gradient itself: the layer is wider than the pill by the falloff and carries no mask (a mask on the moving layer showed a hard cut in the desktop webview), a full light still reaches the right cap, and half of the falloff stays in the pill when the time is up; the pill clips the left end. A task without a timebox shows plain glass: no light, no tint; the light is decorative (`aria-hidden`), the sr-only sentence carries the state
- The glint (`now-glint`, #812) is the pill's one loop, a recorded exception to "motion never loops" that replaces the pulsing band of #703: every 9 s an oval highlight in the light's own colour starts at the soft end, travels about 3.4 s back toward the light's start (the way scales with `--now-share`, so a short light has a short way) and dissolves; only `transform` and `opacity` animate (compositor only). It is the window's own look (glass over unknown content); the in-app timebox bar (#704) stays a flat fill with a straight edge and shares the colours and the warning threshold
- The time is counted from the snapshot by the wall clock (`lib/nowWindow.ts`), so it runs on while the main window is throttled
- Paused (#405: the task sits in Wartet after the pill's pause, Jetzt is empty) dims the light, rests the glint and sets the time in the regular weight; the button then resumes. No sound
- Pause/resume and done are always visible (no hover reveal: the slide-in cut the check off at the capsule edge), ghost buttons of 28 px (the window is 42 pt high; the ladder's 32 px do not fit) with `NowGlyph` (pause.fill, play.fill, checkmark in one weight, #565); the window is not focusable, so a keyboard never reaches it: keyboard users act in the main window (ADR 020, D7)
- A click on the body asks Rust to bring Kan-do forward; a press that travels 3 px drags the window (`startDragging`): `data-tauri-drag-region` would swallow the click
- Reads no store and calls no data command: it gets props only, emits what the user asked for
- Follows the system's light or dark appearance (`color-scheme: light dark` on the page), because it sits on whatever is behind it; label colours are `CanvasText`, the light the app's primary and warning steps (the one place colours are not Nuxt UI semantic tokens: they are not themed for dark)
- The window is exactly the pill (280 x 42 pt, no margin): the shadow is the system's, and the bevel rim (light edge top left, dark edge bottom right, a faint inner glow) is drawn inside the box, above the light, so a half-pixel offset cannot clip it
- Over the timebox the light is full again and warning-coloured (it has run out, not "nothing left")
- Paused dims the light and sets the time in regular weight and the muted colour (weight too, not colour alone); the warning tone never recolours the time, which keeps the label colour, so a paused task keeps its light colour
- Motion: the light eases one second per tick (linear) and only on the per-tick shrink; the glint travels only while the task runs; paused or under `prefers-reduced-motion` it has no animation and rests as a faint fixed highlight in the middle of the light, and nothing else moves (the position follows the time by tick); with no task Rust sends the empty snapshot before it hides the window, so the pill (and its glint) unmounts, and `visibilitychange` holds it as a second guard
-->
<template>
  <div class="now-window" data-testid="now-window">
    <div
      v-if="snapshot"
      role="group"
      :aria-label="t('nowWindow.region')"
      class="now-pill"
      :class="{ 'is-warning': view.tone === 'warning', 'is-paused': view.paused, 'is-hidden': hidden, 'has-light': view.line !== null }"
      data-testid="now-pill"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
    >
      <span v-if="view.line !== null" class="now-tint" aria-hidden="true" />
      <span
        v-if="view.line !== null"
        class="now-fill"
        :class="{ 'is-gliding': glide }"
        :style="{ '--now-share': view.line }"
        aria-hidden="true"
        data-testid="now-fill"
      >
        <span class="now-body" />
        <span class="now-head" />
        <span class="now-rim" />
        <span class="now-glint" data-testid="now-glint" />
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
/** Belt and braces: the glint holds while the document is hidden. It does not rely on this: Rust tells the pill when no task is shown (`overlay::apply` emits the empty snapshot before it hides the window), `v-if="snapshot"` then unmounts the glint, so nothing animates in a hidden window even if WKWebView never fires `visibilitychange` (unverified, #703). The 1 s ticker runs on, one cheap ref write a second. */
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
  --now-w: 280px; /* the pill's width again, for the light's way */
  --now-fall: 92px; /* the eased falloff at the light's end (#812) */
  width: 280px;
  height: 42px;
  font-family: system-ui, -apple-system, sans-serif;
  /* Label colours of the system appearance (`color-scheme: light dark` on the page): black on light glass, white on dark */
  --now-text: CanvasText;
  --now-text-muted: color-mix(in srgb, CanvasText 68%, transparent);
  /* The light: the app's primary step, warning above 80 %; its thin end, bloom and glint are the same hue one step lighter */
  --now-light: var(--ui-color-primary-500);
  --now-light-hi: var(--ui-color-primary-300);
  /* The light's strength behind the text: at its left end, where the falloff starts, and at two stops inside the falloff.
     Plain numbers, no calc() in color-mix. White labels on dark glass need less (#703 contrast) */
  --now-b0: 21%;
  --now-b1: 30%;
  --now-b2: 25%;
  --now-b3: 10%;
  --now-bloom: 0.8; /* the bloom at the light's end */
  --now-rim-light: 45%; /* the light gathered in the bevel's lower rim */
  --now-glint: 92%; /* the glint, and its small bright core */
  --now-shine: 45%;
  --now-core: Canvas; /* the glint's bright core: white on light glass; never Canvas on dark, where it is black */
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
    --now-b0: 12%;
    --now-b1: 18%;
    --now-b2: 12%;
    --now-b3: 5%;
    --now-bloom: 0.3;
    --now-glint: 20%;
    --now-shine: 6%;
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
  /* On the pill, not the window: the pill is where the warning tone re-sets --now-light-hi, and a var() resolves where it is declared.
     A white core would sit under white labels (3.4:1): the light's own lighter step */
  .now-pill { --now-core: var(--now-light-hi); }
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
/* Light in the glass (#812): with a light, the bevel gets a highlight along the top and the light's colour in the lower rim */
.now-pill.has-light::after {
  box-shadow:
    inset 0 1.5px 1px -0.5px var(--now-rim-hi),
    inset 1.5px 1.5px 1px -1px var(--now-rim-hi),
    inset -1.5px -1.5px 1px -1px var(--now-rim-lo),
    inset 0 -6px 10px -6px color-mix(in srgb, var(--now-light) var(--now-rim-light), transparent),
    inset 0 0 14px var(--now-glow),
    inset 0 0 0 0.5px var(--now-rim-edge);
}
/* The glass takes a breath of the light's colour */
.now-tint { position: absolute; inset: 0; pointer-events: none; background: color-mix(in srgb, var(--now-light) 5%, transparent); }
/* The light (#703, #812): a layer wider than the pill by the falloff, slid left by the time that is gone. Only `transform`
   moves (compositor). The falloff is in the gradient, not a mask on the moving layer, so a full light still reaches the right
   cap; half of the falloff stays in the pill when the time is up. The pill's own clip shapes the left end. */
.now-fill {
  position: absolute;
  inset: 0 calc(-1 * var(--now-fall)) 0 0;
  transform: translateX(calc((var(--now-share) - 1) * (var(--now-w) + var(--now-fall) * 0.5)));
  will-change: transform;
  pointer-events: none;
}
.now-fill.is-gliding { transition: transform var(--now-tick); }
.now-body,
.now-head,
.now-rim,
.now-glint { position: absolute; }
/* Weak behind the text; the end is eased with middle stops and lightens as it thins */
.now-body {
  inset: 0;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--now-light) var(--now-b0), transparent) 0,
    color-mix(in srgb, var(--now-light) var(--now-b1), transparent) calc(100% - var(--now-fall)),
    color-mix(in srgb, var(--now-light-hi) var(--now-b2), transparent) calc(100% - var(--now-fall) * 0.62),
    color-mix(in srgb, var(--now-light-hi) var(--now-b3), transparent) calc(100% - var(--now-fall) * 0.28),
    transparent 100%
  );
}
/* The bloom where the light ends */
.now-head {
  top: -20%;
  bottom: -40%;
  right: calc(var(--now-fall) * 0.42);
  width: 120px;
  opacity: var(--now-bloom);
  background: radial-gradient(50% 50% at 50% 62%, color-mix(in srgb, var(--now-light-hi) 85%, transparent), color-mix(in srgb, var(--now-light-hi) 18%, transparent) 55%, transparent);
}
/* The light gathers in a line at the lower rim (a static blur, painted once) */
.now-rim {
  left: 0;
  right: calc(var(--now-fall) * 0.45);
  bottom: -1px;
  height: 5px;
  filter: blur(2.5px);
  background: linear-gradient(90deg, color-mix(in srgb, var(--now-light) 70%, transparent), color-mix(in srgb, var(--now-light) 95%, transparent) 60%, color-mix(in srgb, var(--now-light-hi) 60%, transparent) 86%, transparent);
}
/* The glint: an oval of the light's own colour with a small bright core (no mask, never a gap). It starts in the soft end
   and travels back toward the light's start, 3.4 s of a 9 s loop, then rests unseen. The way follows the share. */
.now-glint {
  --now-glint-way: calc(-1 * var(--now-share) * var(--now-w) - 24px);
  top: 0;
  bottom: 0;
  right: calc(var(--now-fall) * 0.3);
  width: 84px;
  opacity: 0;
  background:
    radial-gradient(22% 30% at 50% 50%, color-mix(in srgb, var(--now-core) var(--now-shine), transparent), transparent),
    radial-gradient(50% 46% at 50% 52%, color-mix(in srgb, var(--now-light-hi) var(--now-glint), transparent), transparent);
  animation: now-glint 9s cubic-bezier(0.45, 0, 0.3, 1) infinite;
  will-change: transform, opacity;
}
@keyframes now-glint {
  0% { transform: translateX(0); opacity: 0; }
  6% { opacity: 1; }
  30% { opacity: 0.9; }
  38% { transform: translateX(var(--now-glint-way)); opacity: 0; }
  100% { transform: translateX(var(--now-glint-way)); opacity: 0; }
}
/* Paused: the light and its tint dim, and the glint rests as a faint fixed highlight in the middle of the light; the time
   recedes in weight (not colour alone, WCAG 1.4.1). Reduced motion rests the glint the same way. Hidden: it holds */
.is-paused .now-fill,
.is-paused .now-tint { opacity: 0.5; filter: saturate(0.8); }
.is-paused { --now-rim-light: 22%; }
.is-paused .now-glint { animation: none; opacity: 0.4; transform: translateX(calc(var(--now-glint-way) * 0.5)); }
.is-hidden .now-glint { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) {
  .now-glint { animation: none; opacity: 0.4; transform: translateX(calc(var(--now-glint-way) * 0.5)); }
}
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
