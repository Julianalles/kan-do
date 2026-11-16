<!--
@component Board
@kind block
@category layout
@description Main kanban board component that organizes and displays tasks by status
@usage Used on the main page to provide the core task management interface
@avoid Not for one column or one card (BoardColumn, TaskCard); mounted once per page, never nested.
@responsibility
- Renders the complete kanban board with all columns
- Manages drag-and-drop functionality between columns
- Handles task status changes and column order updates
- Provides visual feedback during task interactions
- Two places, one strip (#354, epic #334): "Alle" (`/all`: BoardNotPlanned beside Offen) and "Heute" (`/tasks`: Offen, Jetzt + Wartet, Erledigt). Both are paths of one page, so this
  component stays mounted and Offen is the same column in both; `data-place` on `.board` says which shows. A change of place moves the whole strip sideways in one move (420 ms on the app bar's curve,
  `--place-move` / `--place-ease` in board.css, nothing under reduced motion): desktop a transform animation over the layout change (FLIP, a retarget continues from where the strip is), phone the
  strip's own transform on that timing. `data-place-moving` is set meanwhile; the side out of view is `inert`, and once the move is over it is out of layout (desktop) or hidden (phone), so
  neither pointer, keyboard, reader nor a drag reaches it. The Jetzt focus overlay never shows on "Alle" nor during the move
- "Alle", drag (#355): a card is carried between "Nicht geplant" and Offen with the board's own drag (useBoardDndKit); `data-over-not-planned` on `.board` while that side is the drop
  target (dnd.css takes the placeholder out of Offen's layout). Phone: the edge scroll and its arrows work on the two pages of "Alle" as on Heute's three
- "Alle": BoardContinue ("Weiter zu Heute" with the capacity echo) in Offen's footer on desktop and as a fixed bar on the phone; the two planning moves are announced politely (usePlanMoves)
- Phone: column pages moved by swipe and drag edge-scroll only (no tabs, #470), per place: "Alle" has two ("Nicht geplant", Offen), "Heute" three (Offen, Jetzt + Wartet, Erledigt); a swipe, the
  edge-scroll and focus never leave the place. The active page within the place is `data-mobile-page`. Heute opens on Jetzt while a task sits there, else on Offen (kd#191), and on Offen when
  coming from "Alle"; "Alle" opens on "Nicht geplant". Focus entering an off-screen page of the place makes it active (the keyboard / screen-reader path the tabs were)
- Phone: BoardPageDots, a non-interactive page indicator above the column title (kd#26), one dot per page of the place
- Erledigt footer: the "Tag abschließen" CTA while something is done today
-->
<template>
  <DragDropProvider :plugins="dndPlugins" :sensors="dndSensors" @drag-start="handleDragStart" @drag-over="onDragOver" @drag-end="handleDragEnd">
  <div
    class="board-container"
    :data-sheet-task-id="spotlightTaskId ?? undefined"
    :data-focus-lit="focusLit ? '' : undefined"
    @pointerdown="onSwipePointerDown"
    @focusin="onBoardFocusIn"
  >
    <!-- Stacks opening and closing (TaskStack), read out politely -->
    <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ stackAnnouncement }}</div>
    <!-- "Für heute einplanen" and "Nicht heute" (#354): the card leaves the list the reader is in, so the move is said -->
    <div class="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="plan-announcement">{{ planAnnouncement }}</div>
    <!-- Phone page indicator (kd#26): fixed to the viewport above the sliding pages, never interactive -->
    <BoardPageDots :page="placePage" :count="placePageCount" :offset-px="swipeOffsetPx" :live="isSwiping" />

    <BoardFocusBar />
    <!-- Phone, on "Alle" (#354): the way on to Heute and the echo of Offen's capacity line, fixed above the app bar -->
    <BoardContinue
      v-if="isAll && isMobile"
      phone
      :count="tasksOpen.length"
      :echo-active="stripPage === NOT_PLANNED_PAGE"
      :lifted="focusBarShows"
      :hidden="isDragging"
      @show-line="showCapacityLineOnPhone"
    />

    <div
      ref="boardEl"
      class="board"
      :class="{ 'dragging': isDragging, 'swiping': isSwiping }"
      :data-place="place"
      :data-place-moving="placeMoving ? '' : undefined"
      :data-drop-ghost="dragState.ghostCount > 0 ? '' : undefined"
      :data-over-not-planned="dragState.overNotPlanned ? '' : undefined"
      :style="mobileBoardStyle"
      :data-focus="focusEnabledNow ? '' : undefined"
      :data-focus-lit="focusLit ? '' : undefined"
      :data-mobile-page="placePage"
    >
      <!-- Focus overlay (#394): first child, so the layer rules in board-focus-overlay.css apply -->
      <FocusOverlay
        v-if="focusEnabledNow || focusLeaving"
        :on="focusShown"
        :leaving="focusLeaving"
        :touch="focusPointerKind === 'touch'"
        :swallow-tap="focusSwallowTap"
      />
      <!-- "Nicht geplant" (#354): two tracks left of Offen (phone: a page left of Offen); its cards are in the DOM
           only while "Alle" shows or the strip travels -->
      <BoardNotPlanned :active="isAll" :rendered="isAll || placeMoving" />
      <BoardColumn
        :tasks="tasksOpen"
        :task-status="TaskStatus.Open"
        :is-dragging="isDragging"
        :mute-others="false"
        :grouping-enabled="groupingEnabled"
        :grouping-key="groupingKey"
      >
        <!-- "Weiter zu Heute" at the foot of Offen on "Alle" (desktop), where Erledigt has "Tag abschließen" -->
        <template v-if="isAll && !isMobile" #footer>
          <BoardContinue />
        </template>
      </BoardColumn>
      <!-- Progress + Waiting share one scroll-page on mobile -->
      <div class="column-group-mid" :inert="isAll || undefined">
        <BoardColumn
          :tasks="tasksProgress"
          :task-status="TaskStatus.Progress"
          :is-dragging="isDragging"
          :mute-others="false"
          :grouping-enabled="groupingEnabled"
          :grouping-key="groupingKey"
        />
        <BoardColumn
          :tasks="tasksWaiting"
          :task-status="TaskStatus.Waiting"
          :is-dragging="isDragging"
          :mute-others="false"
          :grouping-enabled="groupingEnabled"
          :grouping-key="groupingKey"
        />
      </div>
      <BoardColumn
        :tasks="tasksDone"
        :task-status="TaskStatus.Done"
        :is-dragging="isDragging"
        :mute-others="false"
        :grouping-enabled="groupingEnabled"
        :grouping-key="groupingKey"
        :inert="isAll || undefined"
        @archive="handleArchiveTasks"
      >
        <!-- "Tag abschließen" under the last card (#470); hidden while nothing is done today (the Mehr panel row stays). Desktop: the
             column's sticky footer, natural width. Phone (#297): the end of the list (not sticky), the cards' box: the footer's px-3 is
             the list's own inset and the width is capped like a card -->
        <template v-if="tasksDone.length > 0" #footer>
          <!-- On desktop the footer is sticky above the cards: the paper backing keeps the soft button's translucent fill solid -->
          <div class="flex w-full justify-center max-md:px-3">
            <span class="flex rounded-md bg-page max-md:w-full max-md:max-w-(--task-card-max-width)">
              <UButton
                icon="i-ph-sun-horizon"
                color="neutral"
                variant="soft"
                size="lg"
                class="max-md:w-full max-md:justify-center"
                data-testid="day-close-cta"
                @click="openDayClose"
              >
                {{ t('nav.dayClose') }}
              </UButton>
            </span>
          </div>
        </template>
      </BoardColumn>
    </div>

    <!-- Mobile edge-scroll indicators: appear while dragging near the screen edge -->
    <template v-if="isDragging">
      <div
        v-if="stripPage > firstPage"
        class="edge-indicator edge-indicator--left md:hidden"
        :class="{ 'edge-indicator--charging': edgeDirection === 'left' }"
        :style="edgeIndicatorStyle"
        aria-hidden="true"
      >
        <UIcon :name="ICONS.back" class="size-6" />
      </div>
      <div
        v-if="stripPage < lastPage"
        class="edge-indicator edge-indicator--right md:hidden"
        :class="{ 'edge-indicator--charging': edgeDirection === 'right' }"
        :style="edgeIndicatorStyle"
        aria-hidden="true"
      >
        <UIcon :name="ICONS.forward" class="size-6" />
      </div>
    </template>
  </div>

  <!-- Drag overlay: renders a floating task card clone while dragging -->
  <DragOverlay :drop-animation="dropAnimation">
    <template v-if="previewTaskId" #default>
      <!-- A whole stack (#150): its collapsed face as it rests, not only the front card -->
      <task-stack
        v-if="draggingStack"
        :stack-key="draggingStack.key"
        :label="draggingStack.label"
        :tasks="draggingStack.tasks"
        :task-status="dragState.sourceStatus ?? TaskStatus.Open"
        :sortable-index="0"
        :muted="false"
        preview
        class="kando-dnd-preview"
      />
      <task-card
        v-else-if="draggingTask"
        :task="draggingTask"
        :muted="false"
        :source-icon="previewFromNotPlanned"
        :corner-room="previewFromNotPlanned"
        preview
        class="kando-dnd-preview"
      />
    </template>
  </DragOverlay>
  </DragDropProvider>
</template>

<script setup lang="ts">
import { ICONS } from '~/lib/icons'
import { computed, nextTick, ref, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { useBoardStore } from "~/store/board";
import { useTasksStore } from "~/store/tasks";
import { useBoardGrouping } from "~/composables/useBoardGrouping";
import { useBoardFocus } from "~/composables/useBoardFocus";
import BoardFocusBar from "~/components/board/BoardFocusBar.vue";
import { useBoardDndKit } from "~/composables/useBoardDndKit";
import { useDropMotion } from "~/composables/useDropMotion";
import { useBoardSwipe } from "~/composables/useBoardSwipe";
import { useEdgeIndicatorTop } from "~/composables/useEdgeIndicatorTop";
import { useBoardAnnouncements } from "~/composables/useBoardAnnouncements";
import { useStackExpansion } from "~/composables/useStackExpansion";
import { TaskStatus } from "~/types/taskStatus";
import { useBoardDragState } from "~/composables/useBoardDragState";
import { useSheetSpotlight } from "~/composables/useSheetSpotlight";
import { DragDropProvider, DragOverlay } from "@dnd-kit/vue";
import TaskCard from "~/components/task/TaskCard.vue";
import TaskStack from "~/components/task/TaskStack.vue";
import BoardPageDots from "~/components/board/BoardPageDots.vue";
import BoardNotPlanned from "~/components/board/BoardNotPlanned.vue";
import BoardContinue from "~/components/board/BoardContinue.vue";
import { useBoardPlace } from "~/composables/useBoardPlace";
import { usePlanMoves } from "~/composables/usePlanMoves";
import FocusOverlay from "~/components/board/FocusOverlay.vue";
import { FOCUS_LEAVE_MS, useFocusOverlay } from "~/composables/useFocusOverlay";
import { arrivedFromAnotherPage } from "~/lib/routeArrival";
import { inCardAdding } from "~/composables/useInCardAdding";
import { useOpenLayer } from "~/composables/useOpenLayer";
import { useNewDayRecap } from "~/composables/useNewDayRecap";
import { useSettingsStore } from "~/store/settings";
import { useArchiveDoneTasks } from "~/composables/useArchiveDoneTasks";
import { useDayClose } from "~/composables/useDayClose";
import { isPhoneNow, useIsPhone } from '~/composables/useIsDesktop';

/**
 * Script-API: orchestrates kanban data via stores/composables, wires DnD
 * with rAF-throttled hover updates, and persists order/status changes. Dev logging is guarded.
 */
defineOptions({ name: "Board" });

/** Root class while a drag runs; `assets/css/dnd.css` sets the grabbing cursor on it */
const DRAGGING_ROOT_CLASS = "kando-dnd-active";

const tasksStore = useTasksStore();
const boardStore = useBoardStore();
const { archiveTasks } = useArchiveDoneTasks();
const { open: openDayClose } = useDayClose();
const { t } = useI18n();
const { dragState } = useBoardDragState();
const { stackAnnouncement } = useStackExpansion();
const { spotlightTaskId } = useSheetSpotlight();
const { onDragStart, onDragOver, onDragEnd, refreshDroppableShapes } = useBoardDndKit();
const { plugins: dndPlugins, sensors: dndSensors } = useBoardAnnouncements();

// The end of a drag as motion (kd#181): the preview outlives the drag by its glide to the slot, then the card is
// set down. `handleDragEnd` reads the dragged ids before `onDragEnd` clears them; visuals only.
const { land, reset: resetDropMotion, dropAnimation } = useDropMotion();
/** The held card came from "Nicht geplant" (#355): the preview keeps that side's face (source icon) until the next drag, the glide included */
const previewFromNotPlanned = ref(false);
function handleDragStart(event: Parameters<typeof onDragStart>[0]) {
  resetDropMotion();
  onDragStart(event);
  previewFromNotPlanned.value = dragState.value.fromNotPlanned;
}
function handleDragEnd(event: Parameters<typeof onDragEnd>[0]) {
  const { draggedTaskId, draggedStack } = dragState.value;
  onDragEnd(event);
  if (draggedTaskId) land(draggedTaskId, draggedStack);
}
onBeforeUnmount(resetDropMotion);
onBeforeUnmount(() => {
  if (import.meta.client) document.documentElement.classList.remove(DRAGGING_ROOT_CLASS);
});

/** The card the overlay shows: the dragged one, then the one gliding to its slot */
const previewTaskId = computed(() => dragState.value.draggedTaskId ?? dragState.value.landingTaskId);

const draggingTask = computed(() =>
  previewTaskId.value
    ? (tasksStore.task(previewTaskId.value) ?? null)
    : null
);

/** The members of the dragged stack as they were at drag start; ones that are gone are left out */
const draggingStack = computed(() => {
  const stack = dragState.value.draggedStack ?? dragState.value.landingStack;
  if (!stack) return null;
  const tasks = stack.taskIds.flatMap((id) => tasksStore.task(id) ?? []);
  return tasks.length > 0 ? { key: stack.key, label: stack.label, tasks } : null;
});

/** Tracks whether a task is currently being dragged */
const isDragging = computed(() => dragState.value.isDragging);

const groupingEnabled = computed(() => boardStore.grouping.enabled);
const { effectiveGroupKey: groupingKey } = useBoardGrouping();

/**
 * Tasks in the Open/Today column.
 */
const { applyFocus, focusTopic, chipsOpen } = useBoardFocus();
/** The topic focus bar shows (its chip row or its pill): on the phone the "Weiter zu Heute" bar steps up above it */
const focusBarShows = computed(() => focusTopic.value !== null || chipsOpen.value);
const tasksOpen = computed(() => applyFocus(tasksStore.tasksOpen));

/**
 * Tasks in the Progress/Doing column.
 */
const tasksProgress = computed(() => tasksStore.tasksProgress);

/**
 * Tasks in the Waiting column.
 */
const tasksWaiting = computed(() => applyFocus(tasksStore.tasksWaiting));

/**
 * Tasks in the Done column (only today's completions).
 * Yesterday's tasks are rendered separately in the archive section.
 */
const tasksDone = computed(() => applyFocus(tasksStore.tasksDoneToday));

// ── The two places (#354) and the phone's column pages (transform-based) ─────────
// One strip holds both places: "Nicht geplant" (-1), Offen (0), Jetzt + Wartet (1), Erledigt (2). "Alle" shows -1 and
// 0, "Heute" 0 to 2; Offen is the page both share. On mobile the board is 300% of its container wide, "Nicht geplant" hangs one
// page left of it (board.css), and
// .board-container clips it to its own width (never 100vw, #269); `stripPage` drives translateX so no scroll container
// is needed. No tabs (#470): a swipe, the drag edge-scroll and focus entering a page move it inside the place; only
// the app bar and "Weiter zu Heute" change the place.

const { place, isAll } = useBoardPlace();
const { announcement: planAnnouncement } = usePlanMoves();

/** Strip index of the "Nicht geplant" page */
const NOT_PLANNED_PAGE = -1;
/** Strip index of the last page (Erledigt) */
const LAST_STRIP_PAGE = 2;

/** True when the viewport is ≤767 px (updated reactively via MediaQueryList) */
const isMobile = useIsPhone();

/**
 * The strip page a phone shows (-1 "Nicht geplant", 0 Offen, 1 Jetzt + Wartet, 2 Erledigt). "Alle" opens on "Nicht
 * geplant". Heute opens on the Jetzt page while a task sits in Jetzt, so the running task and its timebox are there
 * at a glance (kd#191); with an empty Jetzt it opens on Offen, where the next task is picked. Read once at setup (the
 * app is client-rendered: the stores and the media query are there), so the first paint is already that page and
 * nothing slides.
 */
const stripPage = ref(
  isAll.value ? NOT_PLANNED_PAGE : import.meta.client && isPhoneNow() && tasksProgress.value.length > 0 ? 1 : 0,
);

/** First and last strip page of the place that shows */
const firstPage = computed(() => (isAll.value ? NOT_PLANNED_PAGE : 0));
const lastPage = computed(() => (isAll.value ? 0 : LAST_STRIP_PAGE));
/** The page within the place (Heute: 0 to 2 as ever; "Alle": 0 and 1): `data-mobile-page`, the dots and the swipe count from here */
const placePage = computed(() => stripPage.value - firstPage.value);
const placePageCount = computed(() => lastPage.value - firstPage.value + 1);

/** Navigate to the given strip page; never beyond the place that shows. */
const scrollToTab = (index: number) => {
  stripPage.value = Math.min(Math.max(index, firstPage.value), lastPage.value);
};

// ── The move between the places ──
const boardEl = ref<HTMLElement | null>(null);
/** The strip travels between the places: both sides are in view and painted until it has arrived */
const placeMoving = ref(false);
let placeMove: Animation | null = null;
let placeFades: Animation[] = [];
let placeMoveTimer: ReturnType<typeof setTimeout> | undefined;
/** Bumped per move: the end of a move that was overtaken by a retarget must not settle the strip */
let placeMoveToken = 0;

/** Length of the place move in ms (`--place-move`, board.css); 0 = reduced motion or no stylesheet */
function placeMoveMs(): number {
  if (!boardEl.value) return 0;
  const raw = getComputedStyle(boardEl.value).getPropertyValue('--place-move').trim();
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value)) return 0;
  return raw.endsWith('ms') ? value : value * 1000;
}

function endPlaceMove(token: number) {
  if (token !== placeMoveToken) return;
  clearTimeout(placeMoveTimer);
  placeFades.forEach((fade) => fade.cancel());
  placeFades = [];
  placeMove = null;
  placeMoving.value = false;
}

/** The sides that are in view on one place only: [those of "Alle"], [those of "Heute"] */
const sidesOf = (el: HTMLElement): [HTMLElement[], HTMLElement[]] => [
  [...el.querySelectorAll<HTMLElement>(':scope > #column-not-planned')],
  [...el.querySelectorAll<HTMLElement>(':scope > .column-group-mid, :scope > #column-done')],
];

// Default (pre) flush: the callback runs before the render that applies the new place, so the strip can be measured
// where it stands now (mid-move included) and animated from there to where the layout puts it.
watch(place, async (to) => {
  const el = boardEl.value;
  const ms = placeMoveMs();
  const token = ++placeMoveToken;
  clearTimeout(placeMoveTimer);

  // "Alle" opens on "Nicht geplant"; Heute on Offen when coming from "Alle". Kept on desktop too, where no page
  // shows it: a window narrowed to phone width afterwards stands on a page of the place that shows.
  const target = to === 'all' ? NOT_PLANNED_PAGE : Math.max(stripPage.value, 0);

  if (isMobile.value) {
    // From Offen on "Alle" to Heute nothing travels: Offen is the page both places share, only the dots and the bar change.
    const travels = target !== stripPage.value && ms > 0;
    placeMoving.value = travels;
    stripPage.value = target;
    if (travels) placeMoveTimer = setTimeout(() => endPlaceMove(token), ms + 40);
    return;
  }

  stripPage.value = target;
  // Desktop: the place sets the strip's offset by a margin (board.css), which jumps; the strip then travels there.
  // Heute at rest is the plain three-column grid; it becomes the strip for the length of the move.
  if (!el || ms === 0 || typeof el.animate !== 'function') {
    endPlaceMove(token);
    return;
  }
  // Offen is the column both places show: where it stands says where the strip stands, also while Heute rests in its
  // own three-track grid (board.css lays the strip out only for "Alle" and for the move)
  const offen = () => el.querySelector(':scope > #column-open')?.getBoundingClientRect().left ?? 0;
  const before = offen();
  const [allSides, todaySides] = sidesOf(el);
  const opacityBefore = new Map([...allSides, ...todaySides].map((side) => [side, Number.parseFloat(getComputedStyle(side).opacity)]));
  placeMove?.cancel();
  placeFades.forEach((fade) => fade.cancel());
  const wasMoving = placeMoving.value;
  placeMoving.value = true;
  await nextTick();
  if (token !== placeMoveToken) return;
  const from = before - offen();
  const easing = getComputedStyle(el).getPropertyValue('--place-ease').trim() || 'ease';
  placeMove = el.animate([{ transform: `translateX(${from}px)` }, { transform: 'translateX(0)' }], { duration: ms, easing });
  // On a window wider than three tracks the paper left and right of them shows the side that comes or goes: it fades
  const fade = (sides: HTMLElement[], end: number) => sides.map((side) =>
    side.animate([{ opacity: wasMoving ? (opacityBefore.get(side) ?? 1 - end) : 1 - end }, { opacity: end }], { duration: ms, easing, fill: 'forwards' }));
  placeFades = [...fade(allSides, to === 'all' ? 1 : 0), ...fade(todaySides, to === 'all' ? 0 : 1)];
  placeMove.finished.then(() => endPlaceMove(token), () => { /* retargeted: the new move settles the strip */ });
});
onBeforeUnmount(() => {
  placeMoveToken++;
  clearTimeout(placeMoveTimer);
  placeMove?.cancel();
  placeFades.forEach((fade) => fade.cancel());
});

/** Phone: the echo's tap. Offen is the other page of "Alle": go there, then bring its capacity line into view. */
function showCapacityLineOnPhone() {
  scrollToTab(0);
  void nextTick(() => {
    document.querySelector('#column-open [data-testid="capacity-divider"]')?.scrollIntoView({ block: 'center', behavior: 'auto' });
  });
}

/** Strip page of a column element: "Nicht geplant", Offen, the Jetzt/Wartet group, Erledigt */
const pageOf = (el: Element): number | null => {
  if (el.closest('#column-not-planned')) return NOT_PLANNED_PAGE;
  if (el.closest('#column-open')) return 0;
  if (el.closest('.column-group-mid')) return 1;
  if (el.closest('#column-done')) return 2;
  return null;
};

/**
 * Phone: focus moving into a control on an off-screen column page makes that page active. The tabs were the keyboard
 * and screen-reader path to the other pages; without them a Tab would land in a page the transform has pushed out of view.
 */
const onBoardFocusIn = (event: FocusEvent) => {
  if (!isMobile.value || isDragging.value || !(event.target instanceof Element)) return;
  const page = pageOf(event.target);
  if (page !== null && page !== stripPage.value) scrollToTab(page);
};

// ── Focus overlay (#394) ───────────────────────────────────────────────────────
const settingsStore = useSettingsStore();
const { layerOpen } = useOpenLayer();
/** The new-day recap (#385) is a Teleport overlay without Reka's body lock, so `layerOpen` does not see it */
const { isOpen: recapOpen } = useNewDayRecap();
/** Setting on, a card in Jetzt, Heute showing and the strip at rest (#354), nothing dragged, no sheet, layer, new-day recap or in-card new-task form open, and (phone) the Jetzt page is the visible one */
const focusEnabledNow = computed(
  () =>
    settingsStore.focusEnabled &&
    tasksProgress.value.length > 0 &&
    !isDragging.value &&
    !spotlightTaskId.value &&
    !layerOpen.value &&
    !recapOpen.value &&
    !inCardAdding.value &&
    !isAll.value &&
    !placeMoving.value &&
    (!isMobile.value || stripPage.value === 1),
);
/** Reached from another page (statistics, settings): the overlay waits its return delay, so the whole board is seen first (kd#133) */
const { shown: focusShown, pointerKind: focusPointerKind, swallowTap: focusSwallowTap } = useFocusOverlay(focusEnabledNow, {
  arrived: arrivedFromAnotherPage(),
});

/** The overlay is visible: the Jetzt card lifts, and what sits above the board steps back (board-focus-overlay.css) */
const focusLit = computed(() => focusEnabledNow.value && focusShown.value);

// State the board owns that rules outside it read (#275): the app bar's veil, the root colours and the scroll bar key on
// `<html>` attributes, mirrored after the same render that sets them on the board. A selector `html:has(.board[…])` would
// do it without script, and restyle the whole page on every card change (tests/config/performance-guards.test.ts).
const mirrorOnRoot = (attribute: string, on: boolean) => {
  if (import.meta.client) document.documentElement.toggleAttribute(attribute, on);
};
watch(focusLit, (lit) => mirrorOnRoot('data-focus-lit', lit), { immediate: true, flush: 'post' });
watch(spotlightTaskId, (id) => mirrorOnRoot('data-sheet-open', !!id), { immediate: true, flush: 'post' });
onBeforeUnmount(() => {
  mirrorOnRoot('data-focus-lit', false);
  mirrorOnRoot('data-sheet-open', false);
});

/** The card left Jetzt (done, waiting, synced away) while the overlay was up: it stays mounted to fade out (#394).
 *  A drag, an open sheet or layer still remove it at once. `data-focus` follows `focusEnabledNow`, so the layer rules go now. */
const focusLeaving = ref(false);
let focusLeavingTimer: ReturnType<typeof setTimeout> | null = null;
watch(focusEnabledNow, (now, was) => {
  if (focusLeavingTimer) clearTimeout(focusLeavingTimer);
  focusLeavingTimer = null;
  focusLeaving.value = false;
  if (was && !now && tasksProgress.value.length === 0 && !isDragging.value && !spotlightTaskId.value && !layerOpen.value) {
    focusLeaving.value = true;
    focusLeavingTimer = setTimeout(() => {
      focusLeaving.value = false;
      focusLeavingTimer = null;
    }, FOCUS_LEAVE_MS);
  }
});
onBeforeUnmount(() => {
  if (focusLeavingTimer) clearTimeout(focusLeavingTimer);
});

// ── Swipe gestures (column switching when not dragging) ───────────────────────
// Axis lock + finger-follow live in useBoardSwipe. It stands down while a dnd-kit drag is
// active, so a drop gesture can never switch the page.

const {
  offsetPx: swipeOffsetPx,
  isSwiping,
  onPointerDown: onSwipePointerDown,
} = useBoardSwipe({
  // The pages of the place that shows: a swipe at its edge meets resistance and never leads to the other place
  activeTab: placePage,
  lastTab: () => placePageCount.value - 1,
  isEnabled: () => isMobile.value && !isDragging.value,
  onCommit: (page) => scrollToTab(page + firstPage.value),
});

/**
 * CSS transform that slides the board to show the active column on mobile, plus the
 * transient finger-follow offset while a swipe is live.
 * Returns an empty object on desktop so the grid layout is unaffected.
 */
const mobileBoardStyle = computed<{ transform?: string }>(() => {
  if (!isMobile.value) return {};
  const offset = swipeOffsetPx.value !== 0 ? ` + ${Math.round(swipeOffsetPx.value)}px` : '';
  return { transform: `translateX(calc(${-stripPage.value} * 100% / 3${offset}))` };
});

// ── Mobile edge-scroll during drag ────────────────────────────────────────────

/** Width of the hot zone at each screen edge that triggers a column scroll */
const EDGE_ZONE_PX = 72;
/** Milliseconds the pointer must remain in the edge zone before scrolling fires */
const EDGE_HOLD_MS = 650;
/** Cooldown after a scroll fires to prevent back-to-back triggers (ms) */
const EDGE_COOLDOWN_MS = 500;

/** Reactive direction so the edge-indicator template can show the charging state */
const edgeDirection = ref<'left' | 'right' | null>(null);

let edgeScrollTimer: ReturnType<typeof setTimeout> | null = null;
let edgeScrollCooldown = false;

const clearEdgeTimer = () => {
  if (edgeScrollTimer !== null) {
    clearTimeout(edgeScrollTimer);
    edgeScrollTimer = null;
  }
  edgeDirection.value = null;
};

const fireEdgeScroll = (direction: 'left' | 'right') => {
  // The pages of the place that shows: on "Alle" a card is carried between "Nicht geplant" and Offen this way (#355)
  if (edgeScrollCooldown) return;
  const target = direction === 'right'
    ? Math.min(stripPage.value + 1, lastPage.value)
    : Math.max(stripPage.value - 1, firstPage.value);
  if (target === stripPage.value) return;

  scrollToTab(target);
  refreshDroppableShapes();
  edgeScrollCooldown = true;
  edgeDirection.value = null;
  setTimeout(() => { edgeScrollCooldown = false; }, EDGE_COOLDOWN_MS);
};

/**
 * Tracks pointer position during drag and triggers a column scroll when the
 * pointer dwells inside the left / right edge zone for EDGE_HOLD_MS.
 * Only active on mobile (max-width: 767px).
 */
const handleDragPointerMove = (event: PointerEvent) => {
  if (!isDragging.value || !import.meta.client) return;
  if (!isMobile.value) {
    clearEdgeTimer();
    return;
  }

  const x = event.clientX;
  const vw = window.innerWidth;
  const dir: 'left' | 'right' | null =
    x < EDGE_ZONE_PX ? 'left' :
    x > vw - EDGE_ZONE_PX ? 'right' :
    null;

  if (dir === edgeDirection.value) return; // unchanged — keep existing timer

  clearEdgeTimer();
  edgeDirection.value = dir;

  if (dir !== null) {
    edgeScrollTimer = setTimeout(() => {
      fireEdgeScroll(dir);
      edgeScrollTimer = null;
    }, EDGE_HOLD_MS);
  }
};

// Edge arrows follow the active page's header row, clamped at the top (#231)
const COLUMN_PAGE_SELECTORS: Record<number, string> = {
  [NOT_PLANNED_PAGE]: '#column-not-planned',
  0: '#column-open',
  1: '.column-group-mid',
  2: '#column-done',
};
const { top: edgeIndicatorTopPx } = useEdgeIndicatorTop({
  isActive: computed(() => isDragging.value && isMobile.value),
  activeTab: stripPage,
  getPage: (tab) => {
    const selector = COLUMN_PAGE_SELECTORS[tab];
    return selector ? document.querySelector<HTMLElement>(selector) : null;
  },
});
const edgeIndicatorStyle = computed(() =>
  edgeIndicatorTopPx.value === null ? undefined : { '--edge-indicator-top': `${edgeIndicatorTopPx.value}px` },
);

// Attach / detach the pointermove listener only while a drag is active
watch(isDragging, (dragging) => {
  if (!import.meta.client) return;
  // What dnd-kit's Cursor and PreventSelection plugins did with injected sheets (#285): `dnd.css` keys the grabbing
  // cursor on this root class; a selection made before the pick-up is cleared once (the plugin did so too)
  document.documentElement.classList.toggle(DRAGGING_ROOT_CLASS, dragging);
  if (dragging) {
    document.getSelection()?.removeAllRanges();
    document.addEventListener('pointermove', handleDragPointerMove, { passive: true });
  } else {
    document.removeEventListener('pointermove', handleDragPointerMove);
    clearEdgeTimer();
  }
});

// ──────────────────────────────────────────────────────────────────────────────

const dragDiagnosticCleanups: Array<() => void> = [];

onMounted(() => {
  if (!import.meta.dev || !import.meta.client) {
    return;
  }

  const formatPath = (event: Event) => {
    return event.composedPath().slice(0, 8).map((node) => {
      if (!(node instanceof HTMLElement)) {
        return String(node);
      }

      const className = typeof node.className === 'string' ? node.className : '';
      return `${node.tagName}${node.id ? `#${node.id}` : ''}.${className.substring(0, 40)}`;
    });
  };

  const topElements = (event: DragEvent) => {
    return document.elementsFromPoint(event.clientX, event.clientY).slice(0, 6).map((node) => {
      const className = typeof node.className === 'string' ? node.className : '';
      const style = getComputedStyle(node);
      return `${node.tagName}${node.id ? `#${node.id}` : ''}.${className.substring(0, 40)} z:${style.zIndex} pe:${style.pointerEvents}`;
    });
  };

  const logNativeDrag = (event: Event) => {
    const dragEvent = event as DragEvent;
    const target = dragEvent.target instanceof HTMLElement ? dragEvent.target : null;
    const currentTarget = dragEvent.currentTarget instanceof HTMLElement ? dragEvent.currentTarget : null;
    const slot = target?.closest('#column-waiting, #column-open, #column-progress, #column-done')?.id ?? 'none';
    const wrapper = target?.closest('.task-wrapper') as HTMLElement | null;
    console.log('[DnD-Native]', {
      type: dragEvent.type,
      slot,
      target: target ? `${target.tagName}.${typeof target.className === 'string' ? target.className.substring(0, 40) : ''}` : null,
      currentTarget: currentTarget ? `${currentTarget.tagName}.${typeof currentTarget.className === 'string' ? currentTarget.className.substring(0, 40) : ''}` : null,
      taskId: wrapper?.getAttribute('data-task-id') ?? null,
      defaultPrevented: dragEvent.defaultPrevented,
      cancelBubble: dragEvent.cancelBubble,
      hasDataTransfer: Boolean(dragEvent.dataTransfer),
      types: dragEvent.dataTransfer ? [...dragEvent.dataTransfer.types] : null,
      dropEffect: dragEvent.dataTransfer?.dropEffect ?? null,
      effectAllowed: dragEvent.dataTransfer?.effectAllowed ?? null,
      client: { x: Math.round(dragEvent.clientX), y: Math.round(dragEvent.clientY) },
      path: formatPath(dragEvent),
      elements: topElements(dragEvent),
    });
  };

  const dragEvents: Array<keyof DocumentEventMap> = ['dragstart', 'dragenter', 'dragover', 'drop', 'dragend'];
  for (const eventName of dragEvents) {
    document.addEventListener(eventName, logNativeDrag, true);
    dragDiagnosticCleanups.push(() => document.removeEventListener(eventName, logNativeDrag, true));
  }
});

onBeforeUnmount(() => {
  if (import.meta.client) {
    document.removeEventListener('pointermove', handleDragPointerMove);
    clearEdgeTimer();
  }
  while (dragDiagnosticCleanups.length > 0) {
    const cleanup = dragDiagnosticCleanups.pop();
    cleanup?.();
  }
});

/**
 * Archives the done tasks of earlier days ("Gesehen"); no toast, no undo (#463).
 */
function handleArchiveTasks() {
  const taskIds = tasksStore.tasksDonePrevious.map(t => t.id);
  if (taskIds.length === 0) return;

  archiveTasks(taskIds);
};
</script>
