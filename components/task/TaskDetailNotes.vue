<!--
@component TaskDetailNotes
@kind component
@category input
@description Notes section of the task detail: rendered Markdown in read mode, a plain textarea while editing
@usage Used by TaskDetailContent as the body of the tab "Notiz" (#870); no label of its own, the tab names it
@avoid Only the notes of the task detail; other long text uses a plain textarea.
@responsibility
- `readonly` (a source that owns the text, #551): the rendered notes without the edit trigger; an empty note has no section at all (nothing to add)
- Read mode renders the notes as sanitized Markdown (utils/renderMarkdown); edit mode stays the textarea
- Written notes use `interactive-display` so links sit beside the edit trigger, not inside role=button (#208); empty notes have no links and keep the plain trigger. The trigger element is replaced when notes flip empty/written; InlineEditable restores keyboard focus to the new one
- Edit affordance (kd#134, agent-decided): empty notes show the at-rest signal of a free value, the muted placeholder with the faint dotted rule (every pointer type, touch too). A written note carries no at-rest mark; hover and keyboard focus show the soft fill, a click or tap anywhere on the text edits. The reason: title and notes are the sheet's content, read far more often than edited, and text you click to edit is the convention for both; the property rows are values, and those look like controls (kd#114). Rejected for a written note: a dotted rule (under every rendered line it is noise, as one line under the block it reads as a row divider), a pencil or "Bearbeiten" at the block's edge (a new glyph grammar beside select and rule on every sheet, and the title would need the same), the fill at rest on touch (a tinted box around body text). Accepted trade-off: on touch a written note and the title show nothing until tapped; revisit both together, never the notes alone
- The edit mode is a bordered textarea, as the topic editor's Name and the add form's fields are bordered inputs: a field of an open form is always editable and looks like an input, a value edited in place looks like its text (InlineEditable `@avoid`). Two situations, not two grammars for one
- The textarea grows with its text (`autoresize`, from six rows: the tab's body is the note's, and six rows with the hint fit it on the sheet without scrolling); a note longer than the tab's body scrolls inside it, the sheet's frame never changes (#870; the guided growth of #846 is gone)
- Save with Cmd+Enter (macOS) or Ctrl+Enter, the hint names the key of the current platform
-->
<template>
  <!-- No label of its own: the tab "Notiz" names it (#870) -->
  <div
    v-if="!readonly || notes"
    data-testid="task-notes"
  >
    <!-- `-mt-1`: the read mode's own padding would set a written note lower than the first row of the other tabs; the editor has no such padding and takes the pull back (`pt-1`) -->
    <div :class="{ '-mt-1': !!notes }">
      <InlineEditable
        data-private
        :model-value="notes"
        :label="t('task.field.notes')"
        :value-text="plainText"
        :placeholder="t('task.detail.notesEmpty')"
        :affordance="notes ? 'fill' : 'rule'"
        :container-class="notes ? '-ms-2' : undefined"
        multiline
        :readonly="readonly"
        :interactive-display="!!notes"
        @save="(val) => emit('save', val as string)"
      >
        <template #display>
          <!-- eslint-disable-next-line vue/no-v-html -- sanitized by renderMarkdown (DOMPurify, small tag allow-list) -->
          <div v-if="notes" class="task-notes-markdown min-w-0 flex-1 py-1" data-testid="task-notes-rendered" v-html="html" />
          <span v-else class="text-muted not-italic">{{ t('task.detail.notesEmpty') }}</span>
        </template>
        <template #edit="{ value, setValue, finishEdit, commitEdit, cancelEdit }">
          <div :class="{ 'pt-1': !!notes }">
          <UTextarea
            :model-value="(value as string) || ''"
            autofocus
            :rows="6"
            autoresize
            class="w-full"
            :placeholder="t('task.detail.notesPlaceholder')"
            data-testid="task-notes-input"
            @update:model-value="(val) => setValue(val)"
            @blur="finishEdit"
            @keydown="(event: KeyboardEvent) => { if (isSubmitShortcut(event)) commitEdit(); }"
            @keydown.esc.stop="cancelEdit"
          />
          <div class="mt-1 text-right text-xs text-muted" data-testid="task-notes-hint">
            {{ t('task.detail.notesHint', { shortcut: submitShortcut }) }}
          </div>
          </div>
        </template>
      </InlineEditable>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import InlineEditable from '~/components/ui/inline/InlineEditable.vue';
import { renderMarkdown } from '~/utils/renderMarkdown';
import { isSubmitShortcut, usePlatformShortcut } from '~/composables/usePlatformShortcut';

defineOptions({ name: 'TaskDetailNotes' });

const props = withDefaults(defineProps<{
  /** Notes as Markdown source; empty shows the placeholder */
  notes?: string | null;
  /** The notes belong to the task's source (Reminders, #551): shown as text, no editor */
  readonly?: boolean;
}>(), {
  notes: null,
  readonly: false,
});

const emit = defineEmits<{
  save: [value: string];
}>();

const { t } = useI18n();
const { submitShortcut } = usePlatformShortcut();

const html = computed(() => (props.notes ? renderMarkdown(props.notes) : ''));

/** The trigger's accessible name speaks the text, not the markup ("**fett**" is read as "fett"). */
const plainText = computed(() => {
  if (!props.notes || typeof DOMParser === 'undefined') return undefined;
  return new DOMParser().parseFromString(html.value, 'text/html').body.textContent?.trim() || undefined;
});
</script>
