<!--
@component NewCardFlow
@kind block
@category input
@description Guided in-card adding of a task in Offen (#649) and, on the place "Alle", under "Meine Aufgaben" (#567, the task is made not planned, #367): the add slot's box becomes a card that takes the title, then asks Thema and Aktivität (a combobox each), Timebox (pills) and Notiz one after another and saves at the end. No sheet, no route change.
@usage Mounted by AddTaskSlot (Offen; on "Alle" the slot at the top of BoardNotPlanned) in place of the sheet; emits `saved` with the new task's id, or `cancel`
@avoid Only in-card adding to Offen or "Meine Aufgaben"; add-and-start in Jetzt, editing and source fields use the sheet's TaskForm.
@responsibility
- Local state only (title, topic, activity, timebox, notes, step): it does not use `useTaskDraft`, which belongs to the sheet (draft card, spotlight, /tasks/add); saves through `useTaskSync().createTask` in the default source (`useAddTarget`), steps follow that source's fields (`fieldsForSource`); a step with nothing to offer is skipped
- The face is the real TaskCard (`draft`), so the saved card and the cue behind the wash match by construction; the topic row exists only once a topic is picked (the title steps down then, as on a card)
- Title step (no wash): the field is a textarea that grows with the title (#665; Enter confirms, line breaks become spaces, at most as tall as the face's title, which is what the card shows of it (a long title is clamped there), then it scrolls) and stands where the face's title stands: on the card body padding, or below the topic row once a topic is picked (measured from the face, #668: going back with a topic must not overlap it). The face's own title is hidden there, so the field is the only text; it keeps the field's right padding so both wrap alike. The confirm check is centred vertically on the card, on the line where the answer rows of the later steps stand, so the button controls keep one height; the field keeps the check's width clear (accepted: a short title wraps a few characters earlier)
- Steps (one question at a time, over the card): the card is plain and solid (#434: the veil is `--ui-bg-elevated`, the face's text and topic mark are hidden behind it, the face only sizes the card and is what the save hands over to). Head on the card padding: back left (soft icon button, Esc chip), the question, forward right (soft icon-only button, Enter chip; none on Notiz); the answers under it. Thema and Aktivität are one combobox (`UInputMenu`, #434, below); Timebox keeps its 2×2 grid, `[1] [2] / [3] [··· 4]` (kd#119: 15, 30 and 60 min without a history suggestion; `timeboxStep`), the chips (`ChoiceChip`, the field height, which is also the control height of the whole flow, `--ncf-control-h`) carrying the name and the key cue only. The steps stay as tall as before (kd#178): the face's min-height is derived from the head, two control rows and the room under them (`--ncf-control-h`, `--ncf-grid-top`, `--ncf-grid-bottom`), so the one-row combobox does not make the card jump. Notiz is an input plus a check on the vertical centre; Enter saves. The step slides sideways (140 ms) into the next
- A pick pulses the veil once (a cue on Notiz); saving lifts the veil and the face becomes the saved card
- Keys: Enter skips (saves on Notiz), Esc goes back from anywhere, also with the combobox's list open (cancels on the title step; with a typed title the slot offers "Rückgängig" in a toast, #665), Cmd/Ctrl+Enter saves now with what is entered, from any step once there is a title (#665; announced by `aria-keyshortcuts` and the check's title). Timebox: 1/2/3 pick, 4 opens the list (the dots icon). Thema and Aktivität have no number keys (digits are text in the field), and Backspace/Delete only edit text (#434). Key cues sit inside the buttons (generated content, so the accessible name stays the label), fine pointers only. Tab order is the DOM order; every step change moves focus to the step (the combobox's field, Notiz: its input)
- A press outside cancels only while the title is blank (a press on a card, in Offen or under "Meine Aufgaben", waits for its release, a drag keeps the card); a save error keeps the card where it was (Notiz after Enter) with everything entered; the toast after a save is one row (title and Details, #665) so it stays clear of the saved card at 390 px
- Thema and Aktivität (#434): a combobox on the step's whole ranked list (`UInputMenu`: type to filter, the list opens below the field on focus and closes on pick, Esc-back and blur, 5 rows, then it scrolls; the cap follows the visual viewport, so the on-screen keyboard never covers it; app.config.ts `inputMenu` holds the field height, the rows (44 px on a phone) and the sheet look). The field shows the step's value; deleting the text or the clear button takes the value away. Enter takes an entry the user walked to with the arrows (the list highlights its first entry by itself, which is no choice); on an empty field it continues without a value; typed text with a match takes an exact match (any case), else the first match, else a "Neu: „text“" row creates it where the source allows free values (`fieldsForSource(...).newValues`: Local any text, Notion without commas and at most 100 characters, so the row shows what is created; Todoist none, then the field only filters). A step with no values at all is still skipped; the sheet creates a first topic. The new value is just a pick: Local derives topics from tasks, Notion creates the select option on the write (`NotionIntegration` writes the property's own type)
- The dots icon's list (Timebox only): popover from 768 px, drawer below (`NewCardOptionList`); ↑/↓ (wrapping) walk the options, Home/End jump, Enter/Space pick, Esc closes (kd#15; plain buttons with one shared handler, not UDropdownMenu: the drawer has no menu primitive and the key-4 focus flow (#685) stays). Motion is instant under prefers-reduced-motion
- Accepted: unsaved input is lost when the page is left (the card saves only at the end, as the story asks); activity and note have no place on a card, so only the field and the pulse show them; the combobox's list is a popover over the card below it (a transient overlay, #434)
-->
<template>
  <div
    ref="rootEl"
    class="ncf"
    :class="{ 'is-steps': phase === 'steps', 'is-saving': saving }"
    role="group"
    :aria-label="t('board.quickAdd.label')"
    data-testid="new-card-flow"
    aria-keyshortcuts="Control+Enter Meta+Enter"
    @keydown="onKeydown"
  >
    <!-- The face: the real card, only a picture -->
    <div ref="faceEl" class="ncf__face" aria-hidden="true" inert>
      <task-card :task="faceTask" draft />
    </div>

    <!-- The stack pill's wash: the face behind it is a cue, not text -->
    <span ref="veilEl" class="ncf__veil" aria-hidden="true" />

    <form
      v-if="phase === 'title'"
      class="ncf__title-form"
      :style="{ '--ncf-title-top': titleTop }"
      novalidate
      @submit.prevent="confirmTitle"
    >
      <textarea
        ref="titleEl"
        :value="title"
        class="ncf__input"
        data-private
        data-testid="new-card-title"
        rows="1"
        maxlength="140"
        autocomplete="off"
        :readonly="saving"
        :placeholder="t('task.form.titlePlaceholder')"
        :aria-label="t('board.quickAdd.titleLabel')"
        @input="onTitleInput"
        @keydown.enter.exact.prevent="onTitleEnter"
      />
      <UButton
        type="submit"
        color="primary"
        variant="soft"
        class="ncf__action ncf__check"
        data-testid="new-card-confirm-title"
        aria-keyshortcuts="Enter"
        :disabled="!title.trim()"
        :title="t('board.quickAdd.saveNowHint')"
        :aria-label="t('board.quickAdd.confirmTitle')"
      >
        <UIcon name="i-ph-check-bold" class="size-4" aria-hidden="true" />
        <kbd class="ncf__key" :data-key="KEY_ENTER" aria-hidden="true" />
      </UButton>
    </form>

    <div
      v-else
      ref="panelEl"
      class="ncf__panel"
      role="group"
      tabindex="-1"
      :aria-labelledby="questionId"
      :data-step="step"
      data-testid="new-card-step"
    >
      <Transition :name="direction === 'back' ? 'ncf-back' : 'ncf-fwd'" mode="out-in" @after-enter="focusStep()">
        <div :key="step" class="ncf__step">
          <div class="ncf__head">
            <UButton
              color="neutral"
              variant="soft"
              :icon="ICONS.back"
              class="ncf__nav ncf__nav--start"
              aria-keyshortcuts="Escape"
              :disabled="saving"
              :aria-label="t('board.quickAdd.back')"
              @click="goBack"
            >
              <kbd class="ncf__key" :data-key="KEY_ESCAPE" aria-hidden="true" />
            </UButton>
            <p :id="questionId" class="ncf__question">{{ question }}</p>
            <UButton
              v-if="step !== 'notes'"
              color="neutral"
              variant="soft"
              :icon="ICONS.forward"
              class="ncf__nav ncf__nav--end"
              aria-keyshortcuts="Enter"
              :disabled="saving"
              :aria-label="t('board.quickAdd.skip')"
              @click="skip"
            >
              <kbd class="ncf__key" :data-key="KEY_ENTER" aria-hidden="true" />
            </UButton>
          </div>

          <form v-if="step === 'notes'" class="ncf__row" novalidate @submit.prevent="submitNotes">
            <input
              v-model="notes"
              class="ncf__note"
              data-private
              data-autofocus
              data-testid="new-card-notes"
              type="text"
              autocomplete="off"
              :disabled="saving"
              :placeholder="t('board.quickAdd.notesPlaceholder')"
              :aria-label="t('task.field.notes')"
            >
            <UButton
              type="submit"
              color="primary"
              variant="soft"
              class="ncf__action"
              data-testid="new-card-save"
              aria-keyshortcuts="Enter"
              :disabled="saving"
              :title="t('board.quickAdd.saveNowHint')"
              :aria-label="t('board.quickAdd.save')"
            >
              <UIcon name="i-ph-check-bold" class="size-4" aria-hidden="true" />
              <kbd class="ncf__key" :data-key="KEY_ENTER" aria-hidden="true" />
            </UButton>
          </form>

          <div v-else-if="isEntryStep" class="ncf__row ncf__row--field" data-testid="new-card-options">
            <UInputMenu
              :key="step"
              ref="comboEl"
              v-model:search-term="searchTerm"
              :model-value="currentValue"
              :items="current.all"
              :placeholder="fieldPlaceholder"
              :aria-label="question"
              :create-item="creatable ? { when: 'always', position: 'bottom' } : false"
              :disabled="saving"
              :content="{ side: 'bottom', sideOffset: 6, collisionPadding: 8 }"
              :clear="{ 'aria-label': t('board.quickAdd.clearValue') }"
              reset-model-value-on-clear
              open-on-focus
              autocomplete="off"
              class="ncf__combo"
              data-private
              data-testid="new-card-combo"
              @update:model-value="onComboModel"
              @create="onComboCreate"
              @highlight="onComboHighlight"
              @input="onComboInput"
              @keydown.capture="onComboKey"
            >
              <template v-if="step === 'topic'" #item-leading="{ item }">
                <TopicMark :topic="String(item)" />
              </template>
              <template #item-label="{ item }">
                <MiddleEllipsis :text="String(item)" data-private />
              </template>
              <template #empty="{ searchTerm: typed }">
                <span v-if="typed" class="truncate" data-private>{{ t('board.quickAdd.noMatchValue', { value: typed }) }}</span>
                <template v-else>{{ t('board.quickAdd.noMatch') }}</template>
              </template>
              <template #create-item-label>
                <span class="truncate" data-private>{{ t('board.quickAdd.newValue', { value: creatable }) }}</span>
              </template>
            </UInputMenu>
          </div>

          <div v-else class="ncf__row ncf__row--grid" data-testid="new-card-options">
            <ChoiceChip
              v-for="(value, index) in current.suggestions"
              :key="value"
              class="ncf__pill"
              :current="value === currentValue"
              :picked="picked === value"
              :aria-keyshortcuts="String(index + 1)"
              :disabled="saving"
              @click="pick(value)"
            >
              <MiddleEllipsis class="ncf__name" :text="optionLabel(value)" />
              <kbd class="ncf__key" :data-key="index + 1" aria-hidden="true" />
            </ChoiceChip>

            <template v-if="hasList">
              <UPopover
                v-if="isDesktop"
                v-model:open="moreOpen"
                :content="{ side: 'bottom', align: 'center', sideOffset: 6, onOpenAutoFocus: onListOpenAutoFocus, onCloseAutoFocus: onMoreCloseAutoFocus }"
                :ui="{ content: 'max-h-64 min-w-56 overflow-auto p-1' }"
              >
                <ChoiceChip
                  class="ncf__pill ncf__pill--more"
                  :aria-keyshortcuts="String(listKey)"
                  :disabled="saving"
                  :aria-label="t('board.quickAdd.allOptions')"
                  data-testid="new-card-more"
                >
                  <UIcon name="i-ph-dots-three-bold" class="size-4" aria-hidden="true" />
                  <kbd class="ncf__key" :data-key="listKey" aria-hidden="true" />
                </ChoiceChip>
                <template #content>
                  <NewCardOptionList v-bind="listProps" @pick="pick" />
                </template>
              </UPopover>
              <template v-else>
                <ChoiceChip
                  class="ncf__pill ncf__pill--more"
                  :disabled="saving"
                  :aria-label="t('board.quickAdd.allOptions')"
                  data-testid="new-card-more"
                  @click="moreOpen = true"
                >
                  <UIcon name="i-ph-dots-three-bold" class="size-4" aria-hidden="true" />
                </ChoiceChip>
                <UDrawer
                  v-model:open="moreOpen"
                  :content="{ onOpenAutoFocus: onListOpenAutoFocus }"
                  :title="question"
                  :description="t('board.quickAdd.allOptions')"
                >
                  <template #content>
                    <NewCardOptionList v-bind="listProps" large @pick="pick" />
                  </template>
                </UDrawer>
              </template>
            </template>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ICONS } from '~/lib/icons'
import { MOTION } from '~/lib/motionTokens'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from '#imports';
import { navigateTo } from 'nuxt/app';
import { boardBasePath } from '~/composables/useBoardPlace';
import { newTaskStartsNotPlanned } from '~/lib/boardPlace';
import TaskCard from '~/components/task/TaskCard.vue';
import NewCardOptionList from '~/components/board/NewCardOptionList.vue';
import ChoiceChip from '~/components/ui/ChoiceChip.vue';
import TopicMark from '~/components/topic/TopicMark.vue';
import MiddleEllipsis from '~/components/ui/MiddleEllipsis.vue';
import { useAddTarget } from '~/composables/useAddTarget';
import { useErrorHandler } from '~/composables/useErrorHandler';
import { isPhoneNow, useIsDesktop } from '~/composables/useIsDesktop';
import { usePropertyOptionsSync } from '~/composables/usePropertyOptionsSync';
import { useTaskSync } from '~/composables/useTaskSync';
import { useTimeboxSuggestion } from '~/composables/useTimeboxSuggestion';
import { useTopicColor } from '~/composables/useTopicColor';
import { DRAFT_TASK_ID } from '~/composables/useTaskDraft';
import { activityStep, existingValueFor, filterRest, newValueFor, timeboxStep, topicStep, type SuggestionStep } from '~/lib/quickAddSuggestions';
import { DEFAULT_PRIORITY } from '~/lib/priority';
import { usePropertyOptionsStore } from '~/store/propertyOptions';
import { useNotionConfigStore } from '~/store/notionConfig';
import { useTasksStore } from '~/store/tasks';
import { TaskStatus } from '~/types/taskStatus';
import type { Task } from '~/types/task';
import { fieldsForSource } from '~/utils/sourceFields';
import { revealDraft } from '~/utils/revealDraft';

defineOptions({ name: 'NewCardFlow' });

type StepKey = 'topic' | 'activity' | 'timebox' | 'notes';

/** Key cues inside the buttons: key legends, not copy */
const KEY_ENTER = '↵';
const KEY_ESCAPE = 'Esc';

const props = defineProps<{
  /** A title to start with: the card reopened by "Rückgängig" after Esc dropped a typed title (#665) */
  initialTitle?: string;
  /** A drag is running: the card keeps its box (hidden by the slot), nothing is cancelled, and it takes the focus back after */
  suspended?: boolean;
}>();

const emit = defineEmits<{
  /** The task exists; the slot swaps this card for the real one */
  saved: [id: string];
  /** Esc on the title step (with the typed title, if any), or a press outside a blank card */
  cancel: [draft?: { title: string }];
}>();

const { t } = useI18n();
const toast = useToast();
const tasksStore = useTasksStore();
const optionsStore = usePropertyOptionsStore();
const notionConfig = useNotionConfigStore();
const { createTask } = useTaskSync();
const { defaultSource } = useAddTarget();
const { colorCodeFor } = useTopicColor();
const { handleError } = useErrorHandler();
const { calculateSuggestion } = useTimeboxSuggestion();
const { ensureOptionsAvailable } = usePropertyOptionsSync();
const isDesktop = useIsDesktop();
const questionId = useId();

const rootEl = ref<HTMLElement | null>(null);
const titleEl = ref<HTMLInputElement | null>(null);
const panelEl = ref<HTMLElement | null>(null);
const veilEl = ref<HTMLElement | null>(null);
const faceEl = ref<HTMLElement | null>(null);
/** Where the face's title stands inside the card (below the topic row, once there is one): the title field stands on it (#668) */
const titleTop = ref<string | undefined>(undefined);

const title = ref(props.initialTitle ?? '');
/** The typed title, for a host that closes the card on its own (AddTaskSlot, a move to "Alle") */
defineExpose({ title });
const topic = ref<string | null>(null);
const activity = ref<string | null>(null);
const minutes = ref<number | null>(null);
const notes = ref('');
const phase = ref<'title' | 'steps'>('title');
const step = ref<StepKey>('topic');
const direction = ref<'fwd' | 'back'>('fwd');
const moreOpen = ref(false);
const picked = ref<string | null>(null);
const saving = ref(false);

/** The save target and what it can store: the sheet's initial target, so the two flows start alike */
const fields = computed(() => fieldsForSource(defaultSource.value, notionConfig.config?.propertyMapping));

const topicOptions = computed(() => (fields.value.topic ? topicStep(tasksStore.tasks, optionsStore.getTopicOptions) : null));
const activityOptions = computed(() =>
  fields.value.activity ? activityStep(tasksStore.tasks, optionsStore.getActivityOptions, topic.value) : null,
);
const timeboxOptions = computed(() =>
  fields.value.timebox
    ? timeboxStep(calculateSuggestion(title.value, activity.value, topic.value)?.suggestedMinutes ?? null)
    : null,
);

/** The steps this card walks: a field the source lacks, or a list with nothing in it, is not asked */
const steps = computed<StepKey[]>(() => {
  const list: StepKey[] = [];
  if (topicOptions.value?.all.length) list.push('topic');
  if (activityOptions.value?.all.length) list.push('activity');
  if (timeboxOptions.value) list.push('timebox');
  list.push('notes');
  return list;
});

/** Thema and Aktivität are a combobox (#434); Timebox is three pills and the dots icon (kd#119) */
const isEntryStep = computed(() => step.value === 'topic' || step.value === 'activity');

const EMPTY_STEP: SuggestionStep = { all: [], suggestions: [], rest: [] };
const current = computed<SuggestionStep>(() => {
  if (step.value === 'topic') return topicOptions.value ?? EMPTY_STEP;
  if (step.value === 'activity') return activityOptions.value ?? EMPTY_STEP;
  if (step.value === 'timebox') return timeboxOptions.value ?? EMPTY_STEP;
  return EMPTY_STEP;
});
/** Whether Timebox has its list behind the pills (Thema and Aktivität are a combobox, not pills) */
const hasList = computed(() => step.value === 'timebox' && current.value.rest.length > 0);
/** The key that opens Timebox's list: the fourth cell (kd#119) */
const listKey = 4;
const currentValue = computed(() => {
  if (step.value === 'topic') return topic.value;
  if (step.value === 'activity') return activity.value;
  if (step.value === 'timebox') return minutes.value ? String(minutes.value) : null;
  return null;
});
const question = computed(() => {
  switch (step.value) {
    case 'topic': return t('board.quickAdd.questionTopic');
    case 'activity': return t('board.quickAdd.questionActivity');
    case 'timebox': return t('board.quickAdd.questionTimebox');
    default: return t('board.quickAdd.questionNotes');
  }
});
const optionLabel = (value: string) => (step.value === 'timebox' ? t('task.timeboxNudge.preset', { minutes: value }) : value);
/** Timebox's list: every value, the pills stay in it */
const listProps = computed(() => ({
  values: current.value.rest,
  current: currentValue.value,
  label: question.value,
  optionLabel,
}));


/** What the card behind the wash shows: the same task the save creates */
const faceTask = computed<Task>(() => ({
  id: DRAFT_TASK_ID,
  source: 'local',
  externalId: null,
  status: TaskStatus.Open,
  title: title.value.trim(),
  activity: activity.value,
  topic: topic.value,
  // The colour its siblings with this topic show, so the face already carries the mark the saved card gets (#672)
  topicColorCode: colorCodeFor(topic.value, defaultSource.value),
  priority: DEFAULT_PRIORITY,
  notes: notes.value.trim() || null,
  timeBoxSeconds: minutes.value ? minutes.value * 60 : null,
  timeSpentSeconds: 0,
  timerId: null,
  createdAt: new Date(),
}));

const prefersReducedMotion = () => import.meta.client && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let advanceTimer: ReturnType<typeof setTimeout> | undefined;

/** One short beat on the wash: a pick landed (the cue for Aktivität and Notiz, which a card does not show) */
function pulse() {
  if (prefersReducedMotion()) return;
  veilEl.value?.animate?.([{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }], { duration: MOTION.slowMs, easing: MOTION.standard });
}

/** Offset of an element's top inside the card, from layout (a transform on the card, such as its entrance, does not skew it) */
function offsetInCard(el: HTMLElement): number | null {
  let top = 0;
  let node: HTMLElement | null = el;
  while (node && node !== rootEl.value) {
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return node ? top : null;
}

/** The title field stands where the face's title stands: the topic row pushes it down, so going back with a topic picked must not overlap it (#668) */
function placeTitleField() {
  const faceTitle = faceEl.value?.querySelector<HTMLElement>('.task-title-text');
  const top = faceTitle ? offsetInCard(faceTitle) : null;
  titleTop.value = top ? `${top}px` : undefined;
}

/** The field grows with its text up to what the card shows of a title (the face's title height; CSS max-height is the fallback), then scrolls inside (#665, #668) */
function fitTitleField() {
  const el = titleEl.value;
  if (!el) return;
  // Never taller than the face's title: the card clamps a long title (3 lines under a topic with a footer) and has no room for more, so the rest scrolls inside
  const room = faceEl.value?.querySelector<HTMLElement>('.task-title-text')?.getBoundingClientRect().height;
  el.style.maxHeight = room ? `${room}px` : '';
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

/** The title is one line of text that wraps: line breaks (typed or pasted) become spaces */
function onTitleInput(event: Event) {
  const el = event.target as HTMLTextAreaElement;
  const clean = el.value.replace(/\s*[\r\n]+\s*/g, ' ');
  if (clean !== el.value) el.value = clean;
  title.value = clean;
  // After the face has rendered the new text: its height is the field's room
  void nextTick(fitTitleField);
}

function onTitleEnter(event: KeyboardEvent) {
  // The Enter that commits an IME composition is not a confirm: WebKit (the Tauri webview) sends it after compositionend, isComposing already false, keyCode 229
  if (event.isComposing || event.keyCode === 229) return;
  void confirmTitle();
}

/** Puts the title field on the face's title, sizes it and focuses it with the caret at the end */
async function showTitleField() {
  await nextTick();
  placeTitleField();
  fitTitleField();
  const el = titleEl.value;
  el?.focus({ preventScroll: true });
  el?.setSelectionRange(el.value.length, el.value.length);
}

/** `settled`: the step's own content is mounted (the slide has ended, or the panel is new); while the old step still slides out its field would take the focus back and the keys typed meanwhile (a digit for Timebox) would land in it */
function focusStep(settled = true) {
  // The slide ends 140 ms after the key that changed the step: a list opened meanwhile (key 4) keeps the focus, or it would close under the user (#685)
  if (phase.value !== 'steps' || moreOpen.value) return;
  const input = settled ? panelEl.value?.querySelector<HTMLElement>('input[data-autofocus], input[data-testid="new-card-combo"]') : null;
  (input ?? panelEl.value)?.focus({ preventScroll: true });
  if (isEntryStep.value) fitList();
}

/** Key 4 opened the list without touching its button: closing it hands the focus back to the step, so Enter still skips and Esc still goes back (reka would focus the button, where Enter reopens the list, #685) */
let moreOpenedByKey = false;
let openingByKey = false;
// Decided at every open, so a flag left by a list that never reported its close (mobile drawer, a step change) cannot reach a list opened with the mouse
watch(moreOpen, (open) => {
  if (!open) return;
  moreOpenedByKey = openingByKey && isDesktop.value;
  openingByKey = false;
});
/** Timebox's list (popover and drawer): its focus scope lands on the container; take it over and focus the first option, so the arrows work at once (kd#15) */
function onListOpenAutoFocus(event: Event) {
  const first = document.querySelector<HTMLElement>('[data-testid="new-card-more-list"] button');
  if (!first) return;
  event.preventDefault();
  first.focus({ preventScroll: true });
}
function onMoreCloseAutoFocus(event: Event) {
  if (!moreOpenedByKey) return;
  moreOpenedByKey = false;
  event.preventDefault();
  focusStep();
}

async function confirmTitle() {
  if (!title.value.trim()) return;
  direction.value = 'fwd';
  step.value = steps.value[0]!;
  phase.value = 'steps';
  await nextTick();
  focusStep();
}

function pick(value: string) {
  if (saving.value || picked.value !== null) return;
  if (step.value === 'topic') {
    topic.value = value;
    // An activity chosen earlier under another topic is a stale pick once the topic changes
    if (activity.value && !activityOptions.value?.all.includes(activity.value)) activity.value = null;
  } else if (step.value === 'activity') {
    activity.value = value;
  } else if (step.value === 'timebox') {
    minutes.value = Number(value);
  }
  picked.value = value;
  moreOpen.value = false;
  pulse();
  advanceTimer = setTimeout(() => {
    picked.value = null;
    void advance();
  }, prefersReducedMotion() ? 0 : 200);
}

/** Thema and Aktivität (#434): the text of the combobox, what it filters and what a new value is made from */
const searchTerm = ref('');
const comboHighlight = ref<string | null>(null);
const fieldPlaceholder = computed(() => (step.value === 'topic' ? t('board.quickAdd.placeholderTopic') : t('board.quickAdd.placeholderActivity')));
/** The on-screen keyboard shrinks the visual viewport, not the layout one the list measures its room against: the room above the keyboard goes to the list through `--combo-list-room` (app.config.ts `inputMenu` caps the list at it; the list is portalled out of the card, so the property sits on the root element) */
const comboEl = ref<{ inputRef: HTMLInputElement | null } | null>(null);
function fitList() {
  const vv = window.visualViewport; // only runs in the browser (after mount)
  const field = comboEl.value?.inputRef;
  if (!vv || !field) return;
  const room = Math.floor(vv.offsetTop + vv.height - field.getBoundingClientRect().bottom - 16);
  // Never below two rows: a field that low has no use for a smaller list than that, the page scrolls
  document.documentElement.style.setProperty('--combo-list-room', `min(15rem, ${Math.max(room, 96)}px)`);
}

/** The "Neu" row's text: set when no value has that name (any case) and the source allows free values (the source's rules clean it) */
const creatable = computed(() => isEntryStep.value ? newValueFor(searchTerm.value, current.value.all, fields.value.newValues) : null);

/** The step's value is taken away: the clear button, or the text deleted down to nothing */
function clearValue() {
  if (step.value === 'topic') topic.value = null;
  else if (step.value === 'activity') activity.value = null;
}

/** A pick, or a clear (the clear button) */
function onComboModel(value: string | null | undefined) {
  // Only the clear button resets the model (to null, `reset-model-value-on-clear`). `undefined` is the list's own toggle of the checked row: picking the value again keeps it
  if (value === undefined) {
    if (currentValue.value !== null) pick(currentValue.value);
  } else if (value === null || value === '') clearValue();
  else pick(value);
}

/** Deleting the text down to nothing is a clear too: the list resets its model only for its own clear button */
function onComboInput(event: Event) {
  if ((event.target as HTMLInputElement).value === '' && currentValue.value !== null) clearValue();
}

/** A value typed in the field: the source's rules cleaned it, so it is picked like any other; the save creates it (Local derives it from the task, Notion creates the select option on the write, kd#16) */
function onComboCreate() {
  if (creatable.value) pick(creatable.value);
}

function onComboHighlight(payload: { value?: unknown } | undefined) {
  comboHighlight.value = typeof payload?.value === 'string' ? payload.value : null;
}

/** The list highlights its first entry the moment it opens (and the first match while typing): on an empty field only an entry the user walked to with the arrows counts as a choice, else Enter must skip */
let walked = false;
watch([step, searchTerm], () => { if (!searchTerm.value) walked = false; });

/** Enter in the field: the highlighted entry is taken (by the list itself); on an empty field it continues without a value (skip) unless an entry was walked to; typed text with nothing highlighted takes an exact match, else the first match, else creates it (a partial match never creates by accident, as the old Mehr list did) */
function onComboKey(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') walked = true;
  if (event.key !== 'Enter') return;
  // The Enter that commits an IME composition is not an Enter; Cmd/Ctrl+Enter saves (root handler)
  if (event.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const text = searchTerm.value.trim();
  // The highlight is the list's last report: it goes stale when the filter empties the list or the pointer leaves it (the list emits nothing then), so it counts only while its row is still listed
  const listed = filterRest(current.value.all, searchTerm.value);
  const highlighted = comboHighlight.value !== null && listed.includes(comboHighlight.value) ? comboHighlight.value : null;
  if (!text) {
    if (walked && highlighted !== null && highlighted !== currentValue.value) return;
    // Ours: the list must not also see this Enter
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) void skip();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (event.repeat) return;
  // Ours, not the list's: with a stale highlight the list finds no row to take
  if (highlighted !== null) {
    pick(highlighted);
    return;
  }
  const match = existingValueFor(text, current.value.all, fields.value.newValues) ?? filterRest(current.value.all, text)[0] ?? creatable.value;
  if (match) pick(match);
}

/** Any navigation consumes a pick's pending advance: it must not fire a second step later (Enter then Notiz, Esc then forward) */
function cancelPendingAdvance() {
  clearTimeout(advanceTimer);
  picked.value = null;
}

async function skip() {
  if (saving.value) return;
  cancelPendingAdvance();
  moreOpen.value = false;
  await advance();
}

async function advance() {
  const next = steps.value[steps.value.indexOf(step.value) + 1];
  direction.value = 'fwd';
  if (!next) {
    await save();
    return;
  }
  step.value = next;
  await nextTick();
  focusStep(false);
}

async function submitNotes() {
  if (saving.value) return;
  pulse();
  await save();
}

async function goBack() {
  if (saving.value) return;
  cancelPendingAdvance();
  moreOpen.value = false;
  direction.value = 'back';
  const index = steps.value.indexOf(step.value);
  if (index <= 0) {
    phase.value = 'title';
    await showTitleField();
    return;
  }
  step.value = steps.value[index - 1]!;
  await nextTick();
  focusStep(false);
}

function openList(event: KeyboardEvent) {
  event.preventDefault();
  openingByKey = true;
  moreOpen.value = true;
}

function onKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented) return;
  // Cmd/Ctrl+Enter saves now, from any step, with what is entered (#665)
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key === 'Enter') {
    event.preventDefault();
    if (event.repeat || saving.value || moreOpen.value || !title.value.trim()) return;
    cancelPendingAdvance();
    void save();
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  // A held key repeats: it must not skip through every step, save a bare title or walk Esc back to a cancel
  if (event.repeat) {
    if (event.key === 'Escape' && !moreOpen.value) event.stopPropagation();
    return;
  }
  // The open option list owns its keys (Esc closes it, the list takes the arrows)
  if (moreOpen.value) return;
  if (event.key === 'Escape') {
    event.stopPropagation();
    if (phase.value === 'title') emit('cancel', title.value.trim() ? { title: title.value.trim() } : undefined);
    else void goBack();
    return;
  }
  if (phase.value !== 'steps' || saving.value) return;
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
  if (typing) return;
  const onButton = event.target instanceof HTMLButtonElement;
  if (event.key === 'Enter' && !onButton) {
    event.preventDefault();
    if (step.value === 'notes') void submitNotes();
    else void skip();
  } else if (step.value === 'timebox' && (event.key === '1' || event.key === '2' || event.key === '3')) {
    const value = current.value.suggestions[Number(event.key) - 1];
    if (value) pick(value);
  } else if (event.key === '4' && hasList.value) {
    // The fourth cell: the dots icon opens the full timebox list (kd#119)
    openList(event);
  }
}

async function save() {
  if (saving.value) return;
  saving.value = true; // the wash lifts, controls rest: the face behind becomes the card
  try {
    const created = await createTask(
      {
        title: title.value.trim(),
        status: TaskStatus.Open,
        // The sheet's defaults for what is not asked: Normal (#653)
        priority: DEFAULT_PRIORITY,
        topic: fields.value.topic ? topic.value : null,
        topicColorCode: fields.value.topic ? colorCodeFor(topic.value, defaultSource.value) : null,
        activity: fields.value.activity ? activity.value : null,
        notes: notes.value.trim() || null,
        timeBoxSeconds: fields.value.timebox && minutes.value ? minutes.value * 60 : null,
        isUnplanned: false,
        // On the place "Alle" the saved card goes to "Meine Aufgaben" (#367)
        ...(newTaskStartsNotPlanned() ? { notPlanned: true as const } : {}),
      },
      defaultSource.value,
    );
    toast.add({
      title: t('board.quickAdd.added'),
      orientation: 'horizontal',
      duration: 5000,
      actions: [
        {
          label: t('board.quickAdd.details'),
          color: 'neutral',
          variant: 'soft',
          onClick: () => void navigateTo(`${boardBasePath()}/${created.id}`),
        },
      ],
    });
    emit('saved', created.id);
  } catch (error) {
    // The card stays where it was (Notiz after Enter, any step after Cmd/Ctrl+Enter) with everything entered, like the sheet keeps its draft
    handleError(error as Error, 'task_create');
    saving.value = false;
    await nextTick();
    if (phase.value === 'title') titleEl.value?.focus({ preventScroll: true });
    else focusStep();
  }
}

/** A press outside throws away a blank card only; one with a title waits for Esc, back or save.
 *  A press on a card may become a drag: that is decided on release, because a card that goes away at the press makes every
 *  card below it slide up while the drag measures its shapes (#248). A drag keeps the card, a plain press throws it away */
let pendingCancel = false;
function endPendingPress() {
  document.removeEventListener('pointerup', onPressReleased, true);
  document.removeEventListener('pointercancel', endPendingPress, true);
}
function onPressReleased() {
  endPendingPress();
  if (!pendingCancel) return;
  pendingCancel = false;
  if (!props.suspended) emit('cancel');
}
function onPressOutside(event: PointerEvent) {
  if (phase.value !== 'title' || title.value.trim() || moreOpen.value) return;
  if (event.target instanceof Node && rootEl.value?.contains(event.target)) return;
  if (event.target instanceof Element && event.target.closest('.task-wrapper, [data-not-planned-id]')) {
    pendingCancel = true;
    document.addEventListener('pointerup', onPressReleased, true);
    document.addEventListener('pointercancel', endPendingPress, true);
    return;
  }
  emit('cancel');
}

watch(() => props.suspended, async (suspended) => {
  if (suspended) {
    pendingCancel = false;
    return;
  }
  // Back from a drag: the hidden card lost the focus, so typing goes on where it stopped
  await nextTick();
  if (!document.activeElement || document.activeElement === document.body) {
    if (phase.value === 'title') titleEl.value?.focus({ preventScroll: true });
    else focusStep();
  }
});

onMounted(() => {
  document.addEventListener('pointerdown', onPressOutside, true);
  window.visualViewport?.addEventListener('resize', fitList);
  ensureOptionsAvailable();
  void showTitleField();
  // The card stands at the start of the list: on a phone the page goes back to the top, so the header stays in view
  revealDraft(rootEl.value, { phone: isPhoneNow(), reducedMotion: prefersReducedMotion() });
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPressOutside, true);
  window.visualViewport?.removeEventListener('resize', fitList);
  document.documentElement.style.removeProperty('--combo-list-room');
  endPendingPress();
  clearTimeout(advanceTimer);
});
</script>

<style scoped>
/* One box with the add slot: width and radius as the sheet's draft card */
.ncf {
  --ncf-ease: var(--ease-standard);
  /* The padding of the card body (app.config.ts, task variant); the title input, the head and the answer row stand on it */
  --ncf-pad-x: 0.625rem;
  --ncf-pad-top: 0.5rem;
  /* What the title field keeps free for the check: 40 px button and a gap on a phone; with the key cue the check is wider */
  --ncf-check-clear: 2.75rem;
  /* The answer grid (kd#16): control height, where the grid starts below the head, and the room under it; the steps' card height is derived from them */
  --ncf-control-h: var(--field-h);
  --ncf-grid-top: 3.25rem;
  --ncf-grid-bottom: 0.75rem;
  position: relative;
  width: 100%;
  max-width: var(--task-card-width);
  margin: 0 auto;
  border-radius: var(--task-card-radius);
  font-size: var(--text-title);
  line-height: var(--lh-snug);
  text-align: left;
  animation: ncf-in var(--task-transform-duration) var(--ncf-ease);
}

@media (--smPx) {
  .ncf {
    --ncf-pad-x: 0.75rem;
    --ncf-pad-top: 0.75rem;
  }
}

@media (hover: hover) and (pointer: fine) {
  .ncf {
    --ncf-check-clear: 4.25rem;
  }
}

@media (--phone) {
  .ncf {
    font-size: var(--text-base);
  }
}

@keyframes ncf-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.ncf__face {
  /* Its own stacking context: the card inside carries z-index 50 and would otherwise cover the controls */
  position: relative;
  z-index: 0;
  pointer-events: none;
}

/* Behind the solid veil the face only sizes the card and is the picture the save hands over to: its text stays hidden while the steps run */
.ncf__face :deep(.task-topic),
.ncf__face :deep(.task-title-text),
.ncf__face :deep(.task-footer) {
  transition: filter var(--duration-slow) var(--ncf-ease), opacity var(--duration-slow) var(--ncf-ease);
}

.ncf.is-steps:not(.is-saving) .ncf__face :deep(.task-topic),
.ncf.is-steps:not(.is-saving) .ncf__face :deep(.task-title-text),
.ncf.is-steps:not(.is-saving) .ncf__face :deep(.task-footer) {
  opacity: 0;
}

/* The face's title wraps at the field's width (same right padding, the check's room): a title that wraps one line more in the field would
   otherwise outgrow the card the face sizes and run over the footer chip when going back with a timebox picked (#668) */
.ncf__face :deep(.task-title-text) {
  padding-right: var(--ncf-check-clear);
}

/* On the title step the field is the only text: the face's own title would show a second, narrower wrap behind it (#665) */
.ncf:not(.is-steps) .ncf__face :deep(.task-title-text) {
  visibility: hidden;
}

/* The steps stand on a plain solid card (#434): no card text or topic mark shows through; lifts on step 1 and on save */
.ncf__veil {
  position: absolute;
  inset: 0;
  z-index: 1;
  border-radius: var(--task-card-radius);
  background: var(--ui-bg-elevated);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--duration-slow) var(--ncf-ease);
}

.ncf.is-steps .ncf__veil {
  opacity: 1;
}

.ncf.is-saving .ncf__veil {
  opacity: 0;
}

/* ---------- Title step ---------- */
.ncf__title-form {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
}

/* A textarea that grows with its title (#665), on the line where the card's title stands: --ncf-title-top follows the face (the topic row pushes it down, #668).
   The right padding keeps the text clear of the check, which stands on the card's vertical centre; the room ends at the card's bottom padding, then it scrolls. */
.ncf__input {
  position: absolute;
  top: var(--ncf-title-top, var(--ncf-pad-top));
  left: var(--ncf-pad-x);
  width: calc(100% - 2 * var(--ncf-pad-x));
  max-height: calc(100% - var(--ncf-title-top, var(--ncf-pad-top)) - var(--ncf-pad-top));
  min-width: 0;
  padding: 0 var(--ncf-check-clear) 0 0;
  border: 0;
  background: transparent;
  color: var(--ui-text-highlighted);
  font: inherit;
  line-height: var(--lh-snug);
  outline: none;
  overflow-y: auto;
  resize: none;
  pointer-events: auto;
}

.ncf__input::placeholder {
  color: var(--ui-text-muted);
}

/* Vertically centred on the card: the line where the answer rows of the later steps stand */
.ncf__check {
  position: absolute;
  top: 50%;
  right: var(--ncf-pad-x);
  transform: translateY(-50%);
  pointer-events: auto;
}

.ncf__check:not(:disabled):active {
  transform: translateY(-50%) scale(0.94);
}

/* ---------- Steps ---------- */
.ncf__panel {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  padding: var(--ncf-pad-top) var(--ncf-pad-x);
  outline: none;
}

.ncf__step {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

/* The head sits on the card's own padding; the answer row stands on the card's vertical centre */
.ncf__head {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.5rem;
}

.ncf__question {
  margin: 0;
  grid-column: 2;
  text-align: center;
  font-size: var(--text-title);
  line-height: var(--lh-snug);
  font-weight: 500;
  color: var(--ui-text-highlighted);
  text-wrap: balance;
}

.ncf__nav--start {
  grid-column: 1;
  justify-self: start;
}

.ncf__nav--end {
  grid-column: 3;
  justify-self: end;
}

/* The soft button (UButton variant soft, the theme brings fill, hover and focus ring) in the head's size; the solid card
   under it gives it a surface to read as pressable on (#434) */
.ncf__nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  min-width: 1.75rem;
  height: 1.75rem;
  /* beats the button theme's phone floor, like .ncf__action: the head stays 32 px high */
  min-height: 1.75rem;
  padding: 0 0.375rem;
  border-radius: 9999px;
}

.ncf__row {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  min-width: 0;
}

/* ---------- Answer grid (kd#16) ----------
   Timebox: its pills and the dots icon. Two columns, so a long name has half
   the row instead of a third (it is still cut, in the middle: MiddleEllipsis, whose title attribute carries it). The steps are as tall as the
   grid needs: head, two rows, the room under them (about 20 px more than a card with one row of pills). */
.ncf__row--grid {
  top: var(--ncf-grid-top);
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  justify-content: stretch;
  padding: 0 var(--ncf-pad-x);
  transform: none;
}

/* Thema and Aktivität (#434): one combobox in the room of the answer grid */
.ncf__row--field {
  /* the one field stands in the middle of the two rows the card keeps room for, not on the first */
  top: calc(var(--ncf-grid-top) + (var(--ncf-control-h) + 0.375rem) / 2);
  display: block;
  padding: 0 var(--ncf-pad-x);
  transform: none;
}

.ncf__row--field :deep(.ncf__combo) {
  display: flex;
  width: 100%;
}

.ncf.is-steps .ncf__face > :deep(*) {
  box-sizing: border-box;
  min-height: calc(var(--ncf-pad-top) + var(--ncf-grid-top) + 2 * var(--ncf-control-h) + 0.375rem + var(--ncf-grid-bottom));
}

.ncf__row--grid .ncf__pill:not(.ncf__pill--more) {
  justify-content: space-between;
}

.ncf__row--grid .ncf__pill > .truncate,
.ncf__row--grid .ncf__pill > .ncf__name {
  min-width: 0;
  flex: 1 1 auto;
  text-align: left;
}

/* The two save controls (the title's check, the Notiz row's save) are UButton soft primary (#71): the theme brings the
   colours, hover, disabled look and focus ring. This is their geometry only: the round control of the flow's row height. */
.ncf__action {
  flex: 0 0 auto;
  justify-content: center;
  gap: 0.375rem;
  height: var(--ncf-control-h);
  min-width: var(--ncf-control-h);
  /* the flow's phone control: 44 px, the floor the answers share (#72) */
  min-height: var(--ncf-control-h);
  padding: 0 0.75rem;
  border-radius: 9999px;
}

.ncf__pill > .truncate,
.ncf__pill > .ncf__name {
  min-width: 7ch;
}

.ncf__nav:focus-visible,
.ncf__note:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.ncf__note {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--ncf-control-h);
  padding: 0 0.75rem;
  border: 0;
  border-radius: 9999px;
  background: var(--ui-bg);
  box-shadow: inset 0 0 0 1px var(--ui-border-accented);
  color: var(--ui-text-highlighted);
  font: inherit;
  font-size: var(--text-sm);
}

.ncf__note::placeholder {
  color: var(--ui-text-muted);
}

/* Key cue inside a button: fine pointers only, there is no keyboard on a phone. The legend is generated content, so it is
   no text of the button: the accessible name stays the label (WCAG 2.5.3), the shortcut is in aria-keyshortcuts */
.ncf__key::before {
  content: attr(data-key);
}

.ncf__key {
  display: none;
  padding: 0.125rem 0.25rem;
  border-radius: var(--radius-sm);
  background: color-mix(in oklab, currentColor 14%, transparent);
  color: inherit;
  font: inherit;
  font-size: var(--text-label);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

@media (hover: hover) and (pointer: fine) {
  .ncf__key {
    display: inline-block;
  }
}

/* The slide from step to step: out to the side we came from, in from the other */
.ncf-fwd-enter-active,
.ncf-fwd-leave-active,
.ncf-back-enter-active,
.ncf-back-leave-active {
  transition: opacity var(--duration-fast) var(--ncf-ease), transform var(--duration-fast) var(--ncf-ease);
}

.ncf-fwd-enter-from,
.ncf-back-leave-to {
  opacity: 0;
  transform: translateX(1.25rem);
}

.ncf-fwd-leave-to,
.ncf-back-enter-from {
  opacity: 0;
  transform: translateX(-1.25rem);
}

.ncf__step > .ncf__row:not(.ncf__row--grid) {
  /* the slide moves the step as a whole; the row keeps its own centring transform */
  transform: translateY(-50%);
}

/* Phone: touch targets 44 px (the answers, the save control and the note), no key cues */
@media (--phone) {
  .ncf {
    --ncf-check-clear: 3.25rem;
    --ncf-grid-top: 3rem;
    --ncf-grid-bottom: 1.25rem;
  }

  .ncf__action,
  .ncf__note {
    height: var(--ncf-control-h);
    min-width: var(--ncf-control-h);
  }

  .ncf__note {
    font-size: var(--text-base);
  }

  /* 32 px (above the 24 px target floor): the head ends 12 px above the answer row of a 128 px card. The hit area is
     44 px: an invisible 6 px ring around the circle (DESIGN.md "Space, size and shape", #592) */
  .ncf__nav {
    position: relative;
    height: 2rem;
    min-height: 2rem;
    min-width: 2rem;
  }

  .ncf__nav::after {
    content: '';
    position: absolute;
    inset: -0.375rem;
  }

  /* The dots icon alone is as wide as the answers are tall */
  .ncf__row--grid .ncf__pill--more {
    min-width: var(--ncf-control-h);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ncf,
  .ncf__veil,
  .ncf__nav,
  .ncf__face :deep(.task-topic),
  .ncf__face :deep(.task-title-text),
  .ncf__face :deep(.task-footer),
  .ncf-fwd-enter-active,
  .ncf-fwd-leave-active,
  .ncf-back-enter-active,
  .ncf-back-leave-active {
    animation: none;
    transition-duration: 0ms;
  }
}
</style>
