<!--
@component BoardNotPlannedGroup
@kind component
@category layout
@description One group of "Meine Aufgaben" on the place "Alle" (#469): the pair of card columns with an optional heading (icon, title, count) above it, and, as a panel, the tinted surface that sets the group off from the plain list
@usage Rendered by BoardNotPlanned, with the list of cards (a TransitionGroup of BoardNotPlannedItem) in the default slot. `panel` for the group of yesterday's tasks, left off for "Weitere Aufgaben". Without `title` there is no heading (the plain list of a day without a panel). `heading-hidden` hides the heading while the drop hint takes its row.
@avoid Not a board column (BoardColumn) and not a page section (PageSheet, SectionHeader alone). Not for a list that folds or sorts: the group only contains.
@responsibility
- Width: the pair of columns is as wide as two cards plus one `--task-list-gap`, centred in the side (a phone: one column, the page's width). Heading and cards share the left edge of the pair
- Panel (#469, D1): a flat `--fill-on-canvas` surface with the card radius plus 4 px, no border and no shadow so it never reads as a card, reaching 0.75rem beyond the cards (a phone: 0.25rem inset from the page). The heading row is the 40 px row every column has under its title, so the first card sits level with Offen's first card
- Heading: SectionHeader `sub` (h3) with a decorative icon, the title and the count as a UBadge; a labelled group: the panel is `role="group"` named by its heading, so assistive tech reads heading and count
- Accepted trade-off (#469): cards inside a surface can read as "nested cards" (user's choice of panels, D1); the surface stays flat (no border, no shadow) so it never competes with a card, and the rendered Impeccable scan (`design-detect.spec.ts`, surface "alle with yesterday's panel") reports nothing for it
-->
<template>
  <div
    class="nps-group"
    :class="{ 'nps-group--panel': panel, 'nps-group--titled': title !== undefined }"
    :role="panel ? 'group' : undefined"
    :aria-labelledby="panel && title !== undefined ? headingId : undefined"
  >
    <SectionHeader
      v-if="title !== undefined"
      :id="headingId"
      tag="h3"
      size="sub"
      class="nps-group__heading"
      :class="{ 'invisible': headingHidden }"
    >
      <UIcon v-if="icon" :name="icon" class="nps-group__icon size-4 shrink-0" aria-hidden="true" />
      <span class="nps-group__title">{{ title }}</span>
      <UBadge color="neutral" variant="soft" :label="String(count)" class="nps-group__count font-sans tracking-normal" />
    </SectionHeader>
    <slot />
  </div>
</template>

<script setup lang="ts">
import SectionHeader from '~/components/ui/SectionHeader.vue'

defineOptions({ name: 'BoardNotPlannedGroup' })

defineProps<{
  /** The heading's text; no heading without it */
  title?: string
  /** The `id` of the heading, which names the panel (`aria-labelledby`) and the list */
  headingId?: string
  /** The number of tasks in the group, shown beside the title */
  count?: number
  /** Decorative icon before the title */
  icon?: string
  /** The tinted surface under the heading and the cards */
  panel?: boolean
  /** Hides the heading while keeping its row (the drop hint takes it) */
  headingHidden?: boolean
}>()
</script>

<style scoped>
.nps-group {
  --nps-pad: 0.75rem;
  position: relative;
  isolation: isolate;
  min-width: 0;
  width: 100%;
}

.nps-group__heading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  /* The 40 px row every column has under its title: the first card of a panel stays level with Offen's (a heading after
     another group is a little tighter and keeps its distance to the group above) */
  min-height: 2.5rem;
  margin: 0;
}

.nps-group__icon {
  color: var(--ui-text-muted);
}

.nps-group__title {
  min-width: 0;
}

/* A heading under another group: not the first row of the side */
.nps-group--titled:not(.nps-group--panel) {
  margin-top: 1.5rem;
}

.nps-group--titled:not(.nps-group--panel) .nps-group__heading {
  min-height: 2rem;
  margin-bottom: 0.5rem;
}

/* The panel: a surface behind the group that reaches past the cards, drawn by a layer of its own so the group keeps the
   width of the pair and its heading and cards keep the card edge */
.nps-group--panel {
  /* Below the last card at every width: --nps-pad is the side reach and is 0 on a phone, the room under the cards is not */
  padding-bottom: 0.75rem;
}

.nps-group--panel::before {
  content: '';
  position: absolute;
  /* A little lower than the heading row, so the headline above and the headline's round add button (#380) keep their air */
  inset: 0.5rem calc(-1 * var(--nps-pad)) 0;
  z-index: -1;
  border-radius: calc(var(--task-card-radius) + 0.25rem);
  background: var(--fill-on-canvas);
}

@media (--desktop) {
  /* Two cards, one gap: the gap between the columns is the one cards have below them */
  .nps-group {
    width: min(calc(2 * var(--task-card-width) + var(--task-list-gap)), 100%);
    margin-inline: auto;
  }
}

@media (--phone) {
  /* One column; the panel spans the page with a 4 px inset, the heading starts on the cards' left edge */
  .nps-group {
    --nps-pad: 0;
  }

  .nps-group--panel::before {
    inset: 0.625rem 0.25rem 0;
  }

  .nps-group__heading {
    padding-inline: max(0.75rem, calc((100% - var(--task-card-max-width)) / 2));
  }
}
</style>
