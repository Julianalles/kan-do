<!--
@component TaskDetailMetadata
@kind component
@category display
@description Metadata section of the task detail (source, created, id), collapsed by default
@usage Used by TaskDetailContent; the left of the last line of the desktop sheet (#468), last in the flow on mobile (#386)
@avoid Only the collapsed metadata section of the task detail.
@responsibility
- Quiet collapsible with the source, the creation date and the stable task id, each fact its own element, no separator character (#594); the id stays, #244 made Metadaten the one place it is readable
- The chevron sits right beside the label, open or closed: the trigger is as wide as its label, so opening moves nothing (#594)
- The host places it: with the action row on the sheet's last line (no hairline, no band), in the flow on mobile (#244)
- The open state is a v-model owned by the parent; an expanded one grows the sheet downwards
-->
<template>
  <section class="task-detail-section" data-testid="task-metadata">
    <UCollapsible v-model:open="open">
      <UButton
        variant="ghost"
        color="neutral"
        class="group/meta justify-start gap-1.5 px-0 hover:bg-transparent"
      >
        <SectionHeader :text="t('task.detail.metadata')" tag="h3" size="label" class="mb-0" />
        <template #trailing>
          <UIcon
            name="i-ph-caret-down"
            class="size-4  text-muted transition-transform duration-(--duration-base)"
            :class="{ 'rotate-180': open }"
          />
        </template>
      </UButton>

      <template #content>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 pt-3 text-xs text-muted">
          <span data-testid="task-detail-source">{{ source ?? t('task.detail.sourceLocal') }}</span>
          <span>{{ t('task.detail.created', { date: createdAt }) }}</span>
          <span class="select-all">{{ taskId }}</span>
        </div>
      </template>
    </UCollapsible>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import SectionHeader from '~/components/ui/SectionHeader.vue';

defineOptions({ name: 'TaskDetailMetadata' });

const { t } = useI18n();

withDefaults(defineProps<{
  /** Source label (e.g. "Notion"); null for a local task */
  source?: string | null;
  /** Creation date, already formatted for display */
  createdAt: string;
  /** Stable app-level task id */
  taskId: string;
}>(), {
  source: null,
});

const open = defineModel<boolean>('open', { default: false });
</script>
