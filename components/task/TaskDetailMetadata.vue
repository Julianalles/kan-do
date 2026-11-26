<!--
@component TaskDetailMetadata
@kind component
@category display
@description The footer line of the task detail: where the task lives (source icon and name) and when it was created
@usage <TaskDetailMetadata :source="'Notion'" icon="i-ph-notebook" created-at="25.11.2026" /> as the last line of TaskDetailContent, on the sheet and in the drawer
@avoid Only the task detail's footer line. Not a place for controls or actions (those are rows of the grid or entries of TaskSheetMenu), and never an expandable block (#846).
@responsibility
- One quiet line (`text-xs text-muted`) that is always there (#846, user: no expandable block, which reverses the collapsible Metadaten of #244 and #594): the source with its icon, then the creation date as a date without the time of day
- Each fact is its own element, no separator character (#594); the line wraps on a narrow drawer
- The id is not shown: the task menu copies it (TaskSheetMenu, #846)
- Read-only text, no heading: the facts need no name and the section is no stop for heading navigation
-->
<template>
  <p class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" data-testid="task-metadata">
    <span class="flex items-center gap-1.5" data-testid="task-detail-source">
      <UIcon :name="icon" class="size-4 shrink-0" aria-hidden="true" />
      {{ source ?? t('task.detail.sourceLocal') }}
    </span>
    <span data-testid="task-detail-created">{{ t('task.detail.created', { date: createdAt }) }}</span>
  </p>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

defineOptions({ name: 'TaskDetailMetadata' });

const { t } = useI18n();

withDefaults(defineProps<{
  /** Source label (e.g. "Notion"); null for a local task */
  source?: string | null;
  /** The source's bundled icon (`SOURCE_META`) */
  icon: string;
  /** Creation date, already formatted for display (date only) */
  createdAt: string;
}>(), {
  source: null,
});
</script>
