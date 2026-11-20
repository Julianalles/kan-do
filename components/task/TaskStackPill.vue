<!--
@component TaskStackPill
@kind primitive
@category display
@description The face of a collapsed stack's pill (#504): one split capsule, "<property> | <stack icon> <n>"
@usage Inside the aria-hidden pill layer of a collapsed TaskStack, centred on the front card
@avoid Only the face of a collapsed stack's pill inside TaskStack.
@responsibility
- Left segment names the grouping property the way a card shows it: topic = TopicMark + neutral name (hue only on
  the mark); priority 1-3 = the real TaskPriorityBadge as the segment itself (no hairline after it); activity,
  custom/Notion value and the empty group = the plain name
- Right segment is the stack icon (`i-ph-stack`), the count and the trailing `DisclosureCaret` (#610: a stack is a block that opens, the chevron points down on the face and up on the header's pill, `open`); it never shrinks, a large count widens it only
- The property segment is capped at 10rem and is cut in the middle (`MiddleEllipsis`, kd#119: stacks of "Karriere: Bewerbung" and
  "Karriere: Weiterbildung" stay apart; the cap is a look decision, tune here); the full
  name stays in the stack control's accessible name, so there is no tooltip. The pill is decorative: the
  visible word "Aufgaben" is gone, the control still says it
- Soft neutral like the former text pill (`--fill-on-canvas`, label role 500 / 0.75rem), 1.5rem
  high, fully rounded outer shape, a 1px hairline between the segments
- Never takes a pointer event (its layer is `pointer-events: none`)
-->
<template>
  <span class="task-stack-pill" :data-prop-kind="kind">
    <span class="task-stack-pill__prop" :class="{ 'task-stack-pill__prop--priority': kind === 'priority' }">
      <task-priority-badge v-if="kind === 'priority'" :priority="Number(groupKey)" />
      <template v-else>
        <topic-mark v-if="kind === 'topic'" :topic="firstTask?.topic" :task="firstTask" />
        <MiddleEllipsis class="task-stack-pill__text" :text="label" data-private />
      </template>
    </span>
    <span class="task-stack-pill__count">
      <u-icon name="i-ph-stack" class="task-stack-pill__icon" />
      <span data-private>{{ count }}</span>
      <!-- The chevron turns with the stack's own motion, not the 300 ms of a block that opens (#610) -->
      <DisclosureCaret :open="open" class="task-stack-pill__caret [--disclosure-caret-duration:var(--stack-transition-duration)]" />
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import TopicMark from "~/components/topic/TopicMark.vue";
import MiddleEllipsis from "~/components/ui/MiddleEllipsis.vue";
import DisclosureCaret from "~/components/ui/DisclosureCaret.vue";
import TaskPriorityBadge from "~/components/task/TaskPriorityBadge.vue";
import { useBoardGrouping } from "~/composables/useBoardGrouping";
import { PRIORITY_LABEL_KEYS } from "~/utils/taskStatusMappings";
import { EMPTY_GROUP_KEY } from "~/utils/taskGrouping";
import type { Task } from "~/types/task";

defineOptions({ name: "TaskStackPill" });

const props = withDefaults(defineProps<{
  /** Group key of the stack (priority level, topic name, ...) */
  groupKey: string;
  /** Readable group name (the plain-name fallback and the topic's name) */
  label: string;
  /** Number of tasks in the stack */
  count: number;
  /** The stack's front task: the topic mark reads its topic and source */
  firstTask?: Task | undefined;
  /** The stack is expanded (the header's pill): the chevron points up */
  open?: boolean;
}>(), { open: false });

const { effectiveGroupKey } = useBoardGrouping();

/** How the property segment is drawn */
const kind = computed<"topic" | "priority" | "plain">(() => {
  if (props.groupKey === EMPTY_GROUP_KEY) return "plain";
  if (effectiveGroupKey.value === "topic") return "topic";
  if (effectiveGroupKey.value === "priority" && Number(props.groupKey) in PRIORITY_LABEL_KEYS) return "priority";
  return "plain";
});
</script>

<style scoped>
/* Label role (DESIGN.md "Type"): 500, 0.75rem, 1.3; text on the canvas fill as the former text pill */
.task-stack-pill {
  display: inline-flex;
  align-items: center;
  max-width: 94%;
  min-width: 0;
  overflow: hidden;
  border-radius: 9999px;
  font-size: var(--text-label);
  font-weight: 500;
  line-height: var(--lh-snug);
  color: var(--ui-text);
}

.task-stack-pill__prop,
.task-stack-pill__count {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  height: 1.5rem;
  background-color: var(--fill-on-canvas);
  white-space: nowrap;
}

/* Property: shrinks first, capped at 10rem (160px); MiddleEllipsis cuts the name */
.task-stack-pill__prop {
  min-width: 0;
  max-width: 10rem;
  padding-inline: 0.5rem;
}

.task-stack-pill__text {
  min-width: 0;
}

/* Count: never shrinks; the hairline separates it from the property */
.task-stack-pill__count {
  flex: none;
  gap: 0.25rem;
  padding-inline: 0.5rem;
  border-inline-start: 1px solid var(--ui-border-accented);
  font-variant-numeric: tabular-nums;
}

.task-stack-pill__icon, .task-stack-pill__caret {
  width: 0.75rem;
  height: 0.75rem;
}

/* The priority badge is the segment itself: its own tint, no extra padding, no hairline after it */
.task-stack-pill__prop--priority {
  padding: 0;
  background: none;
}

.task-stack-pill__prop--priority :deep(.priority) {
  height: 1.5rem;
  padding-inline: 0.5rem;
  border-radius: 0;
  font-size: inherit;
}

.task-stack-pill__prop--priority + .task-stack-pill__count {
  border-inline-start: 0;
}
</style>
