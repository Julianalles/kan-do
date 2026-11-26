<!--
@component DisclosureCaret
@kind primitive
@category display
@description The one caret of "a block opens in place" (#610): a chevron-down at the trailing end of the block's header that turns 180 degrees over `--duration-slow` while the block opens, and back when it closes.
@usage <DisclosureCaret :open="open" /> as the last child of the header's toggle (a button with `aria-expanded`); the Gestern erledigt note, a Statistik tile, a topic row, a stack's pill. Pair it with a `UCollapsible` panel so the block opens over the same 300 ms.
@avoid Not a menu's or a select's chevron (those open a list that overlays, not a block that pushes its neighbours), not a button of its own (the header's toggle carries the click, `aria-expanded` and the name) and not a leading icon.
@responsibility
- Decorative: `aria-hidden`, never takes a pointer event; the toggle keeps the label and `aria-expanded`
- Rotation is a CSS transition on `--duration-slow` / `--ease-standard` (a host with its own choreography, the stack's pill, sets `--disclosure-caret-duration`); reduced motion makes it instant through the one global rule (DESIGN.md "Motion")
- Muted (`text-muted`), `size-4`, never shrinks; the host places it at the trailing end of the header row. The stack's pill is the one place that sets it smaller (12 px, a 24 px pill); a host with a hover answer of its own darkens it (`group-hover:text-highlighted`, the Statistik tile)
-->
<template>
  <UIcon
    name="i-ph-caret-down"
    class="disclosure-caret size-4 shrink-0 text-muted"
    :class="{ 'disclosure-caret--open': open }"
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
defineOptions({ name: 'DisclosureCaret' })

defineProps<{
  /** The block is open: the chevron points up */
  open: boolean
}>()
</script>

<style scoped>
.disclosure-caret {
  pointer-events: none;
  transition: transform var(--disclosure-caret-duration, var(--duration-slow)) var(--ease-standard);
}

.disclosure-caret--open {
  transform: rotate(180deg);
}
</style>
