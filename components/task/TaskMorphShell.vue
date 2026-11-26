<!--
@component TaskMorphShell
@kind block
@category overlay
@description The desktop shell of the task sheet (#468, #870): a sheet of one fixed, card-shaped frame that grows out of the card the user opened, the card's face scaling along with it, and folds back into it on close
@usage Rendered by TaskSheet on the detail route (/tasks/:id, /statistics/:id) at 768 px and up, with the route's task id as `originId`. The add route and the phone drawer stay on ResponsiveOverlay.
@avoid Not a generic dialog; other overlays use ResponsiveOverlay or AppDialog. It hosts the task detail only: the layout inside is TaskDetailContent's.
@responsibility
- Dialog behaviour from reka's DialogRoot/DialogContent: focus trap and return, Escape, an outside press; the dismiss hooks come in through `contentProps` (TaskSheet owns them) and every close is requested through `update:open`
- Placement (`utils/sheetPlacement.ts`): 720 px wide (the window minus 32 px when narrower), centred on the origin card's centre, 16 px from the left, right and bottom window edge and below the app bar (#518: its top is at least the bottom of `[data-app-nav]`, 56 px, measured at each placement, so the centred group of wordmark, pill and ⋯ stays whole above the sheet at every card; no bar on the page, 16 px); one fixed frame (#870, user, 2026-11-26: only a fixed frame gives a controlled height; it brings back the frame of #705 in the card's shape and reverses the content height and the guided growth of #846): its height follows the width and the window, never the content (`sheetHeight`: 56 % of the width, 403 px at 720, at most the window height minus that top minus 16 px), so every task and every tab opens the same shape; the open tab scrolls inside (TaskDetailContent), and a long note, many extra properties or an open topic editor never change the sheet's size or place. Placement is on whole pixels. The shell keeps it inside the window when the window shrinks
- Open (one phase of 340 ms, ease-out `cubic-bezier(0.2, 0, 0, 1)`, #705): the panel's box and corner radius run from the card's (16 px) to the sheet's (32 px, twice the card's, `--task-sheet-radius`); a copy of the card's face scales up with the card (uniformly, from the panel's top-left corner, by the sheet's width over the card's, on the panel's own easing, so it always spans the panel's width and its items travel with it) and dissolves into the content (#847: gone by 35 % on the standard curve, not linear) while the content fades in from 10 % to 50 % on the open curve; the scrim fades in over 160 ms. The grow is the Web Animations API on left/top/width/height, the content keeps its final size meanwhile so it does not reflow (`flex: none`: its `flex-1` basis of 0 would otherwise beat the set height and the last line would follow the panel's height, #659)
- Close (260 ms, `cubic-bezier(0.4, 0, 0.2, 1)`): the same phase reversed: the sheet folds into the card where it sits now (a status change may have moved it), the content fades out first, the face scales back down to the card's size and fades in, the scrim fades out
- No origin card (a statistics row, a deep link, a card scrolled out of the window or gone): centred, a 160 ms scale-in from 97 % with a fade; it leaves with a 140 ms fade
- Direct link (#594): a sheet that is open from the first route of the session (`arrivedFromAnotherPage()` is false) stands at its place at once, no grow, no fade, no scrim fade; "never runs on page load" (DESIGN.md Motion)
- Reduced motion (read when the sheet opens and closes): no grow, no fold and no scaling, a 1 ms fade, same place as without it
- The panel is `bg-elevated` with the overlay shadow, as every sheet; the scrim is today's `--overlay-scrim` over the whole window (#419), the other cards fade through sheet.css as today
- Close button: first in the tab order inside the sheet (kd#201), aria label `common.close`; the title is the next stop (TaskDetailContent)
- Provides the desktop variant to the hosted content (`OVERLAY_DESKTOP_KEY`), so the nested topic editor and the detail's layout follow the sheet and not the live window width (#199)
-->

<template>
  <DialogRoot :open="shown" @update:open="onUpdateOpen">
    <DialogPortal>
      <DialogOverlay ref="scrimRef" data-slot="overlay" class="fixed inset-0 z-(--z-overlay) bg-(--overlay-scrim)" />
      <DialogContent
        ref="panelRef"
        class="task-morph-panel fixed z-(--z-overlay) flex flex-col overflow-hidden rounded-(--task-sheet-radius) bg-elevated shadow-(--shadow-overlay) outline-none"
        :aria-describedby="undefined"
        v-bind="contentProps"
      >
        <DialogTitle class="sr-only">{{ title }}</DialogTitle>
        <div ref="faceRef" class="pointer-events-none absolute inset-s-0 top-0 z-10 overflow-hidden rounded-(--task-card-radius) opacity-0 empty:hidden" aria-hidden="true" inert />
        <div ref="innerRef" class="relative flex min-h-0 flex-1 flex-col">
          <UButton
            class="absolute inset-e-4 top-4 z-10"
            color="neutral"
            variant="ghost"
            square
            :icon="ICONS.close"
            :aria-label="t('common.close')"
            @click="emit('update:open', false)"
          />
          <slot name="body" :is-desktop="true" />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, provide, readonly, ref, watch } from 'vue';
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { useI18n } from 'vue-i18n';
import { ICONS } from '~/lib/icons';
import { OVERLAY_DESKTOP_KEY } from '~/composables/useIsDesktop';
import { arrivedFromAnotherPage } from '~/lib/routeArrival';
import { isUsableOrigin, keepInside, placeSheet, SHEET_MOTION, sheetHeight, sheetMaxHeight, sheetWidth, type SheetBox } from '~/utils/sheetPlacement';

defineOptions({ name: 'TaskMorphShell' });

interface Props {
  /** Whether the sheet is open (driven by the route in the host). */
  open: boolean;
  /** Dialog title, screen-reader only: the body holds the editable title. */
  title: string;
  /** Task whose card the sheet grows from and folds back into; none = centred (statistics rows, deep links). */
  originId?: string | null;
  /** Dismiss hooks of the dialog content (`onEscapeKeyDown`, `onCloseAutoFocus`, ...), owned by TaskSheet. */
  contentProps?: Record<string, unknown>;
}

const props = withDefaults(defineProps<Props>(), { originId: null, contentProps: () => ({}) });

const emit = defineEmits<{
  'update:open': [value: boolean];
  'after-leave': [];
}>();

defineSlots<{ body(props: { isDesktop: boolean }): unknown }>();

const { t } = useI18n();

// The content lays itself out for the sheet and not for a pinned side sheet; the nested topic editor reads it too
provide(OVERLAY_DESKTOP_KEY, readonly(ref(true)));

/** The dialog is mounted from the open request until the fold has finished. */
const shown = ref(false);
const panelRef = ref<{ $el: HTMLElement } | null>(null);
const scrimRef = ref<{ $el: HTMLElement } | null>(null);
const faceRef = ref<HTMLElement | null>(null);
const innerRef = ref<HTMLElement | null>(null);

/** The content's `flex-1` has a basis of 0, which beats its `height`: the content would take the panel's height frame by frame (#659). `none` holds the size the content was given. */
const HELD_SIZE = 'none';

let running: Animation[] = [];
/** Bumped by every open and close request, so a run that was overtaken stops touching the panel. */
let generation = 0;
let animating = false;
let resizeObserver: ResizeObserver | undefined;

/** The panel element; while the dialog is closed the component's root is a comment node, not an element. */
const panel = (): HTMLElement | null => (panelRef.value?.$el instanceof HTMLElement ? panelRef.value.$el : null);
const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/**
 * Where the sheet may start: below the app bar row, which the sheet never covers (#518).
 * Only a bar in the top half counts: below 768 px the phone nav is fixed at the bottom, and the sheet stays open while the window narrows.
 */
const barInset = (height: number): number => {
  const rect = document.querySelector('[data-app-nav]')?.getBoundingClientRect();
  return rect && rect.top < height / 2 ? rect.bottom : 0;
};
/** The window, plus the top inset; no bar at the top of the page, no inset. */
const viewport = () => ({ width: window.innerWidth, height: window.innerHeight, top: barInset(window.innerHeight) });
const px = (box: SheetBox) => ({ left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
const boxOf = (el: Element): SheetBox => {
  const rect = el.getBoundingClientRect();
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
};
/** What changes with the box during the morph: the corner radius and the surface colour, so the panel starts as the card and ends as the sheet. */
const lookOf = (el: Element) => {
  const style = getComputedStyle(el);
  return { borderRadius: style.borderTopLeftRadius, backgroundColor: style.backgroundColor };
};

/** The card the sheet belongs to, while it is a usable origin: on the page, with a size, at least partly in the window. */
const originCard = (): HTMLElement | null => {
  if (!props.originId) return null;
  const card = document.querySelector<HTMLElement>(`.task[data-task-id="${CSS.escape(props.originId)}"]`);
  return card && isUsableOrigin(boxOf(card), viewport()) ? card : null;
};

const scrimEl = (): HTMLElement | null => (scrimRef.value?.$el instanceof HTMLElement ? scrimRef.value.$el : null);

const cancelAll = () => {
  running.forEach((animation) => animation.cancel());
  running = [];
};

/** Runs one animation and resolves when it ends or is cancelled. `fill: both` holds its end frame until `cancelAll`. */
const run = (el: Element | null, keyframes: Keyframe[], options: KeyframeAnimationOptions): Promise<unknown> => {
  if (!el) return Promise.resolve();
  const animation = el.animate(keyframes, { fill: 'both', ...options });
  running.push(animation);
  return animation.finished.catch(() => undefined);
};

/** A static, inert copy of the card's face: the sheet starts as the card and never pops to an empty surface. */
const cardFace = (card: HTMLElement): HTMLElement => {
  const copy = card.cloneNode(true) as HTMLElement;
  copy.removeAttribute('data-task-id');
  copy.removeAttribute('data-sheet-active');
  copy.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  copy.style.cssText = 'width:100%;height:100%;margin:0;opacity:1;transform:none;pointer-events:none;box-shadow:none;';
  return copy;
};

const setFace = (card: HTMLElement | null, box: SheetBox | null) => {
  const face = faceRef.value;
  if (!face) return;
  face.replaceChildren(...(card && box ? [cardFace(card)] : []));
  Object.assign(face.style, box ? { width: `${box.w}px`, height: `${box.h}px` } : { width: '', height: '' });
};

/**
 * The card's face scales uniformly with the card (#705): from the panel's top-left corner, by the ratio of the sheet's width to the card's,
 * on the panel's own easing and duration, so the face always spans the panel's width and its items travel with it.
 */
const scaleFace = (cardWidth: number, sheetWidthPx: number, direction: 'up' | 'down') => {
  const face = faceRef.value;
  if (!face || cardWidth <= 0) return;
  const scale = sheetWidthPx / cardWidth;
  Object.assign(face.style, { transformOrigin: '0 0', willChange: 'transform' });
  const { openMs, closeMs, easeOpen, easeClose } = SHEET_MOTION;
  void run(face, direction === 'up' ? [{ transform: 'scale(1)' }, { transform: `scale(${scale})` }] : [{ transform: `scale(${scale})` }, { transform: 'scale(1)' }], { duration: direction === 'up' ? openMs : closeMs, easing: direction === 'up' ? easeOpen : easeClose });
};

const settle = () => {
  cancelAll();
  setFace(null, null);
  Object.assign(faceRef.value?.style ?? {}, { transformOrigin: '', willChange: '' });
  const el = panel();
  if (el) {
    const vp = viewport();
    Object.assign(el.style, { height: `${sheetHeight(sheetWidth(vp.width), sheetMaxHeight(vp.height, vp.top))}px`, visibility: 'visible' });
    // At rest: the frame's height is the same before and after the morph, so the E2E settle helper reads this mark, not the height (#705)
    el.dataset.settled = 'true';
  }
  if (innerRef.value) Object.assign(innerRef.value.style, { width: '', height: '', flex: '' });
};

/**
 * The dialog content mounts after `shown` flips: at once when the shell was already mounted closed, but a sheet that is open
 * from the first render (a deep link) waits for the page to mount first, through the portal. Poll per frame, at most a second.
 */
async function panelReady(mine: number): Promise<boolean> {
  for (let frame = 0; frame < 60 && mine === generation; frame++) {
    if (panel() && innerRef.value) return true;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  return mine === generation && !!panel() && !!innerRef.value;
}

async function playOpen(mine: number, atRest: boolean) {
  cancelAll();
  if (!(await panelReady(mine))) return;
  const el = panel();
  const inner = innerRef.value;
  if (!el || !inner) return;
  animating = true;
  delete el.dataset.settled;
  const vp = viewport();
  const w = sheetWidth(vp.width);
  const maxH = sheetMaxHeight(vp.height, vp.top);
  // The frame is fixed (#870): its height follows the width and the window, never the content, so nothing is measured
  const h = sheetHeight(w, maxH);
  Object.assign(el.style, { maxHeight: `${maxH}px`, opacity: '', transform: '' });
  const card = originCard();
  const from = card ? boxOf(card) : null;
  const to = placeSheet(from, { w, h }, vp);
  Object.assign(el.style, { ...px(to), visibility: 'visible' });
  // The content keeps its final size while the panel grows: it is clipped, not re-laid-out every frame
  Object.assign(inner.style, { width: `${to.w}px`, height: `${to.h}px`, flex: HELD_SIZE });

  const reduced = reducedMotion();
  const fade: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
  if (atRest) {
    // A direct link, the first route of the session: the sheet stands there, nothing plays on page load (#594)
    settle();
    animating = false;
    keepPanelInside();
    return;
  }
  void run(scrimEl(), fade, { duration: reduced ? SHEET_MOTION.reducedMs : SHEET_MOTION.scrimInMs, easing: 'linear' });

  if (reduced) {
    await run(el, fade, { duration: SHEET_MOTION.reducedMs, easing: 'linear' });
  } else if (!from || !card) {
    await run(el, [{ opacity: 0, transform: 'scale(0.97)' }, { opacity: 1, transform: 'none' }], { duration: SHEET_MOTION.centredInMs, easing: SHEET_MOTION.easeOpen });
  } else {
    const cardLook = lookOf(card);
    const sheetLook = lookOf(el);
    setFace(card, from);
    const { openMs, easeOpen, easeClose } = SHEET_MOTION;
    // The card's face scales up with the card from the panel's top-left corner (the panel's left and top run from the card's, so the face stays on the card's place) and dissolves into the content (#705)
    scaleFace(from.w, to.w, 'up');
    void run(faceRef.value, [{ opacity: 1, easing: easeClose }, { opacity: 0, offset: 0.35 }, { opacity: 0 }], { duration: openMs, easing: 'linear' });
    void run(inner, [{ opacity: 0 }, { opacity: 0, offset: 0.1, easing: easeOpen }, { opacity: 1, offset: 0.5 }, { opacity: 1 }], { duration: openMs, easing: 'linear' });
    await run(el, [{ ...px(from), ...cardLook }, { ...px(to), ...sheetLook }], { duration: openMs, easing: easeOpen });
  }
  if (mine !== generation) return;
  settle();
  animating = false;
  keepPanelInside();
}

async function playClose(mine: number) {
  const el = panel();
  const inner = innerRef.value;
  if (!el || !inner) return;
  animating = true;
  delete el.dataset.settled;
  const current = boxOf(el);
  cancelAll();
  const reduced = reducedMotion();
  const card = originCard();
  const scrim = scrimEl();
  const { closeMs, easeClose, reducedMs } = SHEET_MOTION;
  void run(scrim, [{ opacity: 1 }, { opacity: 0 }], { duration: reduced ? reducedMs : closeMs, easing: 'linear' });

  if (reduced) {
    await run(el, [{ opacity: 1 }, { opacity: 0 }], { duration: reducedMs, easing: 'linear' });
  } else if (!card) {
    await run(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.98)' }], { duration: SHEET_MOTION.centredOutMs, easing: easeClose });
  } else {
    const to = boxOf(card);
    const sheetLook = lookOf(el);
    const cardLook = lookOf(card);
    // Freeze the box and the content at their current size, then fold the panel into the card
    Object.assign(el.style, { ...px(current), height: `${current.h}px`, maxHeight: 'none' });
    Object.assign(inner.style, { width: `${current.w}px`, height: `${current.h}px`, flex: HELD_SIZE });
    setFace(card, to);
    void run(inner, [{ opacity: 1 }, { opacity: 0, offset: 0.4 }, { opacity: 0 }], { duration: closeMs, easing: 'linear' });
    scaleFace(current.w, to.w, 'down');
    void run(faceRef.value, [{ opacity: 0 }, { opacity: 0, offset: 0.25 }, { opacity: 1, offset: 0.65 }, { opacity: 1 }], { duration: closeMs, easing: 'linear' });
    await run(el, [{ ...px(current), ...sheetLook }, { ...px(to), ...cardLook }], { duration: closeMs, easing: easeClose });
  }
  if (mine !== generation) return;
  animating = false;
}

/** Keeps the sheet inside the window and within its limits after the content grew (Metadaten, a topic editor) or the window changed. */
function keepPanelInside() {
  const el = panel();
  if (!el || animating) return;
  const vp = viewport();
  el.style.maxHeight = `${sheetMaxHeight(vp.height, vp.top)}px`;
  el.style.width = `${sheetWidth(vp.width)}px`;
  el.style.height = `${sheetHeight(sheetWidth(vp.width), sheetMaxHeight(vp.height, vp.top))}px`;
  const next = keepInside(boxOf(el), vp);
  Object.assign(el.style, { left: `${next.x}px`, top: `${next.y}px` });
}

watch(() => props.open, async (isOpen) => {
  const mine = ++generation;
  if (isOpen) {
    const atRest = !arrivedFromAnotherPage();
    shown.value = true;
    await nextTick();
    if (mine === generation) await playOpen(mine, atRest);
    return;
  }
  if (!shown.value) return;
  await playClose(mine);
  if (mine !== generation) return;
  shown.value = false;
  await nextTick();
  emit('after-leave');
}, { immediate: true });

const onUpdateOpen = (value: boolean) => {
  if (!value) emit('update:open', false);
};

watch(panel, (el) => {
  resizeObserver?.disconnect();
  if (el instanceof Element) resizeObserver?.observe(el);
}, { flush: 'post' });

onMounted(() => {
  resizeObserver = new ResizeObserver(keepPanelInside);
  window.addEventListener('resize', keepPanelInside);
  const el = panel();
  if (el instanceof Element) resizeObserver.observe(el);
});

onBeforeUnmount(() => {
  generation++;
  cancelAll();
  resizeObserver?.disconnect();
  window.removeEventListener('resize', keepPanelInside);
});
</script>
