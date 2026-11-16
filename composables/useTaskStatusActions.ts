/**
 * @composable useTaskStatusActions
 * @description Provides status change actions and menu items for a task
 * @responsibility
 * - `changeStatus`: the guarded, swap-aware move into a column
 * - `statusChoice` / `chooseStatus` (#359): the task sheet's picker has a fifth choice, "Nicht geplant". It is not a
 *   `TaskStatus`: a not-planned task is an Open task with the marker (`lib/taskPlanning.ts`), so the choice is mapped
 *   here to the moves that exist ("Für heute einplanen", "Nicht heute", a move into a column)
 */
import { computed } from 'vue';
import type { Ref } from 'vue';
import { TaskStatus } from '~/types/taskStatus';
import type { Task } from '~/types/task';
import { TASK_STATUS_CONFIG, getStatusLabel } from '~/utils/taskStatusMappings';
import { useTaskOperations } from '~/composables/useTaskOperations';
import { usePlanMoves } from '~/composables/usePlanMoves';
import { useTasksStore } from '~/store/tasks';
import { isNotPlanned } from '~/lib/taskPlanning';

/** The picker's value for a task that is not planned for today (#359); every other value is a `TaskStatus` */
export const NOT_PLANNED_CHOICE = 'notPlanned' as const;
export type StatusChoice = TaskStatus | typeof NOT_PLANNED_CHOICE;

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

  /** What the picker shows: "Nicht geplant" for a task that is not on today's board, else its column */
  const statusChoice = computed<StatusChoice>(() => {
    const current = task.value;
    if (!current) return TaskStatus.Open;
    return isNotPlanned(current) ? NOT_PLANNED_CHOICE : current.status;
  });

  /**
   * The picker's choice (#359).
   * - A column: a not-planned task picked into Offen is planned as by "Für heute einplanen" (end of Offen); every
   *   other pick is `changeStatus` (leaving Open drops the marker, so Jetzt, Wartet and Erledigt plan it too).
   * - "Nicht geplant": an Offen task goes back as by "Nicht heute". From Jetzt, Wartet or Erledigt it first goes to
   *   Offen by the normal move (the timer stops and keeps its time, a done task is reopened), then back. The move
   *   sets the status before its upstream write, so the task does not wait in Offen for a slow connection.
   */
  async function chooseStatus(choice: StatusChoice) {
    const id = task.value?.id;
    if (!id) return;
    const live = () => useTasksStore().task(id);
    const before = live() ?? task.value;
    if (!before) return;
    const { planForToday, notToday } = usePlanMoves();

    if (choice !== NOT_PLANNED_CHOICE) {
      if (choice === TaskStatus.Open && isNotPlanned(before)) await planForToday(id);
      else await changeStatus(choice);
      return;
    }
    if (isNotPlanned(before)) return;
    if (before.status === TaskStatus.Open) {
      await notToday(id);
      return;
    }
    const moved = changeStatus(TaskStatus.Open);
    if (live()?.status !== TaskStatus.Open) await moved;
    if (live()?.status === TaskStatus.Open) await notToday(id);
    await moved;
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
    statusChoice,
    chooseStatus,
    statusMenuItems,
  };
}
