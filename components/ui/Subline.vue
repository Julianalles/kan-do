<!--
@component Subline
@kind primitive
@category display
@description The statement under a brand or a large title (#437): one muted line of body text, larger than running text (18 px), that says what the thing above it is for.
@usage <Subline>{{ t('onboarding.page.tagline') }}</Subline>; spacing and alignment come from the call site's `class`. `tag` for another element than the paragraph.
@avoid Not a heading (SectionHeader), not a one-sentence empty state (EmptyNote) and not a field hint or help line (muted small text of its own form). It keeps one size; a quieter or larger line is a different job.
@responsibility
- Render the slot (or `text`) as muted 18 px text with a calm line height, balanced across lines, nothing else: no icon, no link, no action
- Pass attributes and the call site's class through to the element
- Contrast: it sits on the paper canvas and on the welcome photo's bright wall (DESIGN.md "The Bright Ground Rule": AA is checked there on the rendered page)
-->
<template>
  <component :is="tag" class="text-lg text-balance text-muted">
    <slot>{{ text }}</slot>
  </component>
</template>

<script setup lang="ts">
defineOptions({ name: 'Subline' })

withDefaults(defineProps<{
  /** Text content (alternative to the slot) */
  text?: string
  /** HTML tag to render */
  tag?: 'p' | 'div' | 'span'
}>(), { text: undefined, tag: 'p' })
</script>
