<!--
@component SetupChipList
@kind component
@category display
@description A wrapping row of small rounded chips with an icon each, for what a setup needs or a schema holds (#441): "Das brauchst du" in the Notion intro, "Nötig" and "Optional" at the database step.
@usage <SetupChipList :label="t('...')" :items="[{ label: t('...'), icon: 'i-ph-key' }]" />; `label` names the list for screen readers.
@avoid Not a choice or a filter (ChoiceChip is a button), not a status marker next to text (UBadge) and not a task property. The chips are plain facts: no click, no state.
@responsibility
- Render the items as a list (`ul` with the label as accessible name), each chip a pill with its icon (muted) and text
- Chips wrap onto further lines; nothing overflows at 390 px
- Pattern: new (no static pill list existed; searched: chip, badge, tag, pill). The look follows ChoiceChip's pill (border, rounded-full, small text) without its interaction
-->
<template>
  <ul class="flex flex-wrap gap-2" :aria-label="label">
    <li
      v-for="item in items"
      :key="item.label"
      class="flex items-center gap-1.5 rounded-full border border-default bg-default py-1 pr-3 pl-2 text-sm text-default"
    >
      <UIcon :name="item.icon" class="size-4 shrink-0 text-muted" aria-hidden="true" />
      {{ item.label }}
    </li>
  </ul>
</template>

<script setup lang="ts">
defineOptions({ name: 'SetupChipList' })

defineProps<{
  /** Accessible name of the list */
  label: string
  items: { label: string; icon: string }[]
}>()
</script>
