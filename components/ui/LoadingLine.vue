<!--
@component LoadingLine
@kind primitive
@category feedback
@description One line that says something is loading: a turning ring and a muted sentence ("Datenbanken werden geladen…"), announced as a status.
@usage <LoadingLine>{{ t('notion.database.loading') }}</LoadingLine>; for a wait inside a field or a section where the content has no skeleton. A button that waits uses `UButton loading`.
@avoid Not a hand-built spinner (`animate-spin` on a `div` or an icon) and not a page-level skeleton; not for progress with a known end.
@responsibility
- One glyph (`i-ph-circle-notch`), one colour (muted text), one size (16 px icon, the body's 14 px text), `role="status"` so a screen reader hears the wait
- The ring turns also under reduced motion: DESIGN.md "Motion" and `main.css` name the spinner (`animate-spin`) a progress exception, not movement (#603)
-->
<template>
  <p class="flex items-center gap-2 text-sm text-muted" role="status">
    <UIcon name="i-ph-circle-notch" class="size-4 shrink-0 animate-spin" aria-hidden="true" />
    <span><slot /></span>
  </p>
</template>

<script setup lang="ts">
defineOptions({ name: 'LoadingLine' })
</script>
