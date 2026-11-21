<!--
@component TaskDetailPropertyStrip
@kind compound
@category display
@description The custom (Notion) properties of a task on the desktop sheet (#705): a quiet strip of chips under the title and one "Eigenschaften" button that opens every configured property as an editable row
@usage <TaskDetailPropertyStrip :custom-list="customList" @update="…" /> under the title of the desktop task sheet, when the board has configured properties; the phone drawer lists them as rows after the notes instead
@avoid Only the desktop task sheet's custom properties; the six standard rows are TaskPropertyRow, the rows themselves are TaskDetailCustomFields. Not for editing: a chip is read-only, the popover edits.
@responsibility
- Chips only for entries that hold a value (`customChips`): a multi-select as tag badges, a checked checkbox as its name, every other value as "name value" (name muted); text marked `data-private`
- At most two lines (`max-h-14` over 24 px chips with a 6 px gap); the chips that wrapped past line two are clipped, taken out of the reading order, and counted as "+n" on the button (`hiddenChipCount`, measured on resize and when the chips change); the popover holds them all
- The "Eigenschaften" button shows whenever the board has configured properties, also when none holds a value, so an empty one is always reachable; no entries at all: nothing renders (a Local task, a board without configured properties)
- The popover lists every configured property through TaskDetailCustomFields, set and empty ones as stable rows (the #161 row rule: an empty one shows its empty state, "+ n weitere" never appears), scrolling beyond 24 rem; no heading of its own, the button names it
- Closes on an outside press and on Escape (Escape closes only the popover, the sheet stays); focus returns to the button
- Emits `update` as TaskDetailCustomFields does; it writes nothing itself
-->
<template>
  <div v-if="customList.length > 0" class="flex shrink-0 items-start gap-3 ps-6 pe-6 pb-4" data-testid="task-property-strip">
    <div ref="chipsEl" class="flex max-h-14 min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 overflow-hidden" data-testid="task-property-chips">
      <span
        v-for="(chip, index) in chips"
        :key="chip.key"
        class="inline-flex h-6 max-w-full items-center gap-1.5"
        :aria-hidden="index >= firstHidden ? 'true' : undefined"
        :inert="index >= firstHidden"
        data-private
      >
        <template v-if="chip.tags.length > 0">
          <UBadge v-for="tag in chip.tags" :key="tag" color="neutral" variant="subtle">{{ tag }}</UBadge>
        </template>
        <span v-else class="truncate text-sm">
          <span class="text-muted">{{ chip.name }}</span><template v-if="chip.text"> <span class="text-default">{{ chip.text }}</span></template>
        </span>
      </span>
    </div>

    <UPopover :content="{ align: 'end', sideOffset: 6 }">
      <UButton color="neutral" variant="soft" icon="i-ph-sliders-horizontal" class="shrink-0" data-testid="task-properties-button">
        {{ t('task.field.properties') }}
        <span v-if="hidden > 0" class="tabular-nums text-muted" data-testid="task-properties-more">{{ t('task.detail.propertiesMore', { n: hidden }) }}</span>
      </UButton>
      <template #content>
        <div class="max-h-96 w-96 max-w-[90vw] overflow-y-auto p-3" data-testid="task-properties-popover">
          <TaskDetailCustomFields :custom-list="customList" @update="(key, value) => emit('update', key, value)" />
        </div>
      </template>
    </UPopover>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import TaskDetailCustomFields from '~/components/task/TaskDetailCustomFields.vue';
import { customChips, type CustomDisplayEntry } from '~/composables/useTaskDetail';
import { hiddenChipCount } from '~/utils/chipOverflow';
import type { TaskCustomValue } from '~/types/task';

defineOptions({ name: 'TaskDetailPropertyStrip' });

const props = defineProps<{
  /** Every configured property of the task, set or empty (`useTaskDetail.customList`). */
  customList: CustomDisplayEntry[];
}>();

const emit = defineEmits<{
  (e: 'update', key: string, value: TaskCustomValue): void;
}>();

const { t } = useI18n();

const chips = computed(() => customChips(props.customList));

const chipsEl = ref<HTMLElement | null>(null);
/** Index of the first chip that wrapped past the second line; `chips.length` while all of them fit. */
const firstHidden = ref(Number.MAX_SAFE_INTEGER);
const hidden = computed(() => Math.max(0, chips.value.length - firstHidden.value));

/** The strip's two lines end here: below this height a chip is clipped. */
const measure = () => {
  const el = chipsEl.value;
  if (!el) return;
  const tops = Array.from(el.children, (child) => (child as HTMLElement).offsetTop);
  const limit = el.clientHeight;
  const count = hiddenChipCount(tops, limit);
  firstHidden.value = tops.length - count;
};

let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(measure);
  if (chipsEl.value) observer.observe(chipsEl.value);
  measure();
});
onBeforeUnmount(() => observer?.disconnect());
watch(chips, async () => {
  firstHidden.value = Number.MAX_SAFE_INTEGER;
  await nextTick();
  measure();
}, { flush: 'post' });
</script>
