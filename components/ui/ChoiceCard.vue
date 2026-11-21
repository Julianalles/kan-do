<!--
@component ChoiceCard
@kind primitive
@category input
@description The one card for a bigger choice (kd#178): a full-width answer row with an icon, a label, an optional hint line and a mark at the end. Three forms: a go-on card (opens something), a radio card (one answer of a group) and a checkbox card (one of several apps, #651). Consumers: the sync warning (radio cards) and the first-run step of the welcome sheet (checkbox cards).
@usage <ChoiceCard icon="i-ph-desktop" @click="open">{{ label }}</ChoiceCard> (the mark at the end is the go-on arrow); inside a `RadioGroupRoot` give it a `value` and it is a radio card (the mark is the radio dot): <ChoiceCard value="fresh" icon="i-ph-plus-circle"><template #hint>{{ hint }}</template>{{ label }}</ChoiceCard>; with `v-model` it is a checkbox card, one of several answers that are ticked on their own, in a `<fieldset>` with a legend: <ChoiceCard v-model="notion" icon="i-simple-icons-notion"><template #hint>{{ hint }}</template>Notion</ChoiceCard> (the icon sits in a tile, the mark is a square with a check). A card that cannot be picked gets `disabled` and its reason as the hint. Attributes (`data-testid`, `aria-*`, `disabled`) and the click land on the control.
@avoid Not for a pick among a few short words (ChoiceChip), not for an action in a row (UButton) and not for an option inside a list (the select menu's item). A card that opens something never carries a filled look: no answer is the primary one; the wash is the checked state of a radio or checkbox card only. Not for one yes/no setting beside a sentence (USwitch, UCheckbox).
@responsibility
- Render one native `<button>`, a reka `RadioGroupItem` (a button with `role="radio"`) when `value` is set, or a reka `CheckboxRoot` (a button with `role="checkbox"`, `aria-checked`, Space toggles) when it has a `v-model`; the host owns the group (arrow keys and one Tab stop for radios, a fieldset with a legend for checkboxes) and the meaning of a click
- One shell: 64 px minimum, 12 px corners (the radius of buttons and fields, DESIGN.md "Radius"), a hairline border that darkens on hover; a radio or checkbox card that is checked is a fill, the primary wash with a primary border and mark and ink text (DESIGN.md "States": selected is a fill; The One Lamp Rule: green without a solid fill, the one solid green stays the confirm button). Only a checked card is filled: no go-on answer is filled
- The mark at the end is the only difference between the go-on and the radio form: the go-on arrow (an answer that opens something), the radio dot (an answer that waits for a confirmation). The checkbox form is a square with a check (never the radio dot: several can be ticked); selection is the check and the wash, never colour alone
- The checkbox form puts its icon in a 40 px tile, so a service icon and a stand-in glyph (an app without an official icon in the bundled sets) read as the same kind of mark
- A disabled card stays in the page, is not focusable, and its hint (the reason) is part of its accessible name, so a screen reader announces why
- Visible focus halo (`focus-ring`); the press, the hand cursor and the disabled look come from the base layer (DESIGN.md "States")
-->
<template>
  <component
    :is="control"
    v-bind="controlProps"
    class="group focus-ring flex min-h-16 w-full items-center gap-4 rounded-md border border-default bg-elevated px-4 py-2 text-left not-data-[state=checked]:not-data-disabled:hover:border-accented data-[state=checked]:border-primary data-[state=checked]:bg-primary/10"
  >
    <span
      v-if="isCheckbox"
      class="flex size-10 shrink-0 items-center justify-center rounded-md border border-default bg-default"
      aria-hidden="true"
    >
      <UIcon :name="icon" class="size-6 text-highlighted" />
    </span>
    <UIcon v-else :name="icon" class="size-6 shrink-0 text-toned group-data-[state=checked]:text-primary" aria-hidden="true" />
    <span class="min-w-0 flex-1">
      <span class="block text-lg font-medium text-highlighted"><slot /></span>
      <span v-if="$slots.hint" class="block text-sm text-muted"><slot name="hint" /></span>
    </span>
    <span
      v-if="isCheckbox"
      class="flex size-6 shrink-0 items-center justify-center rounded-sm border-[1.5px] border-accented text-primary group-data-[state=checked]:border-primary"
      aria-hidden="true"
    >
      <UIcon name="i-ph-check-bold" class="size-4 scale-0 transition-transform duration-(--duration-fast) group-data-[state=checked]:scale-100 motion-reduce:transition-none" />
    </span>
    <span
      v-else-if="isRadio"
      class="flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-accented group-data-[state=checked]:border-primary"
      aria-hidden="true"
    >
      <span class="size-2 scale-0 rounded-full bg-primary transition-transform duration-(--duration-fast) group-data-[state=checked]:scale-100 motion-reduce:transition-none" />
    </span>
    <UIcon v-else :name="ICONS.goOn" class="size-5 shrink-0 text-muted" aria-hidden="true" />
  </component>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { CheckboxRoot, RadioGroupItem } from 'reka-ui';
import { ICONS } from '~/lib/icons';

defineOptions({ name: 'ChoiceCard' });

const props = defineProps<{
  /** The icon before the label (a bundled icon name: a Phosphor or a service icon) */
  icon: string;
  /** Makes it a radio card: the value inside the surrounding `RadioGroupRoot` */
  value?: string;
}>();

/** Makes it a checkbox card: whether it is ticked (absent: not a checkbox card) */
const checked = defineModel<boolean | undefined>({ default: undefined });

defineSlots<{
  default(): unknown;
  /** The line under the label (the reason, on a disabled card) */
  hint?(): unknown;
}>();

const isRadio = computed(() => props.value !== undefined);
const isCheckbox = computed(() => checked.value !== undefined);
const control = computed(() => (isCheckbox.value ? CheckboxRoot : isRadio.value ? RadioGroupItem : 'button'));
const controlProps = computed(() => {
  if (isCheckbox.value) return { modelValue: checked.value, 'onUpdate:modelValue': (next: boolean | 'indeterminate') => { checked.value = next === true } };
  return isRadio.value ? { value: props.value } : { type: 'button' };
});
</script>
