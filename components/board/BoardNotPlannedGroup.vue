<!--
@component BoardNotPlannedGroup
@kind component
@category layout
@description One group of "Alle Aufgaben" on the place "Alle" (#469, #702): the pair of card columns and, as a panel, the tinted surface with a label row (sans label, count, "plan all" button) above it
@usage Rendered by BoardNotPlanned, with the list of cards (a TransitionGroup of BoardNotPlannedItem) in the default slot. `panel` for a group of yesterday's tasks ("Gestern geplant", "Gestern in Wartet"), left off for the plain list, which has no label.
@avoid Not a board column (BoardColumn) and not a page section (PageSheet, SectionHeader alone). Not for a list that folds or sorts: the group only contains.
@responsibility
- Width: the pair of columns is as wide as two cards plus one `--task-list-gap`, centred in the side (a phone: one column, the page's width). Label and cards share the left edge of the pair
- Panel (#469 D1, #702): a flat `--fill-on-canvas` surface with the card radius plus 4 px, no border and no shadow so it never reads as a card, reaching 1 rem beyond the cards (#702: the old 12 px read as narrow; a phone: 0.25rem inset from the page, the cards keep their edge). The label row is the 40 px row every column has under its title, so the first card of the first panel sits level with Offen's first card
- Label (#702): SectionHeader `label` (h3, the sans, 12 px, muted: a list label is not a heading to read) and the count as a UBadge, named for assistive tech ("3 Aufgaben"); the panel is `role="group"` named by its label
- Button (#702): "Alle für heute einplanen", a soft primary UButton at the right of the label row; a phone puts it below the row, full width, with the short text "Alle einplanen". It names its panel (`aria-label`) and emits `add-all`; the group moves nothing itself
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
      <SectionHeader :id="headingId" tag="h3" size="label" class="flex min-w-0 items-center gap-2">
        <span class="min-w-0">{{ title }}</span>
        <UBadge
          color="neutral"
          variant="soft"
          :label="String(count)"
          :aria-label="t('board.notPlanned.panelCount', { n: count ?? 0 }, count ?? 0)"
          class="font-sans tracking-normal"
          data-testid="nps-group-count"
        />
      </SectionHeader>
      <UButton
        v-if="actionLabel"
        color="primary"
        variant="soft"
        class="nps-group__action shrink-0"
        :aria-label="t('board.notPlanned.planAllNamed', { section: title })"
        data-testid="nps-group-plan-all"
        @click="emit('add-all')"
      >
        {{ isPhone ? actionShort : actionLabel }}
      </UButton>
    </div>
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

const emit = defineEmits<{ 'add-all': [] }>()
const { t } = useI18n()
const isPhone = useIsPhone()
</script>

<style scoped>
.nps-group {
  --nps-pad: 1rem;
  position: relative;
  isolation: isolate;
  min-width: 0;
  width: 100%;
}

/* The 40 px row every column has under its title: the first card of the first panel stays level with Offen's */
.nps-group__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  min-height: 2.5rem;
  padding-top: 0.5rem;
}

/* The surface is a layer of its own (::before): the group keeps the width of the pair, label and cards the card edge */
.nps-group--panel {
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

  /* The label starts on the cards' left edge; the button sits below the row, the full width of the cards */
  .nps-group__head {
    flex-wrap: wrap;
    padding: 0.75rem max(0.75rem, calc((100% - var(--task-card-max-width)) / 2)) 0.5rem;
  }

  .nps-group__action {
    flex: 1 0 100%;
    justify-content: center;
  }
}
</style>
