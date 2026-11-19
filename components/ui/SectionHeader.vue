<!--
@component SectionHeader
@kind primitive
@category layout
@description The one heading of the app below a page title (kd#180): five roles in a closed list, Fraunces for the first four, with the tag, the spacing below and the optional icon.
@usage <SectionHeader tag="h2" :text="…" /> (size `headline`, 22 px, the default: a section of a page or a dialog); `sub` (18 px) for a heading inside a section or a dialog; `display` (36 px) and `hero` (48 px, 36 on a phone) for the welcome and verdict lines; `label` (12 px, the sans, muted) for the caption of a field group in the task sheet, a Mehr group and a form (`tag="label"` with `for`, `tag="legend"` in a fieldset). `tone="muted"` for a heading that must stay quiet (the day-close lists).
@avoid A page title is PageHeader (the column names and the wordmark keep their own CSS); a label on one control is `tag="label"` with `for`, not a second element beside it; never write `font-display` and a size class by hand.
@responsibility
- Render the heading element (`tag`, default `div`; pass `h2` / `h3` for a real heading) with the role's size, face, tracking and line height from the type tokens
- `id` links the heading with `aria-labelledby`
- The `label` role keeps its spacing below by tag (4, 3 or 2; none for `label` and `legend`, the form's `space-y-*` owns that gap); the other roles leave spacing to the host
-->
<template>
  <component
    :is="tag"
    :id="id"
    :class="[ROLE[size], size === 'label' ? (LABEL_MARGIN[tag] ?? 'mb-2') : '', tone === 'muted' || size === 'label' ? 'text-muted' : 'text-highlighted']"
  >
    <UIcon v-if="icon" :name="icon" class="size-4" />
    <slot>{{ text }}</slot>
  </component>
</template>

<script setup lang="ts">
import { SECTION_ROLE } from '~/utils/sectionRoles'
defineOptions({ name: 'SectionHeader' })

withDefaults(defineProps<{
  /** The role: hero 48 px (36 on a phone), display 36, headline 22, sub 18, label 12 */
  size?: 'hero' | 'display' | 'headline' | 'sub' | 'label'
  /** Icon name to display before the text (label role) */
  icon?: string
  /** Text content (alternative to the slot) */
  text?: string
  /** HTML tag to render */
  tag?: 'div' | 'span' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'label' | 'legend'
  /** ID for `aria-labelledby` */
  id?: string
  /** `muted` for a heading that stays quiet */
  tone?: 'default' | 'muted'
}>(), { size: 'headline', tone: 'default', tag: 'div', icon: undefined, text: undefined, id: undefined })

const ROLE = SECTION_ROLE
// The label role's space below by tag; a `label` or `legend` takes none, the form's own spacing (`space-y-*`) sets the gap to its field
const LABEL_MARGIN: Record<string, string> = { h1: 'mb-4', h2: 'mb-3', label: '', legend: '' }
</script>
