<!--
@component TaskDetailContent
@kind compound
@category input
@description Shared presentational component for task detail views with inline editing
@usage Used by TaskSheetDetail, the body of the detail route in the task sheet (/tasks/:id and /statistics/:id)
@avoid Shared body of the task detail (board and statistics open the same sheet); not for the add form, which is TaskForm.
@responsibility
- Display task properties as labelled cells (the row is shared with the add form, #161), the note, and custom fields
- Every property is a row in a stable position; unset Thema/Aktivität show the empty "Auswählen" state (#161)
- One fixed frame with tabs (#870, user, 2026-11-26: layout C replaces the one grid as tall as its content of #846, because only a fixed frame gives a controlled height; the footer line of #846 stays): the title row first (title, task menu, close button, at the same place in every state), the label "Spontan" when the task is ad-hoc work, the planned-days line or the carried-over question under the title, then the tabs (`UTabs` link, "Switch a view in a page" inside the sheet) and the footer line (TaskDetailMetadata) under every tab. "Details": the standard properties as a two-column grid (`.task-detail-grid`: Status, Heute / Thema, Aktivität / Priorität, Timebox / time spent; the DOM order is the shown order). "Notiz": the note alone (TaskDetailNotes, no label of its own); its tab carries a small mark when the task has a note (a note is not counted), with "vorhanden" for assistive tech; a source that owns the text shows the tab only when there is a note. "Eigenschaften": the board's extra properties in the same grid (TaskDetailCustomFields), the tab shows their count; no tab on a board without them. The sheet opens on Details every time (the tab is local state, reset with the task); a tab that goes away while open hands over to Details. Desktop sheet (`TaskMorphShell`): the frame is fixed, the open tab's body takes what the title block, the tabs and the footer line leave and is the one scroll area. Drawer: one scrolling page, the grid in one column, and the body keeps a minimum height (`min-h-96`: the seven rows of Details with the body's padding) so a shorter tab does not lower the drawer. The inactive tabs are not mounted: an open editor ends by its blur when the tab is left, as it does for any click outside
- Provide formatted display of all task metadata
- Task menu (#705, TaskSheetMenu; reverses #244's bottom row): open in source, move to source, "Kam spontan dazu" (checked entry), "ID kopieren" and Delete behind one ⋯ button in the title row. Desktop: left of the shell's close button (`inset-e-14 top-4`); drawer: beside the title. It follows the title in the DOM, so the tab order is close, title, menu. The id is shown nowhere: `copyId` copies it and confirms with a toast, a failure reports through `useErrorHandler` (`copy_id`)
- Render error state when task not found
- Handle inline updates and synchronization
- Topic and activity pickers (TopicPropertyPicker): the topic mark before each option, no control inside an option; an edit mode in the
  picker's footer ("Bearbeiten" / "Fertig") lists one button row per option, and a row closes the picker and opens the shared
  TopicEditorHost under the property row (#430, #431, #443); topics also get a "Themen verwalten" row
- Host the carried-over triage block and line (#99), both under the title (#846); a status change that ends the nudge closes the block and opens the line in place over `--duration-slow` (#610)
- Status cell: four choices, Offen, Jetzt, Wartet, Erledigt (#795: "Nicht geplant" is no status, #359 is reversed). The cell "Heute" beside it holds the switch "Für heute eingeplant"
  (`useTaskStatusActions.togglePlanned`, epic #374): on a Jetzt task it is on and fixed with the hint "Jetzt gehört immer zu heute."; a done task has "Erledigt am" in that cell
  (the marker plays no part there). Ad-hoc work (#796) is no row and no switch: the label under the title shows it, the task menu sets and clears it (#846)
- Guard against drift (#161, kd#4): the always-visible standard cells are Status, Heute (#795, not on a done task), Thema, Aktivität, Priorität, Timebox,
  time spent (visible label "Aufgewendet", the control keeps "Aufgewendete Zeit"); no per-row icons, no dividers, and no hairline but the tabs' underline in the sheet. Seven cells leave the one beside the time spent empty (accepted, #846)
- Done day (kd#131, agent-decided): a done task has "Erledigt am" in the cell of Heute, so no other cell moves
  when a task is completed (#846; a plain swap, nothing folds). It is the correction of a task marked done late, not part of completing: a DatePickerField
  without Löschen, limited to the days from the task's creation to today; picking a day goes through
  `useTaskSync.setCompletedDay` (statistics and the board's today / before-today split follow at once). A task whose connection holds no
  completion date says "Gilt nur in Kan-do." beside the value
- Close clearance (kd#201, #705): on desktop the shell's close button sits at the top end corner (`top-4 end-4`, 32 px) and the task menu left of it, so the title block ends 96 px (`pe-24`) from the sheet's edge and never runs under the controls; change both together. The triage block sits below them and takes the full width
- Property cells (moved from DESIGN.md, kd#176): a quiet label and the value as its own control, a soft select with a chevron when it opens a list (`TaskPropertySelect`), an editable label on a faint dotted rule when it is free input (`InlineEditable`, `PropertyValueTrigger`). Every cell keeps its place whether set or not ("Auswählen…", "+ hinzufügen") (a source that owns the text, Reminders #551, shows Thema and Aktivität as plain values and leaves an empty one out); no per-row icons, dividers or chips, and no separate time block or progress ring on the sheet
- The title's error line is not held open (#846; #594 held it): the label and the lines under the title follow the title directly, and the rare error (an emptied title) opens its line while the field is being edited
-->

<template>
  <div v-if="isError" class="px-6 py-8" :class="{ 'pe-16': twoColumn }" data-testid="task-not-found">
    <SectionHeader tag="h2">{{ t('task.notFoundTitle') }}</SectionHeader>
    <p class="mt-1 text-body text-muted">{{ t('task.notFoundMessage') }}</p>
  </div>

  <div v-else-if="task" class="task-detail-content flex flex-col" :class="{ 'min-h-0 flex-1': twoColumn }">

    <!-- One fixed frame with tabs (#870). Desktop sheet: title block, tabs and footer keep their height, the open tab's body takes the rest and is the one scroll area. Drawer: plain flow, scrolled by the drawer -->
    <div :class="twoColumn ? 'flex min-h-0 flex-1 flex-col' : 'flex flex-col'" :data-testid="twoColumn ? 'task-detail-sheet' : 'task-detail-scroll'">

    <!-- Title row: always first, so the title, the task menu and the close button are at the same place in every state (#846). On desktop the title runs clear of the close button (kd#201: `top-4 end-4`, 32 px) and the task menu left of it (#705: `inset-e-14 top-4`, 32 px) -->
    <div class="shrink-0 pb-2" :class="twoColumn ? 'ps-6 pe-24 pt-5' : 'px-6 pt-2'" data-testid="task-detail-header">
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <InlineEditable
            ref="titleEditable"
            data-private
            :model-value="task.title"
            :label="t('task.field.title')"
            required
            :readonly="!canEditText"
            :required-message="t('task.form.titleRequired')"
            class="text-headline"
            container-class="-ms-2"
            display-class="font-display max-md:min-h-11"
            size="xl"
            :aria-describedby="isSmallerStep ? smallerHintId : undefined"
            @save="(val) => handleTitleSave(val as string)"
            @cancel="isSmallerStep = false"
          />
          <!-- Ad-hoc work (#846): a label, set and cleared in the task menu -->
          <p v-if="task.isUnplanned === true" class="mt-1" data-testid="task-adhoc-label">
            <UBadge color="neutral" variant="subtle" icon="i-ph-lightning">{{ t('task.detail.adhocBadge') }}</UBadge>
          </p>
          <p v-if="isSmallerStep" :id="smallerHintId" class="mt-1 text-body text-muted" data-testid="carry-over-smaller-hint">
            {{ t('task.carryOver.smallerHint') }}
          </p>
          <p v-else-if="remindersHint" class="mt-1 flex items-center gap-2 text-sm text-muted" data-testid="reminders-hint-line">
            <UIcon :name="remindersHint.icon" class="size-4 shrink-0" aria-hidden="true" />
            {{ remindersHint.text }}
          </p>
          <!-- The line opens in place when a status change ends the triage block (#610) -->
          <UCollapsible :open="!isSmallerStep && !remindersHint && isCarryOverVisible && !isCarryOverNudgeDue">
            <template #content>
              <p
                class="mt-1 flex items-center gap-2 text-sm text-muted"
                data-testid="carry-over-line"
              >
                <TaskCarryOverDots :day="carryOverDay" decorative />
                {{ t('task.carryOver.label', { n: carryOverDay }) }}
              </p>
            </template>
          </UCollapsible>
        </div>
        <!-- Task menu (#705): beside the title on the drawer; on desktop it sits absolutely left of the shell's close button, still after the title in the tab order -->
        <TaskSheetMenu
          v-bind="actionProps"
          :adhoc="task.isUnplanned === true"
          :class="twoColumn ? 'absolute inset-e-14 top-4 z-10' : '-me-2 shrink-0 max-md:-me-3'"
          @open="openSource"
          @move="moveToSource"
          @delete="emit('delete')"
          @update:adhoc="(on: boolean) => updateAndSync({ isUnplanned: on })"
          @copy-id="copyId"
        />
      </div>
    </div>

    <!-- Carried-over triage (#99): only for Offen/Jetzt cards past the threshold. Under the title (#846), full width: it is below the close button and the menu -->
    <UCollapsible v-if="!isPreview" :open="triageOpen" class="shrink-0">
      <template #content>
        <TaskCarryOverTriage
          :task-id="task.id"
          :hold="!triageOpen"
          class="mx-6 mb-3"
          @kept="onTriageKept"
          @delete="emit('delete')"
        />
      </template>
    </UCollapsible>

    <!-- The parts of the task as tabs (#870, "Switch a view in a page"): Details, Notiz, and Eigenschaften on a board with extra properties. The open tab has the whole body; on the sheet it scrolls inside, in the drawer it keeps a minimum height so a shorter tab does not lower the drawer -->
    <UTabs
      ref="tabsRoot"
      v-model="tab"
      :items="tabs"
      variant="link"
      class="gap-0"
      :class="{ 'min-h-0 flex-1': twoColumn }"
      :ui="{
        list: 'mx-6 w-auto shrink-0 self-stretch px-0',
        content: twoColumn ? 'min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-4 pb-2' : 'min-h-96 px-6 pt-4 pb-6',
      }"
      data-testid="task-detail-tabs"
    >
      <template #trailing="{ item }">
        <!-- A note is not counted: a mark says there is one (#870) -->
        <span v-if="item.value === 'notes' && task.notes" class="flex items-center" data-testid="task-notes-mark">
          <span class="size-1.5 rounded-full bg-primary" aria-hidden="true" />
          <span class="sr-only">{{ t('task.detail.tabNotesFilled') }}</span>
        </span>
        <UBadge v-else-if="item.value === 'props'" color="neutral" variant="outline" :label="customList.length" />
      </template>

      <template #details>
      <!-- 1. Standard properties (#161, #846): on the sheet a two-column grid in the shown order, Status, Heute / Thema, Aktivität / Priorität, Timebox / time spent; in the drawer one column. The DOM order is the tab order -->
      <div class="task-detail-grid" :class="{ 'task-detail-grid--single': !twoColumn }" data-testid="task-property-list">
        <TaskPropertyRow :label="t('task.field.status')">
          <TaskPropertySelect
            :label="t('task.field.status')"
            :model-value="task.status"
            :items="statusItems"
            value-key="value"
            data-testid="task-status-select"
            @update:model-value="onStatusPicked"
          />
        </TaskPropertyRow>

        <!-- Heute (#795): the marker "Für heute eingeplant" beside the status. A done task has "Erledigt am" in this cell instead (the marker plays no part there), so a status change swaps the cell and moves no other (#846). The hint of a Jetzt task opens in place over `--duration-slow` (#610) -->
        <TaskPropertyRow v-if="task.status !== TaskStatus.Done" :label="t('task.field.today')" data-today-row>
          <div class="flex min-w-0 flex-col">
            <!-- While the hint is open its line closes up under the switch (`-mb-1.5` here: a negative margin on the hint itself is cut by the collapsible's overflow) -->
            <div class="flex min-h-(--field-h) items-center" :class="{ '-mb-1.5': task.status === TaskStatus.Progress }">
              <USwitch
                :model-value="isPlannedToday"
                :label="t('task.field.plannedToday')"
                :disabled="isPreview || !canTogglePlanned"
                :aria-describedby="task.status === TaskStatus.Progress ? plannedHintId : undefined"
                data-testid="task-planned-switch"
                @update:model-value="(on: boolean) => togglePlanned(on)"
              />
            </div>
            <UCollapsible :open="task.status === TaskStatus.Progress">
              <template #content>
                <!-- Under the switch's label, not its track: `ps-11` is the track (36 px) and its gap -->
                <p :id="plannedHintId" class="ps-11 pb-1.5 text-xs text-muted" data-testid="task-planned-hint">
                  {{ t('task.field.plannedTodayHint') }}
                </p>
              </template>
            </UCollapsible>
          </div>
        </TaskPropertyRow>

        <!-- Done day (kd#131): only on a done task, in the cell of Heute; corrects the day of a task marked done late -->
        <TaskPropertyRow v-else-if="doneDay" :label="t('task.field.doneDay')" data-done-day-row>
          <DatePickerField
            :model-value="{ start: doneDay }"
            :label="t('task.field.doneDay')"
            :min-day="doneDayLimits.min"
            :max-day="doneDayLimits.max"
            :clearable="false"
            :disabled="isPreview"
            @update:model-value="(val) => updateDoneDay(val?.start)"
          />
          <span v-if="doneDayLocalOnly" class="text-sm text-muted" data-testid="done-day-local-only">{{ t('task.doneDay.localOnly') }}</span>
        </TaskPropertyRow>
        <!-- A done task without a completion day: the cell stays, so no later cell changes column (#846) -->
        <div v-else-if="twoColumn" aria-hidden="true" data-testid="task-grid-spacer" />

        <!-- A source that owns the text (Reminders, #551) also owns the Thema and the Aktivität: the list. Shown as plain values, never as pickers -->
        <TaskPropertyRow v-if="!canEditText && task.topic" :label="t('task.field.topic')" private>
          <InlineEditable readonly affordance="rule" :model-value="task.topic" :label="t('task.field.topic')" data-private data-testid="task-topic-readonly" />
        </TaskPropertyRow>
        <TaskPropertyRow v-else-if="canEditText" :label="t('task.field.topic')" private>
          <TopicPropertyPicker
            kind="topic"
            :editable="!isPreview"
            :label="t('task.field.topic')"
            :task="task"
            :model-value="task.topic"
            :items="propertyOptionsStore.getTopicOptions"
            :placeholder="t('task.form.choose')"
            :search-placeholder="t('task.field.topicSearch')"
            :clear-label="t('task.property.clear', { field: t('task.field.topic') })"
            create-item
            @update:model-value="(val) => updateTopic(val)"
            @clear="updateTopic(null)"
            @create="handleCreateTopic"
            @edit="(name) => openEditor('topic', name)"
          />
        </TaskPropertyRow>
        <div v-else-if="twoColumn" aria-hidden="true" data-testid="task-grid-spacer" />

        <TaskPropertyRow v-if="!canEditText && task.activity" :label="t('task.field.activity')" private>
          <InlineEditable readonly affordance="rule" :model-value="task.activity" :label="t('task.field.activity')" data-private data-testid="task-activity-readonly" />
        </TaskPropertyRow>
        <TaskPropertyRow v-else-if="canEditText" :label="t('task.field.activity')" private>
          <TopicPropertyPicker
            kind="activity"
            :editable="!isPreview"
            :label="t('task.field.activity')"
            :model-value="task.activity"
            :items="propertyOptionsStore.getActivityOptions"
            :placeholder="t('task.form.choose')"
            :search-placeholder="t('task.field.activitySearch')"
            :clear-label="t('task.property.clear', { field: t('task.field.activity') })"
            create-item
            @update:model-value="(val) => updateActivity(val)"
            @clear="updateActivity(null)"
            @create="handleCreateActivity"
            @edit="(name) => openEditor('activity', name)"
          />
        </TaskPropertyRow>
        <div v-else-if="twoColumn" aria-hidden="true" data-testid="task-grid-spacer" />

        <!-- The shared topic editor (#430): under the row of Thema and Aktivität, across both columns -->
        <div v-if="editing" class="task-detail-grid__wide">
          <TopicEditorHost :key="`${editing.kind}:${editing.name}`" nested :topic="editing.name" :kind="editing.kind" @close="closeEditor" />
        </div>

        <TaskPropertyRow :label="t('task.field.priority')">
          <TaskPropertySelect
            :label="t('task.field.priority')"
            :model-value="priorityValue"
            :items="priorityItems"
            value-key="value"
            :hint="t('task.form.priorityHint')"
            data-testid="task-priority-select"
            @update:model-value="(val) => updatePriority(Number(val))"
          />
        </TaskPropertyRow>

        <!-- Timebox: the single entry point for the value; the suggestion sits next to it as text -->
        <TaskPropertyRow :label="t('task.timebox')">
          <InlineEditable
            :model-value="timeboxInMinutes"
            :label="t('task.timebox')"
            :value-text="timeboxInMinutes > 0 ? formatTaskDuration(task.timeBoxSeconds) : undefined"
            :placeholder="t('task.property.setValue')"
            affordance="rule"
            @save="updateTimebox"
          >
            <template #display>
              <span v-if="timeboxInMinutes > 0">{{ formatTaskDuration(task.timeBoxSeconds) }}</span>
              <span v-else class="text-muted not-italic">{{ t('task.property.setValue') }}</span>
            </template>
            <template #edit="{ finishEdit, commitEdit, cancelEdit }">
              <MinutesField
                v-model.number="editTimeboxValue"
                min="0"
                data-testid="timebox-edit-input"
                :aria-label="t('task.timebox')"
                :aria-describedby="timeboxHintId"
                @focus="(event: FocusEvent) => (event.target as HTMLInputElement).select()"
                @keydown.enter="() => { saveTimeboxEdit(); commitEdit(); }"
                @keydown.esc.stop="() => { abandonTimeboxEdit(); cancelEdit(); }"
                @blur="() => { saveTimeboxEdit(); finishEdit(); }"
              />
            </template>
          </InlineEditable>
          <span :id="timeboxHintId" class="sr-only">{{ t('task.form.durationHint') }}</span>

          <PropertyValueTrigger
            v-if="showSuggestion && timeboxSuggestion"
            tone="action"
            :aria-describedby="suggestionHintId"
            @click="applySuggestion"
          >
            {{ t('task.property.suggest', { n: timeboxSuggestion.suggestedMinutes }) }}
          </PropertyValueTrigger>
          <span v-if="timeboxSuggestion" :id="suggestionHintId" class="sr-only">{{ timeboxSuggestion.matchDescription }}</span>
        </TaskPropertyRow>

        <!-- Time spent (kd#4): the total in minutes, edited like the Timebox; what is left of the Timebox sits beside it as text. The visible label is the short form (#846: "Aufgewendet" fits the label column), the control keeps the full name -->
        <TaskPropertyRow :label="t('task.field.timeSpentShort')">
          <InlineEditable
            :model-value="timeSpentInMinutes"
            :label="t('task.field.timeSpent')"
            :value-text="liveTimeSpent(task) > 0 ? timeSpentText : undefined"
            :placeholder="t('task.property.setValue')"
            affordance="rule"
          >
            <template #display>
              <span v-if="liveTimeSpent(task) > 0" class="tabular-nums" data-testid="time-spent-value">{{ timeSpentText }}</span>
              <span v-else class="text-muted not-italic">{{ t('task.property.setValue') }}</span>
            </template>
            <template #edit="{ finishEdit, commitEdit, cancelEdit }">
              <MinutesField
                v-model.number="editTimeSpentValue"
                min="0"
                :max="MAX_TIME_SPENT_MINUTES"
                step="1"
                inputmode="numeric"
                data-testid="time-spent-edit-input"
                :aria-label="t('task.field.timeSpentInMinutes')"
                @vue:mounted="beginTimeSpentEdit"
                @focus="(event: FocusEvent) => (event.target as HTMLInputElement).select()"
                @keydown.enter="() => { saveTimeSpentEdit(); commitEdit(); }"
                @keydown.esc.stop="() => { abandonTimeSpentEdit(); cancelEdit(); }"
                @blur="(event: FocusEvent) => onTimeSpentBlur(event, finishEdit)"
              />
            </template>
          </InlineEditable>
          <span
            v-if="task.timeBoxSeconds"
            class="flex min-h-(--field-h) items-center text-sm tabular-nums"
            :class="remainingTimeClass"
            data-testid="time-remaining"
          >{{ t('task.timeStats.remaining', { time: remainingTimeText }) }}</span>
        </TaskPropertyRow>
      </div>
      </template>

      <!-- 2. The note: the tab names it, so it has no label of its own -->
      <template #notes>
        <div data-testid="task-notes-column">
          <TaskDetailNotes :notes="task.notes" :readonly="!canEditText" @save="updateNotes" />
        </div>
      </template>

      <!-- 3. The board's extra properties: the same grid, in a tab of their own; no tab on a board without them -->
      <template #props>
        <TaskDetailCustomFields
          :key="task.id"
          :custom-list="customList"
          data-testid="task-custom-properties"
          @update="updateCustomField"
        />
      </template>
    </UTabs>

    <!-- 4. Footer line (#846): the source and the creation date, always there -->
    <TaskDetailMetadata
      class="shrink-0 px-6"
      :class="twoColumn ? 'pt-2 pb-5' : 'pb-6'"
      :source="taskSource"
      :icon="sourceMetaOf(task.source).icon"
      :created-at="formatDate(task.createdAt)"
    />

    </div>

  </div>
</template>

<script setup lang="ts">
import MinutesField from '~/components/ui/MinutesField.vue';
import { openExternal } from '~/utils/openExternal';
import { toRef, computed, ref, watch, nextTick, useId, onMounted } from 'vue';
import { useOverlayIsDesktop } from '~/composables/useIsDesktop';
import { useTaskDetail, formatTaskDuration, applyCustomValue } from '~/composables/useTaskDetail';
import { useLocaleFormat } from '~/composables/useLocaleFormat';
import { useI18n } from 'vue-i18n';
import { TASK_STATUS_CONFIG, getStatusLabel, getPriorityLabel } from '~/utils/taskStatusMappings';
import { useTaskStatusActions } from '~/composables/useTaskStatusActions';
import { TaskStatus } from '~/types/taskStatus';
import SectionHeader from '~/components/ui/SectionHeader.vue';
import InlineEditable from '~/components/ui/inline/InlineEditable.vue';
import PropertyValueTrigger from '~/components/ui/PropertyValueTrigger.vue';
import { useTasksStore } from '~/store/tasks';
import { useDayRecapStore } from '~/store/dayRecap';
import { usePropertyOptionsStore } from '~/store/propertyOptions';
import { useTimeboxSuggestion } from '~/composables/useTimeboxSuggestion';
import { useTaskSync } from '~/composables/useTaskSync';
import { useTaskMoveTargets } from '~/composables/useTaskMoveTargets';
import { usePropertyOptionsSync } from '~/composables/usePropertyOptionsSync';
import TaskDetailCustomFields from '~/components/task/TaskDetailCustomFields.vue';
import TaskPropertyRow from '~/components/task/TaskPropertyRow.vue';
import TaskDetailNotes from '~/components/task/TaskDetailNotes.vue';
import TaskDetailMetadata from '~/components/task/TaskDetailMetadata.vue';
import TaskSheetMenu from '~/components/task/TaskSheetMenu.vue';
import TaskPropertySelect from '~/components/task/TaskPropertySelect.vue';
import DatePickerField from '~/components/task/DatePickerField.vue';
import { doneDayBounds } from '~/lib/doneDay';
import { dayKey } from '~/utils/recapDay';
import { useRemindersHint } from '~/composables/useRemindersHint';
import { useToday } from '~/composables/useToday';
import TopicPropertyPicker from '~/components/task/TopicPropertyPicker.vue';
import TopicEditorHost from '~/components/topic/TopicEditorHost.vue';
import TaskCarryOverTriage from '~/components/task/TaskCarryOverTriage.vue';
import TaskCarryOverDots from '~/components/task/TaskCarryOverDots.vue';
import { useTaskCarryOver } from '~/composables/useCarryOver';
import { deleteLabelKey, sourceCan, sourceTaskUrl } from '~/lib/taskSources';
import { sourceMetaOf } from '~/utils/sourceMeta';
import { useErrorHandler } from '~/composables/useErrorHandler';
import { useToast } from '#imports';
import { normalizePriority } from '~/lib/priority';
import { liveTimeSpent } from '~/lib/liveTime';
import type { Task, TaskCustomValue } from '~/types/task';
import type { NameKind } from '~/lib/topicNames';

defineOptions({ name: 'TaskDetailContent' });

const { t } = useI18n();

const emit = defineEmits<{
  (e: 'delete' | 'close'): void
}>();

/**
 * @property taskId - The ID of the task to display details for. If null, displays error state.
 */
const props = withDefaults(defineProps<{
  /**
   * The ID of the task to display details for.
   * If null, the component will display an error or empty state.
   */
  taskId: string | null;
  /**
   * If true, disables synchronization with external integrations.
   * Useful for previews.
   */
  isPreview?: boolean;
  /**
   * Opened through "Make smaller" in the closing step (#98): start the title edit with the
   * first-small-step hint once the sheet is open, as if the triage block's button was pressed.
   */
  startSmaller?: boolean;
}>(), {
  isPreview: false,
  startSmaller: false,
});

const tasksStore = useTasksStore();
const propertyOptionsStore = usePropertyOptionsStore();
const { calculateSuggestion } = useTimeboxSuggestion();
const { editTask, syncTaskToIntegration, setCompletedDay } = useTaskSync();
const { ensureOptionsAvailable } = usePropertyOptionsSync();

const timeboxHintId = useId();
const suggestionHintId = useId();

// Ensure property options are available when this component is used
// Skip in preview mode to avoid side effects
if (!props.isPreview) {
  ensureOptionsAvailable();
}

// Use the shared composable
const taskIdRef = toRef(props, 'taskId');
const {
  task,
  isError,
  taskSource,
  doneDayLocalOnly,
  hasCustom,
  customList,
  timeSpentText,
  remainingTimeText,
} = useTaskDetail(taskIdRef);

const { changeStatus, isPlannedToday, canTogglePlanned, togglePlanned } = useTaskStatusActions(task);
const onStatusPicked = (value: unknown) => void changeStatus(Number(value) as TaskStatus);
const plannedHintId = useId();
const { targets: moveTargets, move: moveToSource } = useTaskMoveTargets(() => (props.isPreview ? null : task.value));

// Desktop sheet (>=768px, #468): the fixed frame, two columns of cells, the open tab the one scroll area. Below that the sheet is a drawer: one column, one scrolling page.
// Follows the sheet's frozen variant, not the live query, so a resize while open cannot disagree with the layout the sheet actually shows (#199).
const twoColumn = useOverlayIsDesktop();

// Four statuses (#795): whether a task is on today's board is the switch of the row "Heute", not a status
const statusItems = computed<{ label: string; value: TaskStatus; icon: string }[]>(() => [
  ...Object.entries(TASK_STATUS_CONFIG)
    .filter(([status]) => Number(status) !== TaskStatus.Backlog)
    .map(([status, config]) => ({ label: getStatusLabel(Number(status) as TaskStatus), value: Number(status) as TaskStatus, icon: config.icon })),
]);

const priorityItems = computed(() => [
  { label: getPriorityLabel(1), value: 1, icon: 'i-ph-flag' },
  { label: getPriorityLabel(2), value: 2, icon: 'i-ph-flag' },
  { label: getPriorityLabel(3), value: 3, icon: 'i-ph-exclamation-mark' },
]);

// Priority display computed properties
const priorityValue = computed(() => normalizePriority(task.value?.priority));

/**
 * A field edit goes through the one edit path, `useTaskSync().editTask` (#770): a new operation version, the store,
 * then the push to the task's own source. The preview (the `/ui` catalog) writes the store only and pushes nothing.
 */
function updateAndSync(updates: Partial<Task>) {
  if (!task.value) return;
  if (props.isPreview) {
    tasksStore.updateTask(task.value.id, updates);
    return;
  }
  void editTask(task.value.id, updates);
}

/** Sets the task's total time spent (kd#4); like `updateAndSync`, with the store action that queues the total for the source */
function setTimeSpentAndSync(seconds: number) {
  if (!task.value) return;
  const operationVersion = tasksStore.incrementTaskOperationVersion(task.value.id);
  if (!tasksStore.setTimeSpent(task.value.id, seconds)) return;
  // The typed total is the truth: an open "Zeit abziehen" question for this task (#356) would lower it again
  useDayRecapStore().resolveTimeOffer(task.value.id);
  if (!props.isPreview) {
    const updatedTask = tasksStore.task(task.value.id);
    if (updatedTask) syncTaskToIntegration(updatedTask, operationVersion);
  }
}

// Done day (kd#131): the local calendar day of a done task's completion, and the days it may be moved to
const { today } = useToday();
// Reminders plans by date (#553): the line under the title says why the task is where it is
const remindersHint = useRemindersHint(() => task.value ?? undefined);
const doneDay = computed(() => {
  const current = task.value;
  if (!current || current.status !== TaskStatus.Done || !current.completedAt) return null;
  const at = new Date(current.completedAt);
  return Number.isNaN(at.getTime()) ? null : dayKey(at);
});
const doneDayLimits = computed(() => doneDayBounds(task.value ?? {}, today.value));

function updateDoneDay(day: string | undefined) {
  if (!task.value || props.isPreview || !day || day === doneDay.value) return;
  setCompletedDay(task.value.id, day);
}

// Carried-over cue (#99): the line under the title (day 2+) and the triage block's title actions
const {
  displayDay: carryOverDay,
  isVisible: isCarryOverVisible,
  isNudgeDue: isCarryOverNudgeDue,
  keep: keepCarryOver,
} = useTaskCarryOver(task);
const titleEditable = ref<InstanceType<typeof InlineEditable> | null>(null);
const isSmallerStep = ref(false);
/** The triage block stays open after "Ja, behalten" (it shows the confirmation), like the component's own `kept`; a status change that ends the nudge closes it over `--duration-slow` (#610) */
const triageKept = ref(false);
const triageOpen = computed(() => isCarryOverNudgeDue.value || triageKept.value);
watch(() => task.value?.id, () => { triageKept.value = false; });
function onTriageKept() {
  triageKept.value = true;
  focusTitle();
}
const smallerHintId = useId();

// Leaving the title editor without a change (blur, Escape) ends the smaller-step hint as well.
watch(() => titleEditable.value?.isEditing, (editing) => {
  if (editing === false) isSmallerStep.value = false;
});

onMounted(() => {
  if (!props.startSmaller || props.isPreview) return;
  // Wait for the sheet's own focus handling (reka FocusScope) so the edit field keeps focus
  window.setTimeout(() => { if (isCarryOverNudgeDue.value) startSmallerStep(); }, 250);
});

/** After Keep the block disappears: keep focus in the sheet, on the title. */
function focusTitle() {
  nextTick(() => {
    document.querySelector<HTMLElement>('[data-testid="task-detail-header"] [data-inline-editable] [role="button"]')?.focus();
  });
}

/** Make smaller: edit the title in place with the "first small step" hint. */
function startSmallerStep() {
  isSmallerStep.value = true;
  titleEditable.value?.startEdit();
}

/** A title saved as the smaller step is a fresh choice: it also silences the nudge, like Keep. */
function handleTitleSave(newTitle: string) {
  updateTitle(newTitle);
  if (isSmallerStep.value) {
    isSmallerStep.value = false;
    keepCarryOver();
  }
}

/** Title, notes, Thema and Aktivität belong to the task's source for Reminders (#551; the list is the Thema or the Aktivität): shown, never edited here */
const canEditText = computed(() => sourceCan(task.value?.source ?? 'local', 'editText'));

// Tabs (#870): the sheet opens on Details every time. A tab exists only when it has something to show or to add:
// Eigenschaften on a board with extra properties, Notiz unless the source owns the text and the task has no note (Reminders, #551).
type DetailTab = 'details' | 'notes' | 'props';
const tab = ref<DetailTab>('details');
const hasNotesTab = computed(() => canEditText.value || !!task.value?.notes);
const tabs = computed<{ label: string; value: DetailTab; slot: DetailTab }[]>(() => [
  { label: t('task.detail.tabDetails'), value: 'details', slot: 'details' },
  ...(hasNotesTab.value ? [{ label: t('task.field.notes'), value: 'notes' as const, slot: 'notes' as const }] : []),
  ...(hasCustom.value ? [{ label: t('task.field.properties'), value: 'props' as const, slot: 'props' as const }] : []),
]);
watch(() => task.value?.id, () => { tab.value = 'details'; });
// A tab that goes away while it is open (the board's extra properties were removed) hands over to Details
watch(tabs, (list) => { if (!list.some((item) => item.value === tab.value)) tab.value = 'details'; });
// UTabs has no label prop for its list: name the tab list for assistive tech (as /settings/topics does)
const tabsRoot = ref<{ $el: HTMLElement } | null>(null);
watch(tabsRoot, (root) => root?.$el?.querySelector?.('[data-slot="list"]')?.setAttribute('aria-label', t('task.detail.tabsLabel')), { flush: 'post' });

// Updates
function updateTitle(newTitle: string) {
  if (newTitle.trim()) {
    updateAndSync({ title: newTitle.trim() });
  }
}

function updateNotes(newNotes: string | number | null) {
  const notesStr = newNotes === null ? null : String(newNotes).trim();
  updateAndSync({ notes: notesStr || null });
}

function updatePriority(newPriority: number) {
  updateAndSync({ priority: newPriority });
}

/**
 * The shared topic editor (#430) opened from a row of the picker's edit mode (#443): the picker has already closed (and
 * its row blurred, so Reka does not hand focus back to the trigger), the editor appears under the property row (inline
 * at >=768px, a nested drawer below) and takes focus itself. A rename rewrites this task too (the store pass), so
 * nothing is left on the old name. Closing returns focus to the row's picker trigger.
 */
const editing = ref<{ kind: NameKind; name: string } | null>(null);
function openEditor(kind: NameKind, name: string) {
  editing.value = { kind, name };
}
function closeEditor() {
  const kind = editing.value?.kind;
  editing.value = null;
  if (!kind) return;
  void nextTick(() => document.querySelector<HTMLElement>(`[data-testid="task-${kind}-select"]`)?.focus());
}

function updateTopic(newTopic: string | null) {
  updateAndSync({ topic: newTopic?.trim() || null });
}

function handleCreateTopic(newTopic: string) {
  propertyOptionsStore.addTopicOption(newTopic);
  updateTopic(newTopic);
}

function updateActivity(newActivity: string | null) {
  updateAndSync({ activity: newActivity?.trim() || null });
}

function handleCreateActivity(newActivity: string) {
  propertyOptionsStore.addActivityOption(newActivity);
  updateActivity(newActivity);
}

function updateCustomField(key: string, value: TaskCustomValue) {
  // A configured property the task has no entry for yet is only a displayed row in customList
  const source = task.value?.custom?.[key] ?? customList.value.find((entry) => entry.key === key);
  if (!source) {
    if (import.meta.dev) {
      console.warn(`[TaskDetailContent] Custom field key "${key}" not found in task.custom or customList`);
    }
    return;
  }

  const newCustom = applyCustomValue(task.value?.custom, source, value);
  if (newCustom) updateAndSync({ custom: newCustom });
}

// Timebox Logic
const timeboxInMinutes = computed(() => {
  return task.value?.timeBoxSeconds ? Math.round(task.value.timeBoxSeconds / 60) : 0;
});
const editTimeboxValue = ref(0);

// Sync edit value when opening edit mode (handled by watching modelValue in InlineEditable, but we need local ref for input)
watch(timeboxInMinutes, (val) => {
  editTimeboxValue.value = val;
}, { immediate: true });

function updateTimebox(_val: string | number | null) {
  // This is called by InlineEditable @save
  // But we prefer saveTimeboxEdit via input events for finer control
  // Actually, we should unify this. InlineEditable emits @save when read mode is restored.
  // So we can use this too.
  saveTimeboxEdit();
}

/** Esc (kd#12): the field goes back to the stored value, so the blur that follows the closing saves nothing */
function abandonTimeboxEdit() {
  editTimeboxValue.value = timeboxInMinutes.value;
}

function saveTimeboxEdit() {
  if (editTimeboxValue.value === timeboxInMinutes.value) return;
  const seconds = editTimeboxValue.value > 0 ? editTimeboxValue.value * 60 : null;
  updateAndSync({ timeBoxSeconds: seconds });
}

// Time spent (kd#4): the total in whole minutes. A running timer changes the displayed minutes while the field is
// open, so the field is synced from the task only while it is closed, and an unchanged field writes nothing
// (a total of "30 min 5 s" must not become "30 min" by opening and leaving the field).
const timeSpentInMinutes = computed(() => {
  const seconds = task.value ? liveTimeSpent(task.value) : 0;
  return seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 0;
});
/** Upper bound of the field (about 166 h): a typo must not put an absurd total into the statistics */
const MAX_TIME_SPENT_MINUTES = 9999;
const editTimeSpentValue = ref<number | string>(0);
let timeSpentEditStart: number | null = null;

watch(timeSpentInMinutes, (val) => {
  if (timeSpentEditStart === null) editTimeSpentValue.value = val;
}, { immediate: true });

/** The field mounted: every edit starts from the total shown when it opened (not from a focus event, which a busy page may delay) */
function beginTimeSpentEdit() {
  timeSpentEditStart = Number(editTimeSpentValue.value);
}

/** Esc: the field's value goes back to where it started, so the blur that follows saves nothing */
function abandonTimeSpentEdit() {
  if (timeSpentEditStart !== null) editTimeSpentValue.value = timeSpentEditStart;
  timeSpentEditStart = null;
}

/**
 * Leaving the field saves it. The blur that a removed input still fires after Enter or Esc belongs to the
 * closed edit: with a new edit already open it would end that one (the input is no longer in the document).
 */
function onTimeSpentBlur(event: FocusEvent, finishEdit: () => void) {
  if (!(event.target as HTMLElement).isConnected) return;
  saveTimeSpentEdit();
  finishEdit();
}

function saveTimeSpentEdit() {
  if (timeSpentEditStart === null) return;
  const start = timeSpentEditStart;
  timeSpentEditStart = null;
  const raw = editTimeSpentValue.value;
  const minutes = typeof raw === 'number' ? Math.round(raw) : Number.NaN;
  // Blank, negative, non-numeric and absurdly large entries are dropped; the field shows the total again
  if (Number.isFinite(minutes) && minutes >= 0 && minutes <= MAX_TIME_SPENT_MINUTES && minutes !== start) setTimeSpentAndSync(minutes * 60);
  editTimeSpentValue.value = timeSpentInMinutes.value;
}

const remainingTimeClass = computed(() => {
  const box = task.value?.timeBoxSeconds;
  if (!box) return 'text-muted';
  const percentageLeft = ((box - (task.value ? liveTimeSpent(task.value) : 0)) / box) * 100;
  if (percentageLeft <= 0) return 'text-warning-700 font-semibold';
  if (percentageLeft <= 20) return 'text-warning-700 font-medium';
  return 'text-muted';
});

// Timebox Suggestion
const timeboxSuggestion = ref<{ suggestedMinutes: number; matchDescription: string } | null>(null);
const showSuggestion = computed(() => {
  return !!timeboxSuggestion.value && (!task.value?.timeBoxSeconds || task.value.timeBoxSeconds === 0);
});

// Update suggestion when relevant fields change
watch([() => task.value?.title, () => task.value?.activity, () => task.value?.topic], () => {
  if (task.value) {
    const suggestion = calculateSuggestion(task.value.title, task.value.activity, task.value.topic);
    timeboxSuggestion.value = suggestion;
  }
}, { immediate: true });

function applySuggestion() {
  if (timeboxSuggestion.value) {
    updateAndSync({ timeBoxSeconds: timeboxSuggestion.value.suggestedMinutes * 60 });
  }
}

const { formatDateTime } = useLocaleFormat();

function formatDate(dateString: string | Date | null | undefined) {
  if (!dateString) return '—';
  // The date alone (#846): the time of day answers no question here and makes the footer line longer
  return formatDateTime(dateString, 'mediumDate');
}

// Source URL (#303): derived from source + externalId, null for Local and a pending create
const sourceUrl = computed(() => (task.value ? sourceTaskUrl(task.value) : null));

// Action row (#244): open in source, move to source, Delete
const actionProps = computed(() => ({
  openLabel: sourceUrl.value && taskSource.value ? t('task.detail.openIn', { source: taskSource.value }) : null,
  moveTargets: moveTargets.value,
  deleteLabel: sourceCan(task.value?.source ?? 'local', 'remove') ? t(deleteLabelKey(task.value?.source ?? 'local')) : null,
}));

function openSource() {
  if (sourceUrl.value) void openExternal(sourceUrl.value);
}

const toast = useToast();
const { handleError } = useErrorHandler();

/** Copies the stable task id (#846: it is shown nowhere in the sheet); a failure is reported, a success confirmed with a short toast, as "Titel kopieren" does */
async function copyId() {
  if (!task.value) return;
  try {
    await navigator.clipboard.writeText(task.value.id);
  } catch (error) {
    handleError(error instanceof Error ? error : String(error), 'copy_id');
    return;
  }
  toast.add({ title: t('task.contextMenu.idCopied'), duration: 2500 });
}
</script>
