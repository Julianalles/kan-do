/**
 * @composable useInCardAdding
 * @description True while an in-card new-task form (NewCardFlow, #649) is open on the board
 * @responsibility
 * - One shared signal so the focus overlay (#394) can step aside: it would dim the form being typed in (kd#56)
 * - Singleton, module-level state like `useTaskDraft`; a counter, so two slots opening and closing in
 *   any order never leave it stuck
 * - `trackInCardAdding(open)` is called by AddTaskSlot with its own flow state and releases its claim on unmount
 * - The task the open flow has already stored (#758: it is stored when its title is confirmed, the later steps edit it):
 *   the board leaves its own card out while the flow still asks, so it shows once. `withoutInCardTask` is the one filter
 *   the board's renderers and the DnD mapping use (Offen, "Alle Aufgaben"), so a drop slot maps against what is rendered.
 *   Transient, never persisted; the flow sets it and clears it when it ends
 */
import { computed, getCurrentInstance, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import type { Task } from '~/types/task';

const openCount = ref(0);

/** True while at least one in-card form is open */
export const inCardAdding = computed(() => openCount.value > 0);

/** Counts `open` into the shared signal for the lifetime of the calling component */
export function trackInCardAdding(open: Ref<boolean>) {
  let counted = false;
  const set = (value: boolean) => {
    if (value === counted) return;
    counted = value;
    openCount.value += value ? 1 : -1;
  };
  watch(open, set, { immediate: true });
  if (getCurrentInstance()) onBeforeUnmount(() => set(false));
}

/** The id of the task an open in-card flow has stored and still asks about (#758), else null */
const inCardTaskId = ref<string | null>(null);

/** The flow stored its task (`id`) or ended (`null`). Clearing passes the id, so a flow that ends late never clears another flow's task */
export function setInCardTask(id: string | null, ending?: string) {
  if (id === null && ending !== undefined && inCardTaskId.value !== ending) return;
  inCardTaskId.value = id;
}

/** The id of the task being added in a card, if any (read-only) */
export const inCardTask = computed(() => inCardTaskId.value);

/** A column's (or "Alle Aufgaben"'s) tasks without the one an open in-card flow still asks about: it shows once, as the flow */
export function withoutInCardTask<T extends Pick<Task, 'id'>>(tasks: readonly T[]): T[] {
  const id = inCardTaskId.value;
  return id === null ? tasks as T[] : tasks.filter((task) => task.id !== id);
}
