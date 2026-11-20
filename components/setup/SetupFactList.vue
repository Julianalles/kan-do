<!--
@component SetupFactList
@kind component
@category display
@description A wrapping row of neutral badges with an icon each, for what a setup needs or a schema holds (#441, #649): "Das brauchst du" in the Notion intro, "Nötig" and "Optional" at the database step.
@usage <SetupFactList :label="t('...')" :items="[{ label: t('...'), icon: 'i-ph-key' }]" />; `label` names the list for screen readers.
@avoid Not a choice or a filter (ChoiceChip is a button) and not a task property. The badges are plain facts: no click, no state, and no border pill that reads as a button.
@responsibility
- Render the items as a list (`ul` with the label as accessible name), each a neutral soft `UBadge` with its icon
- Badges wrap onto further lines; nothing overflows at 390 px
- Pattern: reused UBadge (neutral, soft, the one size); the list only wraps and names them
-->
<template>
  <ul class="flex flex-wrap gap-2" :aria-label="label">
    <li v-for="item in items" :key="item.label">
      <UBadge color="neutral" variant="soft" :icon="item.icon" :label="item.label" />
    </li>
  </ul>
</template>

<script setup lang="ts">
defineOptions({ name: 'SetupFactList' })

defineProps<{
  /** Accessible name of the list */
  label: string
  items: { label: string; icon: string }[]
}>()
</script>
