<!--
@component SegmentedChoice
@kind primitive
@category input
@description A quiet segmented group for "pick one of a few short words" that sits several times on one view (the answer per Reminders list, #552): a muted track with the picked segment lifted onto the page surface with a hairline, never a green fill.
@usage <SegmentedChoice v-model="role" :options="[{ value: 'topic', label: 'Thema' }, { value: 'off', label: 'Aus' }]" :label="t('…choiceLabel', { list })" item-testid="rem-role" />; `label` names the radio group for screen readers; `item-testid` becomes `<item-testid>-<value>` on each segment.
@avoid Not for a single answer in a flow (ChoiceChip: its picked state is the solid primary, so five rows of it would be five lamps), not for options with a description (ChoiceCard) and not for switching a view (tabs, the app bar's pill).
@responsibility
- One reka `RadioGroupRoot` (role `radiogroup`): one Tab stop, arrow keys move and pick, each segment is a `role="radio"` button
- The picked segment is a lifted fill (page surface, a hairline, medium weight; no shadow: a control inside a sheet never casts one): The One Lamp Rule allows one solid green per view, so no option here is green
- Segments are `--field-h` high (36 px, 44 px on a phone, the touch target) and keep their words on one line; the group does not grow with its host (`inline-flex`)
- `disabled` dims the whole group and takes it out of the tab order
- Pattern: pick one of a few words, diverged from ChoiceChip (solid picked fill): five lists would have shown five solid greens (The One Lamp Rule); the look follows UTabs `variant="pill"` (a muted track, the picked option a raised light chip) but is a radio group (arrow keys, one answer per list) and not navigation
-->
<template>
  <RadioGroupRoot
    v-model="model"
    class="segmented-choice"
    :aria-label="label"
    :disabled="disabled"
    orientation="horizontal"
    :loop="true"
  >
    <RadioGroupItem
      v-for="option in options"
      :key="option.value"
      :value="option.value"
      class="segmented-choice__item focus-ring"
      :data-testid="itemTestid ? `${itemTestid}-${option.value}` : undefined"
    >
      {{ option.label }}
    </RadioGroupItem>
  </RadioGroupRoot>
</template>

<script setup lang="ts" generic="T extends string">
import { RadioGroupItem, RadioGroupRoot } from 'reka-ui';

defineOptions({ name: 'SegmentedChoice' });

defineProps<{
  options: ReadonlyArray<{ value: T; label: string }>;
  /** Names the group for screen readers */
  label: string;
  disabled?: boolean;
  itemTestid?: string;
}>();

const model = defineModel<T>({ required: true });
</script>

<style scoped>
.segmented-choice {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 9999px;
  background: var(--ui-bg-muted);
}
.segmented-choice[data-disabled] {
  opacity: 0.6;
}
.segmented-choice__item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: calc(var(--field-h) - 4px);
  padding: 0 0.75rem;
  border-radius: 9999px;
  font-size: var(--text-sm);
  font-weight: 400;
  line-height: var(--lh-snug);
  color: var(--ui-text-muted);
  white-space: nowrap;
  transition: background-color var(--duration-fast), color var(--duration-fast);
}
.segmented-choice__item:hover:not([data-state='checked']):not([data-disabled]) {
  color: var(--ui-text-highlighted);
}
.segmented-choice__item[data-state='checked'] {
  background: var(--ui-bg);
  color: var(--ui-text-highlighted);
  font-weight: 500;
  box-shadow: 0 0 0 1px var(--ui-border-accented);
}
/* Phone: the track spans its row, so the segments share it (three full-width targets, not a left-packed tail) */
@media (--phone) {
  .segmented-choice {
    display: flex;
  }
  .segmented-choice__item {
    flex: 1;
  }
}
</style>
