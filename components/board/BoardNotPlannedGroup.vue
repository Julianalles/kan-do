<!--
@component BoardNotPlannedGroup
@kind component
@category layout
@description One group of "Alle Aufgaben" on the place "Alle" (#469, #702, #741): the pair of card columns and, as a panel, the tinted surface with a label row (sans label, count, a quiet "plan all" button) above it
@usage Rendered by BoardNotPlanned, with the list of cards (a TransitionGroup of BoardNotPlannedItem) in the default slot. `panel` for the block of the tasks left from the last planned day ("Von gestern"); left off for the plain list, which carries the label "Weitere Aufgaben" only while the block shows.
@avoid Not a board column (BoardColumn) and not a page section (PageSheet, SectionHeader alone). Not for a list that folds or sorts: the group only contains.
@responsibility
- Width: the pair of columns is as wide as two cards plus one `--task-list-gap`, centred in the side (a phone: one column, the page's width). Label and cards share the left edge of the pair
- Panel (#469 D1, #702): a flat `--fill-on-canvas` surface with the card radius plus 4 px, no border and no shadow so it never reads as a card, reaching 1 rem beyond the cards (#702: the old 12 px read as narrow; a phone: 0.25rem inset from the page, the cards keep their edge)
- Spacing (#741, the user's direction of 2026-11-24): the label row is 2 rem high with 0.75 rem above it (to the panel's edge) and 0.75 rem below it (to the first card), so the title has the same room on both sides. Accepted trade-off: the block's first card sits 16 px lower than the first card of "Heute" (#469 had them level)
- Label (#702): SectionHeader `label` (h3, the sans, 12 px, muted: a list label is not a heading to read) and the count as a UBadge (hidden from assistive tech; a visually hidden "3 Aufgaben" beside it is read instead); the panel is `role="group"` named by its label
- Button (#702, #741): "Alle für heute einplanen", a quiet secondary UButton (ghost, neutral: a convenience, picking single tasks is the primary way; the user's direction of 2026-11-24) at the right of the label row at every width, its text inset from the cards' edge by its own padding; a phone shows the short text "Alle einplanen". It names its panel (`aria-label`) and emits `add-all` with the click (the caller hands the focus on when the button leaves with its panel); the group moves nothing itself
- `lead` slot (#741): a line of text on the cards' edges on a phone (the same side padding as the label row), used by BoardPlanNote's one-line note
- Accepted trade-off (#469): cards inside a surface can read as "nested cards" (user's choice of panels, D1); the surface stays flat (no border, no shadow) so it never competes with a card, and the rendered Impeccable scan (`design-detect.spec.ts`, surface "alle with yesterday's panel") reports nothing for it
-->
<template>
  <div
    class="nps-group"
    :class="{ 'nps-group--panel': panel, 'nps-group--titled': title !== undefined }"
    :role="panel ? 'group' : undefined"
    :aria-labelledby="panel && title !== undefined ? headingId : undefined"
  >
    <div v-if="title !== undefined" class="nps-group__head">
      <SectionHeader :id="headingId" tag="h3" size="label" class="mb-0 flex min-w-0 items-center gap-2">
        <span class="min-w-0">{{ title }}</span>
        <UBadge
          v-if="count !== undefined"
          color="neutral"
          variant="soft"
          :label="String(count)"
          aria-hidden="true"
          class="font-sans tracking-normal"
          data-testid="nps-group-count"
        />
        <!-- A badge is a generic span: its aria-label would not be read. The count is spoken as text instead ("3 Aufgaben") -->
        <span v-if="count !== undefined" class="sr-only">{{ t('board.notPlanned.panelCount', { n: count }, count) }}</span>
      </SectionHeader>
      <UButton
        v-if="actionLabel"
        color="neutral"
        variant="ghost"
        class="nps-group__action shrink-0"
        :aria-label="t('board.notPlanned.planAllNamed', { section: title })"
        data-testid="nps-group-plan-all"
        @click="(event: MouseEvent) => emit('add-all', event)"
      >
        {{ isPhone ? actionShort : actionLabel }}
      </UButton>
    </div>
    <!-- A line of text above the cards on their edges (BoardPlanNote's phone line, #741) -->
    <div v-if="$slots.lead" class="nps-group__lead"><slot name="lead" /></div>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import { useIsPhone } from '~/composables/useIsDesktop'

defineOptions({ name: 'BoardNotPlannedGroup' })

defineProps<{
  /** The label's text; no label row without it */
  title?: string
  /** The `id` of the label, which names the panel (`aria-labelledby`) */
  headingId?: string
  /** The number of tasks in the group, shown beside the label */
  count?: number
  /** The tinted surface under the label and the cards */
  panel?: boolean
  /** The button's text on desktop; no button without it */
  actionLabel?: string
  /** The button's text on a phone */
  actionShort?: string
}>()

const emit = defineEmits<{ 'add-all': [event: MouseEvent] }>()
const { t } = useI18n()
const isPhone = useIsPhone()
</script>

<style scoped>
.nps-group {
  --nps-pad: 1rem;
  --nps-pad-y: 0.75rem;
  position: relative;
  isolation: isolate;
  min-width: 0;
  width: 100%;
}

/* The label row: as high as the quiet button (2 rem), the label centred in it. The same room stands above the row (the
   panel's top padding) and below it (the row's margin), so the title is as far from the block's edge as from the first
   card (#741, the user's direction of 2026-11-24) */
.nps-group__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  min-height: 2rem;
  margin-bottom: var(--nps-pad-y);
}

/* The surface is a layer of its own (::before): the group keeps the width of the pair, label and cards the card edge */
.nps-group--panel {
  padding-top: var(--nps-pad-y);
  padding-bottom: var(--nps-pad);
}

.nps-group--panel::before {
  content: '';
  position: absolute;
  inset: 0 calc(-1 * var(--nps-pad)) 0;
  z-index: -1;
  border-radius: calc(var(--task-card-radius) + 0.25rem);
  background: var(--fill-on-canvas);
}

.nps-group--panel + .nps-group--panel { margin-top: 1.5rem; }

@media (--desktop) {
  .nps-group {
    width: min(calc(2 * var(--task-card-width) + var(--task-list-gap)), 100%);
    margin-inline: auto;
  }
}

@media (--phone) {
  .nps-group {
    --nps-pad: 0.75rem;
  }

  .nps-group--panel::before {
    inset: 0 0.25rem 0;
  }

  /* The label starts on the cards' left edge and the button ends on their right one; a long title wraps above the button */
  .nps-group__head, .nps-group__lead {
    flex-wrap: wrap;
    padding-inline: max(0.75rem, calc((100% - var(--task-card-max-width)) / 2));
  }
}
</style>
