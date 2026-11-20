<!--
@component SetupRail
@kind component
@category navigation
@description Guide rail of a multi-step setup on a page (#43): a vertical rail with one-line help at md and up, a label
  plus "n / m", a progress bar and the help below md. Non-interactive: the steps validate in order.
@usage <SetupRail :steps="[{ key, label }]" :current="2" :help="text" :label="t('notion.modal.stepsLabel')" />
@avoid Progress of a multi-step setup page; not a tab bar and not interactive.
@responsibility
- Shows done, current and todo steps (state in data-state, aria-current on the current one, a screen-reader "done" on finished ones)
- Pattern: step progress, new (guide rail). Replaces the dialog stepper of the Notion modal for the welcome page only
- `helpLines` (the shell passes 4) reserves that many lines for the help at md and up, so a longer or shorter help never changes the rail height and moves the footer (#649)
- Below md the step's help sits under the bar too (#665: on the Notion token step it is the privacy line); it reserves up to three lines so the pane never moves with the help's length
- Reduced motion: dot, line and bar changes are instant
-->
<template>
  <div>
    <!-- Below md: label, n / m and a bar -->
    <div class="flex flex-col gap-2 md:hidden" data-testid="setup-progress">
      <div class="flex items-baseline justify-between text-sm">
        <span class="font-medium text-highlighted">{{ steps[current]?.label }}</span>
        <span class="text-muted">{{ current + 1 }} / {{ steps.length }}</span>
      </div>
      <div
        class="h-1 overflow-hidden rounded-full bg-accented"
        role="progressbar"
        :aria-label="label"
        :aria-valuemin="1"
        :aria-valuemax="steps.length"
        :aria-valuenow="current + 1"
      >
        <div
          class="h-full rounded-full bg-inverted transition-[width] duration-(--duration-slow) ease-(--ease-emphasized) motion-reduce:transition-none"
          :style="{ width: `${((current + 1) / steps.length) * 100}%` }"
        />
      </div>
    </div>

    <!-- From md: the rail with the help text under it -->
    <div class="hidden md:block">
      <ol :aria-label="label" data-testid="notion-setup-steps" class="flex flex-col gap-5">
        <li
          v-for="(step, index) in steps"
          :key="step.key"
          class="setup-rail-item relative flex items-center gap-3"
          :aria-current="index === current ? 'step' : undefined"
          :data-state="index < current ? 'done' : index === current ? 'active' : 'todo'"
        >
          <span
            class="flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors duration-(--duration-base) motion-reduce:transition-none"
            :class="index <= current ? 'bg-inverted text-inverted' : 'bg-accented text-muted'"
            aria-hidden="true"
          >
            <UIcon v-if="index < current" name="i-ph-check-bold" class="size-3" />
            <template v-else>{{ index + 1 }}</template>
          </span>
          <span class="text-sm" :class="index === current ? 'font-medium text-highlighted' : index < current ? 'text-default' : 'text-muted'">
            {{ step.label }}
            <span v-if="index < current" class="sr-only">{{ doneLabel }}</span>
          </span>
        </li>
      </ol>
    </div>

    <!-- One help for both layouts (#665: below md it sits under the bar, from md under the rail; one element so a text query finds it once). It reserves lines so a longer or shorter help never moves what sits under it: four from md, three below -->
    <p
      v-if="help"
      class="mt-2 min-h-[calc(var(--help-lines-phone,0)*1lh)] text-sm text-muted md:mt-6 md:min-h-[calc(var(--help-lines,0)*1lh+1rem+1px)] md:border-t md:border-default md:pt-4 md:text-body"
      :style="helpLines ? { '--help-lines': helpLines, '--help-lines-phone': phoneHelpLines } : undefined"
      aria-live="polite"
      data-testid="setup-progress-help"
    >{{ help }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

defineOptions({ name: 'SetupRail' });

const props = defineProps<{
  steps: { key: string; label: string }[];
  /** Zero-based index of the current step */
  current: number;
  help?: string;
  /** Reserve this many lines for the help (md and up), so a longer or shorter help never changes the rail's height and moves what sits under it (#649) */
  helpLines?: number;
  label: string;
  doneLabel: string;
}>();

/** The phone help is smaller text on a narrow column: reserve fewer lines than md and up (measured at 390 px) */
const phoneHelpLines = computed(() => Math.min(props.helpLines ?? 0, 3));
</script>

<style scoped>
/* The line between two dots; the current item's line takes the "done" colour once it is passed */
.setup-rail-item:not(:last-child)::after {
  content: '';
  position: absolute;
  left: 0.6875rem;
  top: 1.75rem;
  width: 2px;
  height: 1.25rem;
  background: var(--ui-bg-accented);
  transition: background-color var(--duration-slow);
}
.setup-rail-item[data-state='done']:not(:last-child)::after {
  background: var(--ui-bg-inverted);
}
</style>
