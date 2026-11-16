<!--
@component DayCloseOpenRow
@kind component
@category input
@description One open task in the closing sheet's "Für morgen" list (#237, a `ListRow`): a checkbox ("kept for tomorrow", on by default), the title and a subline.
@usage <DayCloseOpenRow :task="task" :kept="isKept(task.id)" @update:kept="setKept(task.id, $event)" /> inside a <ul class="divide-y divide-default"> in the accordion of DayCloseBody. Not draggable, not a link.
@avoid Not a board card (TaskCard) and not a done task (DayCloseTaskRow); the choice lives in `useDayClose`, the row only shows and reports it.
@responsibility
- UCheckbox whose label holds the title and the subline, so the accessible name carries the state
- Subline: the column (Offen, Jetzt, Wartet); a kept Jetzt task adds "Geht zurück nach Offen" (what "Fertig" does with it); a kept Offen or Wartet task stays where it is and says nothing more (#387: nothing goes back to "Meine Aufgaben" by itself); a task planned for several days adds "An n Tagen eingeplant"; unchecked it says what "Fertig" does instead: "Kommt in den Papierkorb" (naming Notion or Todoist for tasks of those sources, like the delete label)
- The task text is masked in feedback screenshots
-->
<template>
  <ListRow data-testid="day-close-open-row" :data-task-id="task.id">
    <UCheckbox
      :model-value="kept"
      class="w-full"
      data-testid="day-close-open-checkbox"
      @update:model-value="value => emit('update:kept', value !== false)"
    >
      <template #label>
        <span class="block text-sm font-normal wrap-break-word text-default" data-private>{{ task.title }}</span>
        <span class="block text-xs font-normal text-muted" data-testid="day-close-open-subline">{{ subline }}</span>
      </template>
    </UCheckbox>
  </ListRow>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ListRow from '~/components/ui/ListRow.vue'
import { useTaskCarryOver } from '~/composables/useCarryOver'
import { deleteTrashKey } from '~/lib/taskSources'
import { CARRY_OVER_NUDGE_DAYS } from '~/utils/carryOver'
import { getStatusLabel } from '~/utils/taskStatusMappings'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

defineOptions({ name: 'DayCloseOpenRow' })

interface Props {
  task: Task
  /** Whether the task is kept for tomorrow (unchecked: it goes to the trash). */
  kept: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:kept': [kept: boolean]
}>()

const { t } = useI18n()
const { displayDay } = useTaskCarryOver(() => props.task)

const subline = computed(() => {
  const parts = [getStatusLabel(props.task.status)]
  if (displayDay.value >= CARRY_OVER_NUDGE_DAYS) parts.push(t('task.carryOver.label', { n: displayDay.value }))
  if (!props.kept) parts.push(t(deleteTrashKey(props.task.source)))
  // "Fertig" stops the Jetzt task and puts it into Offen; every other open task stays where it is (#387)
  else if (props.task.status === TaskStatus.Progress) parts.push(t('dayClose.backToOpen'))
  return parts.join(', ')
})
</script>
