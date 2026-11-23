<!--
@component TaskSourceIcon
@kind primitive
@category display
@description The source a task belongs to, as a 16px muted icon (#323)
@usage <TaskSourceIcon :source="task.source" /> at the start of the TaskCard footer, only on a board that holds tasks from 2+ sources
@avoid Only on a board with tasks from 2+ sources.
@responsibility
- Maps a source to its bundled icon (all `ph`, no remote fetch, ADR 012; never a Notion or Todoist logo: plain-text names only, #745)
- Names the source for assistive tech ("Lokal", "Notion", "Erinnerungen") and for hover; shows no visible text
- Is not focusable and not interactive, so it adds no tab stop and is no drag handle
-->
<template>
  <UIcon
    :name="meta.icon"
    class="task-source-icon size-4 shrink-0 text-muted"
    role="img"
    :aria-label="label"
    :title="label"
    data-testid="task-source-icon"
    :data-source="source"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SourceId } from '~/types/taskSource'
import { sourceMetaOf } from '~/utils/sourceMeta'

defineOptions({ name: 'TaskSourceIcon' })

const props = defineProps<{
  /** Source of the task the icon sits on */
  source: SourceId
}>()

const { t } = useI18n()
const meta = computed(() => sourceMetaOf(props.source))
const label = computed(() => t(meta.value.nameKey))
</script>
