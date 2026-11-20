<!--
@component BoardColumnHeader
@kind component
@category display
@description Header component for kanban board columns
@usage Used at the top of each BoardColumn to display status title and visual indicators
@avoid Not a page header (PageHeader) and not the header of an expanded stack (TaskStackHeader).
@responsibility
- Displays column title with appropriate styling
- Shows the title as plain text in every column, Erledigt included (#273: its check icon is gone; the done cards keep their corner check)
- Handles visual states for different statuses (waiting, empty)
- The marker (#469): the stroke under the title of the one focus column per view, "Jetzt" on "Heute" and Offen's "Heute" on "Alle" (`marker`). It fades on the clock of the place move (`--place-move`, none under reduced motion) and keeps its padding while hidden, so the title does not shift when the stroke fades
- Offen's title fade (#375, `titleFadeKey`): the column is headed "Heute" on the place "Alle" and "Offen" on "Heute". When the place changes, the old title fades out over the new
  one, which fades in, for the length and on the curve of the board's sideways move (`--place-move` 400 ms, `--place-ease`, board.css): one clock for strip, app-bar chip and title. A second
  change mid-fade continues from the opacity the titles stand at. The outgoing title is `aria-hidden` and in the DOM only meanwhile. Reduced motion (`--place-move: 0ms`): no fade, the title just changes
- Offen (`showAdd`, #248, moved left #264; on the place "Alle" "Meine Aufgaben" has it instead, #380: the task it makes lands there): a round soft icon-only add button at the start of the card-width track (the
  cards' left edge), vertically centred on the title line; the title stays centred exactly like the other columns' (the
  button is out of the flow, so it never moves the title). A tooltip names it on hover and focus (UTooltip, off on the
  phone layout like AppNav's: no hover there, and a tap focuses the button). Click, Enter or Space emits `add`; while a draft is open (`addDisabled`) the button stays in place but is
  disabled, so the header never shifts. `addButtonEl()` lets the column return focus after a cancel. Same look as the
  stack header's close button (ghost UButton, `--fill-on-canvas` fill by CSS, 32px, 44px on touch)
- `addAway` (#609): the button fades out for `--duration-base` (200 ms) and (`opacity-0`, the transition is the button's own) and is `inert` (out of the tab order, the pointer and the reader's tree), keeping its box, so the title never shifts and the fade back in is the same. "Meine Aufgaben" sets it while its empty note offers "Aufgabe erstellen"; none under reduced motion
-->
<template>
  <div
    :class="['column-header', { 'waiting-header': isWaiting, empty: isEmpty }]"
    class="relative flex items-center justify-center"
  >
    <h2
      class="font-display"
      :class="{ 'column-header__marked': marker !== undefined, 'column-header__marked--hidden': marker === 'hidden', 'column-header__fading': outgoingTitle !== null }"
    >
      <span ref="titleEl">{{ title }}</span>
      <!-- The title of the place just left, fading out over the new one (#375); never read: the heading has one name -->
      <span v-if="outgoingTitle !== null" ref="outgoingEl" class="column-header__outgoing" aria-hidden="true">{{ outgoingTitle }}</span>
    </h2>
    <div v-if="showAdd" class="column-header__track">
      <div class="column-header__add-row">
        <UTooltip :open="tipOpen" :text="t('board.addTask')" :disabled="isPhone" @update:open="onTipOpen">
          <UButton
            ref="addButton"
            class="column-header__add"
            :class="{ 'opacity-0': addAway }"
            :inert="addAway || undefined"
            data-round="md"
            color="neutral"
            variant="ghost"
            square
            icon="i-ph-plus"
            :data-testid="addTestId ?? 'add-task-header-button'"
            :aria-label="t('board.addTask')"
            :disabled="addDisabled"
            @click="emit('add')"
            @blur="tipHeldBack = false"
            @pointermove="tipHeldBack = false"
            @pointerleave="tipHeldBack = false"
          />
        </UTooltip>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useMediaQuery } from "@vueuse/core";
import { BREAKPOINT_QUERIES } from "~/lib/breakpoints";
import { TaskStatus } from "~/types/taskStatus";
import { readPlaceMove } from "~/lib/boardPlace";

defineOptions({ name: "BoardColumnHeader" });

/**
 * Props
 * @prop {string} title Title text to display in the column header
 * @prop {TaskStatus} status Task status associated with this column
 * @prop {number} taskCount Number of tasks in this column
 * @prop {boolean=} isEmpty Whether the column contains no tasks
 */
/**
 * Props for BoardColumnHeader component.
 */
const props = defineProps<{
  /** Title text to display in the column header */
  title: string;
  /** Task status associated with this column */
  status: TaskStatus;
  /** Number of tasks in this column */
  taskCount: number;
  /** Whether the column contains no tasks */
  isEmpty?: boolean;
  /** Shows the round add button (Offen only, #248) */
  showAdd?: boolean;
  /** A draft is open: the button stays in place but does nothing */
  addDisabled?: boolean;
  /** The button fades out and leaves the tab order and the reader's tree, its place kept (#609: "Meine Aufgaben" while its empty note offers the same add) */
  addAway?: boolean;
  /** Test id of the add button; "Meine Aufgaben" sets its own, so the two headers of "Alle" never share one (#380) */
  addTestId?: string;
  /** Offen only (#375): the place that shows. A title that changes together with it fades; any other title change (a locale, Wartet's "?") is plain */
  titleFadeKey?: string;
  /** The marker stroke under the title (#469, DESIGN.md "The Marker Rule"): `shown` draws it, `hidden` keeps its place and fades it out (Offen on "Heute"), no value has none (every other column) */
  marker?: 'shown' | 'hidden';
}>();

const emit = defineEmits<{
  /** The add button was pressed (click, Enter or Space) */
  add: [];
}>();

const { t } = useI18n();
// No hover on the phone layout, and a tap focuses the button: no tooltip there (as AppNav's)
const isPhone = useMediaQuery(BREAKPOINT_QUERIES.phone);
const addButton = ref<{ $el: HTMLElement } | null>(null);

/**
 * Tooltip (kd#40 as AppNav's ⋯): the column returns focus here after a cancelled draft, and a focus-open tooltip would
 * then appear for a mouse user who never hovered. It stays held back until the button loses focus or the pointer moves over or leaves it.
 */
const tipOpen = ref(false);
const tipHeldBack = ref(false);
const onTipOpen = (next: boolean) => {
  tipOpen.value = next && !tipHeldBack.value;
};

/** The add button's element, where the column returns focus after a cancelled draft (holds the tooltip back); null when there is none */
const addButtonEl = (): HTMLElement | null => {
  const el = addButton.value?.$el ?? null;
  if (el) { tipHeldBack.value = true; tipOpen.value = false; }
  return el;
};

defineExpose({ addButtonEl });

// ── The title fade between the places (#375) ──
const titleEl = ref<HTMLElement | null>(null);
const outgoingEl = ref<HTMLElement | null>(null);
/** The title of the place just left, while it fades out over the new one; null at rest */
const outgoingTitle = ref<string | null>(null);
let titleFades: Animation[] = [];
/** Bumped per fade: the end of a fade that a second place change overtook must not clear the new one */
let titleFadeToken = 0;

function endTitleFade(token: number) {
  if (token !== titleFadeToken) return;
  titleFades.forEach((fade) => fade.cancel());
  titleFades = [];
  outgoingTitle.value = null;
}

// Default (pre) flush: the callback runs before the render that writes the new title, so a fade that is still
// running can be read where it stands and the next one starts from there (as the board's own move does)
watch(() => [props.title, props.titleFadeKey] as const, async ([title, key], [oldTitle, oldKey]) => {
  if (key === undefined || oldKey === undefined || key === oldKey || title === oldTitle) return;
  const el = titleEl.value;
  const token = ++titleFadeToken;
  const { ms, easing } = readPlaceMove(el);
  const shown = el && titleFades.length > 0 ? Number.parseFloat(getComputedStyle(el).opacity) : 1;
  titleFades.forEach((fade) => fade.cancel());
  titleFades = [];
  // Reduced motion (0 ms) or no Web Animations: the title just changes
  if (!el || ms === 0 || typeof el.animate !== "function") {
    outgoingTitle.value = null;
    return;
  }
  outgoingTitle.value = oldTitle;
  await nextTick();
  if (token !== titleFadeToken) return;
  const outgoing = outgoingEl.value;
  if (!outgoing || !titleEl.value) {
    endTitleFade(token);
    return;
  }
  titleFades = [
    outgoing.animate([{ opacity: shown }, { opacity: 0 }], { duration: ms, easing, fill: "forwards" }),
    titleEl.value.animate([{ opacity: 1 - shown }, { opacity: 1 }], { duration: ms, easing }),
  ];
  titleFades[0]!.finished.then(() => endTitleFade(token), () => { /* overtaken: the next fade clears the title */ });
});
onBeforeUnmount(() => {
  titleFadeToken++;
  titleFades.forEach((fade) => fade.cancel());
});

/**
 * Whether this column represents the Waiting status
 */
const isWaiting = computed(() => props.status === TaskStatus.Waiting);

// Removed unused computed property
</script>

<style scoped>
  /* The marker (DESIGN.md "The Marker Rule"): a stroke of yellow text marker centred on the bottom edge (the baseline) of
     the Jetzt headline on "Heute" and Offen's "Heute" on "Alle" (#239, #469): one stroke per view. Static, a decoration without a meaning of its own; the ink on it keeps body contrast.
     Drawn by hand (kd#207): a layer of its own behind the word, tilted a little and with softly rounded, uneven
     ends, so it sits with the round serif instead of ruling a straight bar under it. The inset is a percentage of the
     h2 so it keeps scaling with the display step: 61% to 98% is a 37% tall stroke whose centre (79.5%) is the baseline
     (measured at the 36px display face, 41.4px line box: baseline at 79.7%). */
  h2.column-header__marked {
    position: relative;
    isolation: isolate; /* keeps the stroke's z-index -1 behind the word, above the page */
    padding-inline: 0.3em;
  }

  h2.column-header__marked::before {
    content: '';
    /* One clock with the strip, the app bar's chip and the title fade (#375): the stroke goes when the place does (#469) */
    transition: opacity var(--place-move, 0ms) var(--place-ease, ease);
    position: absolute;
    inset: 61% 0 2%;
    z-index: -1;
    border-radius: var(--radius-sm) var(--radius-md) var(--radius-sm) var(--radius-md);
    background: var(--marker);
    rotate: -1.6deg;
  }

  h2.column-header__marked--hidden::before {
    opacity: 0;
  }

  h2 {
    z-index: 10;
    margin-top: 1.75rem;
    margin-bottom: 0;
    text-align: center;
    font-size: var(--text-display); /* display step; one size at every width (DESIGN.md ramp) */
    /* Weight and tracking of the display face spelled out: scoped CSS cannot use the utilities */
    font-weight: 500;
    letter-spacing: -0.02em;
    line-height: var(--lh-tight);
    color: var(--ui-text);
    transition: opacity var(--duration-fast) var(--ease-standard);
    transform: translateY(0vh);
    /* The colour follows the Erledigt drop wash (#124, BoardColumn). 0.5s and its curve: the header's own lift while a card
       is dragged, kept off the tokens (#593) */
    transition:
      all 0.5s cubic-bezier(0.16, 1, 0.3, 1),
      color var(--done-wash-duration) var(--ease-standard);
  }

  /* The title fade between the places (#375): for the length of the place move the outgoing title lies centred on the
     new one. Positioned only meanwhile, and without a stacking level of its own, so the header at rest is what it was. */
  h2.column-header__fading {
    position: relative;
    z-index: auto;
  }

  .column-header__outgoing {
    position: absolute;
    top: 0;
    left: 50%;
    translate: -50% 0;
    white-space: nowrap;
    pointer-events: none;
  }

  .waiting-header h2 {
    margin-top: 2.5rem;
  }

  /* Add button (Offen, #248). The track mirrors the task list's side padding (board.css, BoardColumn: px-3, md:px-10) and
     the card box inside it, so the button's left edge is the cards' left edge. Out of the flow: the title stays centred
     in the header whatever the button does. Pointer events pass through everything but the button. */
  .column-header__track {
    position: absolute;
    inset: 0 0.75rem;
    pointer-events: none;
  }

  .column-header__add-row {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    /* A host with a wider card area ("Meine Aufgaben": two card columns, #380) sets --add-row-width and --add-row-max */
    width: min(var(--add-row-width, var(--task-card-width)), 100%);
    max-width: var(--add-row-max, var(--task-card-max-width));
    margin-inline: auto;
    margin-top: 1.75rem; /* the h2's margin-top */
    height: calc(var(--text-display) * var(--lh-tight)); /* the h2's line box: the button centres on the title line */
  }

  /* Round look, size and the phone 44 px floor: the button theme's `data-round="md"` (#602); only placement stays here */
  .column-header__add {
    pointer-events: auto;
    flex: none;
  }

  /* Disabled while a draft is open (DESIGN.md "Disabled"): the dimmed look, no hover answer, and the cursor says so */
  .column-header__add:disabled {
    cursor: not-allowed;
  }

  @media (--desktop) {
    .column-header__track {
      inset-inline: 2.5rem;
    }
  }

  @media (--phone) {
    .column-header__add {
      /* Above the sort control's spacer under the header, which would take the bottom 3 px of the 44 px hit area (#592) */
      position: relative;
      z-index: 1;
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    .column-header__add {
      transition: background-color var(--duration-fast) var(--ease-standard), opacity var(--duration-base) var(--ease-standard);
    }
  }
  
</style>
