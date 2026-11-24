/**
 * @composable useTaskStatusActions
 * @description Provides status change actions and menu items for a task
 * @responsibility
 * - `changeStatus`: the guarded, swap-aware move into a column
 * - `togglePlanned` (#795, epic #374): the task sheet's switch "Für heute eingeplant". The status picker has the four statuses
 *   only; whether a task is on today's board is the marker beside the status (`lib/taskPlanning.ts`), moved by
 *   `useTaskSync.planTask` / `unplanTask`
 */
import { computed } from 'vue';
import type { Ref } from 'vue';
import { TaskStatus } from '~/types/taskStatus';
import type { Task } from '~/types/task';
import { TASK_STATUS_CONFIG, getStatusLabel } from '~/utils/taskStatusMappings';
import { useTaskOperations } from '~/composables/useTaskOperations';
import { useTaskSync } from '~/composables/useTaskSync';
import { usePlanToasts } from '~/composables/usePlanToasts';
import { isNotPlanned, canBeOffToday } from '~/lib/taskPlanning';

export function useTaskStatusActions(task: Ref<Task | null>) {
  const { moveOrSwapToStatus } = useTaskOperations();

  /**
   * Changes the status of the current task
   */
  async function changeStatus(newStatus: TaskStatus) {
    if (!task.value?.id) return;
    
    try {
      // Same path as the context menu and the palette: swaps into a full Jetzt (#162, #241), keeps board order
      // consistent and offers undo on completion
      await moveOrSwapToStatus(task.value.id, newStatus);
    } catch (err) {
      console.error('Failed to update task status:', err);
    }
  }

  /** Whether the task is on today's board: a Jetzt task always is, a done task ignores the marker */
  const isPlannedToday = computed(() => (task.value ? !isNotPlanned(task.value) : true));

  /** Whether the switch can be moved: only an Offen or a Wartet task can be off today (Jetzt is fixed on, Erledigt has no switch) */
  const canTogglePlanned = computed(() => (task.value ? canBeOffToday(task.value.status) : false));

  /**
   * The switch "Für heute eingeplant" (#795): on plans the task (it lands at the end of its column), off takes it off today.
   * The state change and the write to a source that stores planning are `useTaskSync`'s; a source that plans by date
   * (Apple Reminders) gets its toast as on the board.
   */
  function togglePlanned(planned: boolean) {
    const id = task.value?.id;
    if (!id || !canTogglePlanned.value) return;
    const { planTask, unplanTask } = useTaskSync();
    const { afterPlan, afterPutBack } = usePlanToasts();
    if (planned) {
      if (planTask(id)) void afterPlan(id);
    } else if (unplanTask(id)) {
      void afterPutBack(id);
    }
  }

  /**
   * Computed menu items for status dropdowns
   * Returns a 2D array compatible with UDropdownMenu (sections/items)
   */
  const statusMenuItems = computed(() => {
    const currentStatus = task.value?.status ?? TaskStatus.Open;
    
    return [
      [
        {
          label: getStatusLabel(TaskStatus.Open),
          icon: TASK_STATUS_CONFIG[TaskStatus.Open].icon,
          disabled: currentStatus === TaskStatus.Open,
          onSelect: () => changeStatus(TaskStatus.Open),
        },
        {
          label: getStatusLabel(TaskStatus.Progress),
          icon: TASK_STATUS_CONFIG[TaskStatus.Progress].icon,
          disabled: currentStatus === TaskStatus.Progress,
          onSelect: () => changeStatus(TaskStatus.Progress),
        },
        {
          label: getStatusLabel(TaskStatus.Waiting),
          icon: TASK_STATUS_CONFIG[TaskStatus.Waiting].icon,
          disabled: currentStatus === TaskStatus.Waiting,
          onSelect: () => changeStatus(TaskStatus.Waiting),
        },
        {
          label: getStatusLabel(TaskStatus.Done),
          icon: TASK_STATUS_CONFIG[TaskStatus.Done].icon,
          disabled: currentStatus === TaskStatus.Done,
          onSelect: () => changeStatus(TaskStatus.Done),
        },
      ],
    ];
  });

  return {
    changeStatus,
    isPlannedToday,
    canTogglePlanned,
    togglePlanned,
    statusMenuItems,
  };
}
