<!--
@component IntroNote
@kind component
@category feedback
@description The look every intro note shares (#853): a sheet of pale yellow note paper with an icon, a title in the display face, the note's text and a foot for its controls. It tells a new user what they see and what the next step is, and reads as a note on the desk, unlike any white task card or page sheet.
@usage <IntroNote :icon="…" :title="…" :text="…"><template #lead>…step dots…</template>…links and the main button…</IntroNote>. Used by IntroHintOverlay (the welcome note, the tour and the step hints) and by BoardPlanNote (the planning note of "Alle", for a user of the hints). The caller owns the place, the `role="status"` region, the shadow and what the controls do.
@avoid Not a notice about the board's state (BoardColumnNotice, NewDayNote), not a toast, not an alert (UAlert) and not an empty state (BoardEmptyState, EmptyState). Never for anything but an intro note: the marker yellow as a surface is recorded for this one use (DESIGN.md "The Marker Rule").
@responsibility
- Note paper (user's choice 2A, #853 D2): `--intro-note-paper`, the marker yellow at 30 % in the sheet's white (`assets/css/intro-hint.css`), 16 px corners like every sheet, no border, no tilt, no tape and no neon stroke (#858 designs that). Text is the ink (`--ui-text`); the quiet links use `--intro-note-quiet` (ink at 78 % in the paper, 4.5:1 and more on it) through a local `--ui-text-muted`, so Nuxt UI's link button stays a semantic token
- Build, top to bottom: the icon (20 px, ink, decorative) beside the title (SectionHeader `sub`, 18 px display face) and the text (`text-body`), then the foot: the `lead` slot at its start (the tour's step dots), the default slot at its end (links first, the main button last). On a phone the foot wraps and the controls flow in it directly, each row pushed to the end: the first link shares the row of the step dots, and a caller's `.intro-note-pair` (a link and the main button that belong together) takes the next row as one unit
- The main button is the caller's neutral soft button: its fill is a tint of the ink, so it shows on the paper without a second colour
- No behaviour, no state and no i18n of its own
-->
<template>
  <div class="intro-note flex flex-col gap-1 rounded-lg p-4 pb-2" data-testid="intro-note">
    <div class="flex min-w-0 items-start gap-3">
      <UIcon :name="icon" class="mt-1 size-5 shrink-0" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <SectionHeader tag="p" size="sub" class="text-balance" data-testid="intro-note-title">{{ title }}</SectionHeader>
        <p class="mt-1 text-body text-pretty text-default" data-testid="intro-note-text">{{ text }}</p>
      </div>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-x-2">
      <div class="flex items-center"><slot name="lead" /></div>
      <!-- A phone: the controls flow in the foot itself (`contents`), so the first link shares the row of the step dots -->
      <div class="intro-note-controls ml-auto flex flex-wrap items-center justify-end gap-x-2 max-md:contents">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import SectionHeader from '~/components/ui/SectionHeader.vue'

defineOptions({ name: 'IntroNote' })

defineProps<{
  /** A Phosphor icon (`i-ph-*`); decorative. */
  icon: string
  /** The note's title, one short line. */
  title: string
  /** The note's text. */
  text: string
}>()
</script>
