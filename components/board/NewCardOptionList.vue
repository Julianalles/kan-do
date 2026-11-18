<!--
@component NewCardOptionList
@kind component
@category input
@description The list behind the dots icon of the guided new-card flow's Timebox step (kd#16, kd#119): every timebox value, the three pills included
@usage Inside NewCardFlow's popover (desktop) and drawer (phone); the parent owns open/close, the picks and the focus hand-back
@avoid Only inside NewCardFlow's popover or drawer, only for Timebox: Thema and Aktivität are a combobox (UInputMenu, #434); the task sheet's property pickers use TaskPropertySelect.
@responsibility
- Keys: ↑/↓ (wrapping) walk the options, Home/End jump to the first and last; handled keys stop here so no surrounding handler sees them (kd#15)
- Options are native buttons in the select menu's item look (the `selectMenu` theme's `item` slot: padding, text size, the muted highlight; `aria-current` marks the current one), at the field height (44 px in the phone drawer), with one shared handler (not UDropdownMenu: the drawer has no menu primitive, kd#15)
-->
<template>
  <div
    class="flex flex-col gap-0.5"
    :class="large ? 'p-3 pb-6' : ''"
    role="group"
    :aria-label="label"
    data-testid="new-card-more-list"
    @keydown="onKeydown"
  >
    <button
      v-for="value in values"
      :key="value"
      type="button"
      :class="ROW_CLASS"
      :aria-current="value === current ? 'true' : undefined"
      @click="emit('pick', value)"
    >
      <MiddleEllipsis :text="optionLabel(value)" />
    </button>
  </div>
</template>

<script setup lang="ts">
import MiddleEllipsis from '~/components/ui/MiddleEllipsis.vue';

defineOptions({ name: 'NewCardOptionList' });

defineProps<{
  /** The timebox values, in minutes as strings */
  values: readonly string[];
  /** The step's current value, marked `aria-current` */
  current: string | null;
  /** The step's question, the group's name */
  label: string;
  /** What a value reads as ("30 min") */
  optionLabel: (value: string) => string;
  /** The drawer's padding (the rows take their 44 px from the field height) */
  large?: boolean;
}>();

const emit = defineEmits<{
  pick: [value: string];
}>();

/** The select menu's item look, at the field height; the focus ring sits inside the row, a scrolling list would clip it */
const ROW_CLASS =
  'focus-ring flex min-h-(--field-h) w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-left text-sm text-default hover:bg-muted focus-visible:bg-muted focus-visible:-outline-offset-3 aria-current:font-semibold aria-current:text-highlighted';

/** ↑/↓ walk the buttons (wrapping); Home/End jump to the first and last */
function onKeydown(event: KeyboardEvent) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const list = event.currentTarget as HTMLElement;
  const stops = Array.from(list.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  if (!stops.length) return;
  event.preventDefault();
  event.stopPropagation();
  const at = stops.indexOf(document.activeElement as HTMLButtonElement);
  let next: number;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = stops.length - 1;
  else if (event.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % stops.length;
  else next = at < 0 ? stops.length - 1 : (at - 1 + stops.length) % stops.length;
  stops[next]!.focus();
}
</script>
