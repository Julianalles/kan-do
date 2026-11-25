import { nextTick } from 'vue'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useBoardDragState, type DraggedStack } from '~/composables/useBoardDragState'
import { useTaskSync } from '~/composables/useTaskSync'
import { usePlanToasts } from '~/composables/usePlanToasts'
import { useCompletionUndo } from '~/composables/useCompletionUndo'
import { TaskStatus } from '~/types/taskStatus'
import { finishedFasterThanPlan } from '~/lib/completionPace'
import { canSwapIntoProgress, checkWipMove } from '~/utils/wipGuard'
import { useTaskSwap } from '~/composables/useTaskSwap'
import { useStackExpansion } from '~/composables/useStackExpansion'
import { deriveGroupKeyForTask, getRenderedTaskOrder, isGroupingActiveFor, shouldTaskBeGrouped } from '~/utils/taskGrouping'
import { useBoardGrouping } from '~/composables/useBoardGrouping'
import { useBoardFocus } from '~/composables/useBoardFocus'
import { withoutInCardTask } from '~/composables/useInCardAdding'
import { isSortable } from '@dnd-kit/vue/sortable'
import { isColumnItemNode } from '~/utils/columnItems'
import { NOT_PLANNED_GROUP, isNotPlannedZone, resolvePlanDrop, staysInOwnGroup } from '~/utils/planDrop'
import { boardPlaceOfPath, currentBoardPath } from '~/lib/boardPlace'

/** The mark of a Jetzt or Wartet card that "Heute" lists on the place "Alle" (#797, SortableTaskWrapper): its value is the card's status */
const TODAY_EXTRA_ATTR = 'data-today-extra'
/** The place "Alle" shows: there no drop changes a status (#797) */
const onAll = (): boolean => boardPlaceOfPath(currentBoardPath.value) === 'all'

/**
 * Central dnd-kit event handler for the board.
 * Wired into DragDropProvider on Board.vue.
 *
 * Responsibilities:
 * - Update global drag state (isDragging, draggedTaskId, draggedStack)
 * - On dragEnd: persist reorder to the board store; route cross-column transfers through
 *   `useTaskSync().updateTaskStatus` (completedAt, statistics, upstream sync)
 * - Enforce WIP limit on Progress column via dragOver prevention; a single card from Offen or Wartet over
 *   a Jetzt that holds one task is not refused but marks that card as the swap target (`swapTaskId`, #162),
 *   and the drop swaps through `useTaskSwap`
 * - Flag a card dropped into Erledigt for the in-card done confirmation (#124); reduced motion
 *   hides the layer in CSS (TaskCard), so the flag is set either way. No completion toast on this
 *   path (#136): the card and the drop announcement confirm it, undo is the reverse drag
 * - A collapsed stack is one sortable (id = its front task, data.stack = key, label, taskIds, #150).
 *   Dropping it moves every member as one block: members are snapshotted at drag start, a block of
 *   2+ never fits Jetzt, and a block completed in Erledigt gets ONE undo toast (the deliberate
 *   exception to #136: after a merge the reverse drag would also move tasks done before)
 * - The place "Alle" (#355): a card under "Alle Aufgaben" is a sortable of the group `NOT_PLANNED_GROUP`, the side one
 *   droppable (`data.notPlannedZone`). Dropped on Offen the card is planned (`planTask`) and placed in the previewed slot;
 *   an Offen card or stack dropped on the side is taken off today's board (`unplanTask`); a "Alle Aufgaben" card
 *   dropped anywhere else goes back. The rule is `resolvePlanDrop`; these drops never change a status, so the WIP
 *   limit is not in play, and a "Alle Aufgaben" card is kept out of every column but Offen in `onDragOver`
 * - "Heute" on "Alle" lists everything planned (#797): the Jetzt card and the Wartet cards stand in Offen's list behind its own
 *   cards, each a sortable of its own status (`data-today-extra`). No drop on "Alle" changes a status: a card is sorted only
 *   among the cards of its own status (`staysInOwnGroup` in `onDragOver`, re-checked in `onDragEnd`), so a Wartet card
 *   reorders Wartet, the Jetzt card always returns, and no swap happens there. A Wartet card dropped on the side leaves
 *   today and keeps Wartet (`resolvePlanDrop`). Such a card's node is put back among the extra cards, never by Offen's order
 */

export function useBoardDndKit() {
  const tasksStore = useTasksStore()
  const boardStore = useBoardStore()
  const { dragState } = useBoardDragState()
  const { updateTaskStatus, updateTaskStatuses, handleSyncError, planTask, unplanTask } = useTaskSync()
  const { afterPlan, afterPutBack } = usePlanToasts()
  const { captureCompletionSnapshots, notifyCompletedBlock } = useCompletionUndo()
  const { swapIntoProgress } = useTaskSwap()
  const stacks = useStackExpansion()
  const { effectiveGroupKey } = useBoardGrouping()
  const { applyFocus } = useBoardFocus()

  function getTasksByStatus(status: TaskStatus) {
    switch (status) {
      case TaskStatus.Open: return tasksStore.tasksOpen
      case TaskStatus.Progress: return tasksStore.tasksProgress
      case TaskStatus.Waiting: return tasksStore.tasksWaiting
      case TaskStatus.Done: return tasksStore.tasksDone
      default: return []
    }
  }

  /**
   * The tasks a column renders. Erledigt shows only today's tasks (earlier days sit in the Gestern
   * note, archived ones nowhere), so its indices refer to `tasksDoneToday`, not to every done task.
   * A topic focus (#161) hides further cards the same way: the drop slot maps against what is rendered, and the
   * hidden cards keep their relative order behind the rendered ones when a column is saved.
   */
  function getRenderedTasks(status: TaskStatus) {
    // Leaves out the task an in-card flow still asks about, as the board's renderers do (#758)
    return applyFocus(withoutInCardTask(status === TaskStatus.Done ? tasksStore.tasksDoneToday : getTasksByStatus(status)))
  }

  /** The group key a column renders with, or null when it is not grouped (#135). */
  function getColumnGroupKey(status: TaskStatus) {
    const { enabled } = boardStore.grouping
    const key = effectiveGroupKey.value
    return isGroupingActiveFor(status, enabled, key) ? key : null
  }

  /** A column's rendered order and draggable cards, with the stacks the user has expanded (#147) */
  function getRenderedOrder(status: TaskStatus) {
    return getRenderedTaskOrder(getRenderedTasks(status), getColumnGroupKey(status), stacks.expandedKeys(status))
  }

  /**
   * The dragged card at drag start. dnd-kit moves its DOM node to preview the slot and puts it back
   * only on a canceled drag, and then only next to a sibling, so onDragEnd restores it from data (restoreDraggedElement): Vue then
   * renders the saved order from a DOM it knows, including a drop that grouping snaps back (#135).
   */
  type DragOrigin = {
    element: Element
    list: Element | null
    taskId: string
    status: TaskStatus | undefined
    /** The drag started under "Alle Aufgaben" (#355): `list` is that side's list and `status` is undefined */
    fromNotPlanned: boolean
    /** The drag started on a Jetzt or Wartet card listed in "Heute" on "Alle" (#797): `list` is Offen's list, `status` the card's own */
    todayExtra: boolean
    /** The node stood below Offen's capacity line (#132) at drag start: the line's place in the DOM alone cannot tell (#833) */
    belowLine: boolean
  }
  let dragOrigin: DragOrigin | null = null
  /** The stack picked up at drag start (#150): the members it moves are the ones it had then */
  let dragStack: DraggedStack | null = null

  /**
   * The droppables of the running drag, for `refreshDroppableShapes`. dnd-kit's manager is private
   * API, so every member is optional: a version without one of them turns the refresh into a no-op.
   */
  type DragManager = { registry?: { droppables?: Iterable<{ element?: Element | undefined; refreshShape?: () => unknown }> } }
  let dragManager: DragManager | null = null
  let droppableRefreshFrame: number | null = null

  function cancelDroppableRefresh() {
    if (droppableRefreshFrame === null) return
    cancelAnimationFrame(droppableRefreshFrame)
    droppableRefreshFrame = null
  }

  /**
   * Re-measures the droppables on the visible page after the mobile board switched pages mid-drag
   * (#372). dnd-kit drops the shape of a droppable that scrolls out of view but keeps its last rect
   * and only measures again when the rect changed, so a droppable that comes back in the same place
   * (Jetzt's drop zone once its card was pulled out, a card nothing moved) has no shape and can
   * never be hovered again: the drag finds no target there. Droppables still off-screen keep none.
   * Runs two frames later, when the switch has been laid out and dnd-kit's own visibility pass is done.
   * The frames are cancelled when the drag ends, and a missing private member skips the refresh
   * instead of throwing inside the frame callback.
   */
  function refreshDroppableShapes() {
    cancelDroppableRefresh()
    droppableRefreshFrame = requestAnimationFrame(() => {
      droppableRefreshFrame = requestAnimationFrame(() => {
        droppableRefreshFrame = null
        try {
          for (const droppable of dragManager?.registry?.droppables ?? []) {
            const rect = droppable.element?.getBoundingClientRect()
            if (rect && rect.right > 0 && rect.left < window.innerWidth) droppable.refreshShape?.()
          }
        } catch (error) {
          if (import.meta.dev) console.warn('[DnD] could not refresh the droppable shapes', error)
        }
      })
    })
  }

  /** The stack a sortable carries as data (`useColumnSortable`'s `data`), copied; null for a card */
  function readStack(source: unknown): DraggedStack | null {
    const stack = (source as { data?: { stack?: DraggedStack } } | null)?.data?.stack
    return stack ? { key: stack.key, label: stack.label, taskIds: [...stack.taskIds] } : null
  }

  /** The capacity line of Offen's list (#132), a list item of its own */
  const CAPACITY_LINE = ':scope > [data-testid="capacity-divider"]'
  /** `node` stands after `other` in the document */
  const follows = (node: Node, other: Node) => Boolean(other.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)

  /** The node stands below the capacity line of its list */
  function standsBelowLine(element: Element) {
    const line = element.parentElement?.querySelector(CAPACITY_LINE)
    return Boolean(line && follows(element, line))
  }

  /** A column's own item nodes; never the Jetzt and Wartet cards "Heute" lists behind them on "Alle" (#797) */
  const listItems = (list: Element, except: Element) =>
    [...list.children].filter(child => child !== except && child.hasAttribute('data-task-id') && !child.hasAttribute(TODAY_EXTRA_ATTR))

  /**
   * Puts the dragged node back where the column renders its task, or removes it when it renders
   * none (#146). The decision comes from the store, not from remembered siblings: a sync mid-drag
   * can unmount the fragment of a neighbouring card, and dnd-kit may have moved the node into that
   * fragment, so Vue removed it along with the fragment (it must come back) or the task no longer
   * renders as a draggable card at all (the node is a leftover and would show as a ghost until a
   * reload).
   * - the column still renders the task as a draggable card or as the front of a collapsed stack: place the node before the element of
   *   the next rendered item that exists, else after the last item, else before the drop zone (the add slot sits at the
   *   start of an Offen list, #248, so a node must land after its draft, never before it). If Vue already rendered a fresh wrapper for the task, the old node is the leftover.
   *   Offen's capacity line (#132) keeps the node on the side it stood on at drag start (#833): a node from above the line goes no
   *   further than the line or the Jetzt and Wartet cards of "Heute" above it (#817), a node from below never above the line.
   * - otherwise: remove the node if it is still in the document.
   */
  function restoreDraggedElement(origin: DragOrigin | null) {
    if (!origin) return
    if (origin.fromNotPlanned) {
      restoreNotPlannedElement(origin)
      return
    }
    if (origin.todayExtra) {
      restoreTodayExtraElement(origin)
      return
    }
    const { element, list, taskId, status } = origin
    const order = status === undefined ? null : getRenderedOrder(status)
    if (!order || !list || !order.draggableIds.includes(taskId)) {
      if (element.isConnected) element.remove()
      return
    }

    const siblings = listItems(list, element)
    if (siblings.some(el => isColumnItemNode(el) && el.getAttribute('data-task-id') === taskId)) {
      if (element.isConnected) element.remove()
      return
    }

    const ids = order.rendered.map(t => t.id)
    const laterIds = ids.slice(ids.indexOf(taskId) + 1)
    const next = laterIds.map(id => siblings.find(el => el.getAttribute('data-task-id') === id)).find(Boolean) ?? null
    const last = siblings[siblings.length - 1]
    const line = list.querySelector(CAPACITY_LINE)
    let anchor: Node | null
    if (line && origin.belowLine) {
      // Below the line: before the next card, else behind the last card or the line, whichever stands lower
      anchor = next ?? (last && follows(last, line) ? last.nextSibling : line.nextSibling)
    } else {
      // Above the line (or none): before the next card while it stands above the line and the extras of "Heute" on "Alle" (#797), else before them
      const end = list.querySelector(`:scope > [${TODAY_EXTRA_ATTR}], ${CAPACITY_LINE}`)
      if (next && !(end && follows(next, end))) anchor = next
      else anchor = end ?? (last ? last.nextSibling : list.querySelector(':scope > .column-drop-zone'))
    }
    // Already there (the anchor is the node itself when it stands right behind the last card or the line)
    if (element.parentNode === list && (anchor === element || element.nextSibling === anchor || (anchor !== null && element.nextElementSibling === anchor))) return
    list.insertBefore(element, anchor)
  }

  /**
   * The same for a Jetzt or Wartet card that "Heute" lists on "Alle" (#797): back before the next such card the column
   * renders (the Jetzt card, then Wartet in its rendered order), else behind the last of them, else above the capacity line or before the drop zone. Removed when
   * the list no longer renders the task there (it left today, the place changed) or Vue already rendered a fresh node.
   */
  function restoreTodayExtraElement(origin: DragOrigin) {
    const { element, list, taskId } = origin
    const ids = onAll()
      ? [...tasksStore.tasksProgress, ...getRenderedOrder(TaskStatus.Waiting).rendered].map(t => t.id)
      : []
    const siblings = list ? [...list.children].filter(child => child !== element && child.hasAttribute(TODAY_EXTRA_ATTR)) : []
    const idOf = (el: Element) => el.getAttribute('data-task-id')
    if (!list || !ids.includes(taskId) || siblings.some(el => idOf(el) === taskId)) {
      if (element.isConnected) element.remove()
      return
    }
    const laterIds = ids.slice(ids.indexOf(taskId) + 1)
    // Behind the last such card, else where the extras stand when there are none: above the capacity line (#817), else before the drop zone
    const lastExtra = siblings[siblings.length - 1]
    const next = laterIds.map(id => siblings.find(el => idOf(el) === id)).find(Boolean)
      ?? (lastExtra ? lastExtra.nextElementSibling : list.querySelector(':scope > [data-testid="capacity-divider"], :scope > .column-drop-zone'))
    if (element.parentNode === list && element.nextElementSibling === next) return
    list.insertBefore(element, next)
  }

  /**
   * The same for a card of "Alle Aufgaben" (#355), whose node dnd-kit moved into Offen's list to preview a slot:
   * back before the next card the side renders (`tasksNotPlanned` under the topic focus), else to the end of its
   * list; removed when the side no longer renders the task or Vue already rendered a fresh node for it. A node that
   * is leaving the list (TransitionGroup) names a task the side no longer renders, so it is never an anchor.
   */
  function restoreNotPlannedElement(origin: DragOrigin) {
    const { element, list, taskId } = origin
    const ids = applyFocus(withoutInCardTask(tasksStore.tasksNotPlanned)).map(t => t.id)
    const idOf = (el: Element) => el.getAttribute('data-not-planned-id')
    const siblings = list ? [...list.children].filter(child => child !== element && idOf(child) !== null) : []
    if (!list || !ids.includes(taskId) || siblings.some(el => idOf(el) === taskId)) {
      if (element.isConnected) element.remove()
      return
    }
    const laterIds = ids.slice(ids.indexOf(taskId) + 1)
    const next = laterIds.map(id => siblings.find(el => idOf(el) === id)).find(Boolean) ?? null
    if (element.parentNode === list && element.nextElementSibling === next) return
    list.insertBefore(element, next)
  }

  /**
   * The slot dnd-kit previews the card in: the id of the next card or stack in the `status` list
   * (a stack by its first task), null at the end. Undefined when the node is not in that list
   * (a drop-zone drop leaves it in the last column it was sorted into).
   */
  function readNextItemId(element: Element | undefined, status: TaskStatus): string | null | undefined {
    if (element?.parentElement?.getAttribute('data-task-status') !== String(status)) return undefined
    for (let el = element.nextElementSibling; el; el = el.nextElementSibling) {
      // The Jetzt and Wartet cards of "Heute" on "Alle" (#797) follow Offen's own cards and are no slot of Offen's order
      if (isColumnItemNode(el) && !el.hasAttribute(TODAY_EXTRA_ATTR)) return el.getAttribute('data-task-id')
    }
    return null
  }

  /**
   * The slot of a Wartet card sorted among the Wartet cards "Heute" lists on "Alle" (#797): the id of the next card of its
   * status in that list, null at the end. Undefined when the node is not among them.
   */
  function readNextExtraId(element: Element | undefined, status: TaskStatus): string | null | undefined {
    if (!element?.parentElement || !element.hasAttribute(TODAY_EXTRA_ATTR)) return undefined
    for (let el = element.nextElementSibling; el; el = el.nextElementSibling) {
      if (el.getAttribute(TODAY_EXTRA_ATTR) === String(status)) return el.getAttribute('data-task-id')
    }
    return null
  }

  /**
   * Moves `taskIds` (one card, or the members of a stack in their order) to the dropped slot and
   * saves the column order. The slot is the one dnd-kit previews: before `nextId`, the card or stack
   * that follows the dragged node (#135). Without a readable DOM, dnd-kit's `index` is mapped
   * against the draggable list (a collapsed stack counts once, by its front task): after the
   * draggable at `index - 1` for a downward move (dnd-kit inserts `afterend`), else before the one
   * at `index`. Grouping then decides the section, and the saved order is the resulting rendered
   * order. A drop that leaves it unchanged saves nothing, so the column sorting does not switch to
   * manual. Tasks the column does not render keep their relative order behind the rendered ones.
   * The members of an expanded stack are draggable too (#147), so the draggable list follows the
   * column's expanded groups. A member dropped outside its own group's span within the column
   * changes nothing: grouping decides the order, it does not switch to a manual one. A whole stack
   * leaves no group behind, so it can be placed among the groups, but a drop above the ungrouped
   * tasks snaps back; dropped next to a group of its own
   * key it merges with it (grouping keeps same-key tasks together, the earlier task fronts the stack).
   */
  function saveRenderedOrder(
    status: TaskStatus,
    taskIds: readonly string[],
    slot: { nextId: string | null | undefined; index: number; downward: boolean; sameColumn?: boolean },
  ) {
    const tasks = getRenderedTasks(status)
    const moving = taskIds.flatMap(id => tasks.find(t => t.id === id) ?? [])
    const first = moving[0]
    if (!first) return
    const movingIds = new Set(moving.map(t => t.id))
    const groupKey = getColumnGroupKey(status)
    const expanded = stacks.expandedKeys(status)
    const before = getRenderedTaskOrder(tasks, groupKey, expanded).rendered.map(t => t.id)

    const { rendered, draggableIds } = getRenderedTaskOrder(tasks.filter(t => !movingIds.has(t.id)), groupKey, expanded)
    const indexOf = (id: string | undefined) => rendered.findIndex(t => t.id === id)
    // The last rendered task of a draggable item: for a collapsed stack (listed by its front task)
    // its last member, so a slot "after" a stack is behind all of it
    const endOf = (id: string | undefined) => {
      const start = indexOf(id)
      const task = rendered[start]
      if (start === -1 || !task || groupKey === null || !shouldTaskBeGrouped(task, groupKey)) return start
      const key = deriveGroupKeyForTask(task, groupKey)
      if (expanded.includes(key)) return start
      let end = start
      for (let t = rendered[end + 1]; t && shouldTaskBeGrouped(t, groupKey) && deriveGroupKeyForTask(t, groupKey) === key; t = rendered[end + 1]) end++
      return end
    }
    let at = slot.nextId === null ? rendered.length : indexOf(slot.nextId)
    if (at === -1) {
      const index = Math.min(Math.max(slot.index, 0), draggableIds.length)
      const next = indexOf(draggableIds[index])
      const prev = endOf(draggableIds[index - 1])
      at = slot.downward
        ? prev !== -1 ? prev + 1 : next !== -1 ? next : rendered.length
        : next !== -1 ? next : prev !== -1 ? prev + 1 : rendered.length
    }

    if (slot.sameColumn && groupKey !== null && shouldTaskBeGrouped(first, groupKey)) {
      const own = deriveGroupKeyForTask(first, groupKey)
      const mates = rendered.flatMap((t, i) =>
        shouldTaskBeGrouped(t, groupKey) && deriveGroupKeyForTask(t, groupKey) === own ? [i] : [])
      // The group's span: from its first member to the slot below its last one
      if (mates.length > 0 && (at < Math.min(...mates) || at > Math.max(...mates) + 1)) return
    }
    // A whole stack asked for a place among the ungrouped tasks (which render first): grouping
    // would put it somewhere else, so it snaps back instead (#150, "Same column")
    if (slot.sameColumn && groupKey !== null && moving.every(t => shouldTaskBeGrouped(t, groupKey))) {
      const lastUngrouped = rendered.findLastIndex(t => !shouldTaskBeGrouped(t, groupKey))
      if (at <= lastUngrouped) return
    }
    rendered.splice(at, 0, ...moving)

    const after = getRenderedTaskOrder(rendered, groupKey, expanded).rendered.map(t => t.id)
    if (after.every((id, i) => id === before[i])) return
    const renderedIds = new Set(after)
    const hidden = getTasksByStatus(status).map(t => t.id).filter(id => !renderedIds.has(id))
    boardStore.saveTaskOrder({ taskStatus: status, taskOrder: [...after, ...hidden] })
  }

  function onDragStart(event: {
    operation: { source: { id: string | number; group?: unknown; element?: Element | undefined } | null }
  }) {
    const { source } = event.operation
    if (!source) return
    const element = source.element
    const taskId = String(source.id)
    boardStore.endTimeboxNudge(taskId) // a drag ends the card's nudge (#389)
    const fromNotPlanned = source.group === NOT_PLANNED_GROUP
    dragOrigin = element
      ? {
          element,
          list: element.parentElement,
          taskId,
          status: fromNotPlanned ? undefined : source.group as TaskStatus | undefined,
          fromNotPlanned,
          todayExtra: element.hasAttribute(TODAY_EXTRA_ATTR),
          belowLine: standsBelowLine(element),
        }
      : null
    dragStack = readStack(source)
    dragManager = (source as { manager?: DragManager }).manager ?? null
    dragState.value.isDragging = true
    dragState.value.draggedTaskId = taskId
    dragState.value.draggedStack = dragStack ? { ...dragStack, taskIds: [...dragStack.taskIds] } : null
    dragState.value.sourceStatus = fromNotPlanned ? null : (source.group as TaskStatus) ?? null
    dragState.value.fromNotPlanned = fromNotPlanned
    dragState.value.overNotPlanned = false
    dragState.value.hoverTargetStatus = null
    dragState.value.isDropBlocked = false
    dragState.value.swapTaskId = null
  }

  function onDragOver(event: { operation: { source: unknown; target: unknown }; preventDefault: () => void }) {
    const source = event.operation.source
    const target = event.operation.target

    // The swap state (#162) lasts only while the pointer is over Jetzt: no target at all ends it too
    if (!target) dragState.value.swapTaskId = null
    // The "Alle Aufgaben" side as target (#355): it answers itself (BoardNotPlanned), no column is hovered
    dragState.value.overNotPlanned = isNotPlannedZone(target)
    if (dragState.value.overNotPlanned) {
      dragState.value.hoverTargetStatus = null
      dragState.value.isDropBlocked = false
      dragState.value.swapTaskId = null
      return
    }
    if (!isSortable(source as never) || !target) return

    // Resolve target column status from sortable group or ColumnDropZone data
    let targetGroup: TaskStatus | undefined
    if (isSortable(target as never)) {
      targetGroup = (target as { group: unknown }).group as TaskStatus | undefined
    } else {
      // Plain droppable (ColumnDropZone) — read taskStatus from data
      const targetData = (target as { data?: { taskStatus?: TaskStatus } }).data
      targetGroup = targetData?.taskStatus
    }

    const fromNotPlanned = (source as { initialGroup?: unknown }).initialGroup === NOT_PLANNED_GROUP
    // Its own slot under "Alle Aufgaben" is no column
    if ((targetGroup as unknown) === NOT_PLANNED_GROUP) targetGroup = undefined
    // On "Alle" every card a drag can reach stands in the column headed "Heute" (#797: the Jetzt and Wartet cards too), so
    // that is the column the pointer is over, whatever the card's own status
    const all = onAll()
    dragState.value.hoverTargetStatus = all && targetGroup !== undefined ? TaskStatus.Open : targetGroup ?? null

    // "Alle" (#797): "Heute" lists the Jetzt and Wartet cards behind Offen's own, and no drop there changes a status. A card is
    // sorted only among the cards of the status it started in; over any other card it stays where it is (no swap either)
    if (all && !staysInOwnGroup((source as { initialGroup?: unknown }).initialGroup, targetGroup)) {
      dragState.value.isDropBlocked = false
      dragState.value.swapTaskId = null
      event.preventDefault()
      return
    }

    // A "Alle Aufgaben" card goes to Offen only (#355). The other columns are out of reach on "Alle" (inert, out of
    // layout); should one be hit all the same, the card must not be sorted into it
    if (fromNotPlanned && targetGroup !== undefined && targetGroup !== TaskStatus.Open) {
      dragState.value.isDropBlocked = false
      dragState.value.swapTaskId = null
      event.preventDefault()
      return
    }

    // Reset drop-blocked when not hovering Progress
    if (targetGroup !== TaskStatus.Progress) {
      dragState.value.isDropBlocked = false
      dragState.value.swapTaskId = null
      return
    }

    // WIP limit: Progress column accepts at most 1 task. The column the drag started in decides,
    // not the sortable's `group`: that follows the card into every column it was sorted into, so a
    // Jetzt card pulled out over Offen and back would read as an Offen card entering a full Jetzt (#372)
    const { initialGroup, group } = source as { initialGroup?: unknown; group?: unknown }
    const sourceGroup = (initialGroup ?? group) as TaskStatus | undefined
    if (sourceGroup === TaskStatus.Progress) {
      dragState.value.isDropBlocked = false
      dragState.value.swapTaskId = null
      return // reorder within progress is fine
    }

    // A single card over a Jetzt that holds one other task swaps instead of being refused (#162): the
    // running card shows the swap state, the drop is decided in onDragEnd. The card still must not move
    // into Jetzt, so the drag-over stays prevented.
    const dragged = dragStack ?? readStack(source)
    if (canSwapIntoProgress({
      incomingStatus: (sourceGroup ?? TaskStatus.Open) as TaskStatus,
      progressCount: tasksStore.tasksProgress.length,
      taskCount: dragged?.taskIds.length ?? 1,
    })) {
      dragState.value.swapTaskId = tasksStore.tasksProgress[0]?.id ?? null
      dragState.value.isDropBlocked = false
      event.preventDefault()
      return
    }
    dragState.value.swapTaskId = null

    const verdict = checkWipMove({
      currentStatus: (sourceGroup ?? TaskStatus.Open) as TaskStatus,
      targetStatus: TaskStatus.Progress,
      progressCount: tasksStore.tasksProgress.length,
      taskCount: (dragStack ?? readStack(source))?.taskIds.length ?? 1,
    })
    if (!verdict.allowed) {
      dragState.value.isDropBlocked = true
      event.preventDefault()
    } else {
      dragState.value.isDropBlocked = false
    }
  }

  function onDragEnd(event: { canceled: boolean; operation: { source: unknown; target: unknown } }) {
    const swapOnDrop = Boolean(dragState.value.swapTaskId) && !event.canceled
    dragState.value.swapTaskId = null
    dragState.value.isDragging = false
    dragState.value.draggedTaskId = null
    dragState.value.draggedStack = null
    dragState.value.sourceStatus = null
    dragState.value.hoverTargetStatus = null
    dragState.value.isDropBlocked = false
    dragState.value.ghostCount = 0
    dragState.value.fromNotPlanned = false
    dragState.value.overNotPlanned = false

    const origin = dragOrigin
    dragOrigin = null
    const stack = dragStack
    dragStack = null
    dragManager = null
    cancelDroppableRefresh()

    // A canceled drag: dnd-kit reverts the node only relative to a sibling in the origin list, so the
    // sole card of a column (Jetzt holds one) would stay in the column it was sorted into (#424)
    if (event.canceled) {
      restoreDraggedElement(origin)
      return
    }

    const { source, target } = event.operation
    if (!isSortable(source as never)) return

    const sortable = source as {
      id: string | number
      initialIndex: number
      index: number
      initialGroup: unknown
      group: unknown
      element?: Element | undefined
      data?: unknown
    }

    const { id, initialIndex, index, initialGroup, group } = sortable

    // Between "Alle Aufgaben" and Offen (#355): no status changes, so this ends before the column logic and the WIP check
    const planDrop = resolvePlanDrop(sortable, target)
    if (planDrop !== null) {
      // The slot the card previews in Offen, read before the node goes back
      const slotNextId = planDrop === 'plan' ? readNextItemId(sortable.element, TaskStatus.Open) : undefined
      restoreDraggedElement(origin)
      if (planDrop === 'plan') {
        const taskId = String(id)
        if (!planTask(taskId)) return
        void afterPlan(taskId)
        // A waiting task off today (#793) is planned and keeps Wartet: it lands at the end of that column, never in Offen's order
        if (tasksStore.task(taskId)?.status !== TaskStatus.Open) return
        // Not in Offen's list: the drop went on the column's drop zone, below the cards
        saveRenderedOrder(TaskStatus.Open, [taskId], { nextId: slotNextId === undefined ? null : slotNextId, index: 0, downward: false })
        if (import.meta.dev) console.log('[DnD] plan', { taskId, before: slotNextId })
      } else if (planDrop === 'unplan') {
        const members = stack ?? readStack(sortable)
        const taskIds = members ? members.taskIds : [String(id)]
        // Each task goes on top of "Alle Aufgaben": last member first, so a stack keeps its order there
        let taken = false
        for (const taskId of [...taskIds].reverse()) {
          const moved = unplanTask(taskId)
          // One toast for one card: a stack carried over never raises one per member
          if (moved && taskIds.length === 1) void afterPutBack(taskId)
          taken = moved || taken
        }
        // The card lands on top: with the page scrolled down that is out of view, so the page scrolls to it and the drop
        // glide ends on a card in view (#609; the arrow's move does the same, usePlanMoves)
        if (taken && origin?.list) {
          void nextTick().then(() => {
            Array.from(document.querySelectorAll<HTMLElement>('#column-not-planned [data-not-planned-id]'))
              .find(el => el.dataset.notPlannedId === taskIds[0])
              ?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' })
          })
        }
        if (import.meta.dev) console.log('[DnD] unplan', { taskIds })
      }
      return
    }
    const srcStatus = initialGroup as TaskStatus | undefined

    // Determine target status. A ColumnDropZone target (plain droppable with data.taskStatus) is
    // authoritative: the sortable `group` only follows sortable-to-sortable moves, so after the
    // pointer crossed another column it would still name that intermediate column (the empty area
    // under a short Erledigt list would then drop the card into e.g. Wartet).
    let tgtStatus = group as TaskStatus | undefined
    if (target && !isSortable(target as never)) {
      const targetData = (target as { data?: { taskStatus?: TaskStatus } }).data
      if (targetData?.taskStatus !== undefined) {
        tgtStatus = targetData.taskStatus
      }
    }

    // Read the previewed slot, then put the node back: whatever the store update below does (or
    // a drop that changes nothing), Vue renders it from the DOM it knows
    const nextId = tgtStatus === undefined
      ? undefined
      : origin?.todayExtra ? readNextExtraId(sortable.element, tgtStatus) : readNextItemId(sortable.element, tgtStatus)
    restoreDraggedElement(origin)

    if (srcStatus === undefined || tgtStatus === undefined) return
    // "Alle" (#797): no drop changes a status. `onDragOver` keeps a card among its own, but a drop zone names its column
    // whatever was hovered last (a Jetzt or Wartet card of "Heute" released below the list)
    if (srcStatus !== tgtStatus && onAll()) return

    // The members this drop moves: the stack as it was at drag start (else as the sortable carries it
    // now), minus those that no longer exist or left the source column meanwhile. A single card is
    // just itself. Nothing left: nothing to do.
    const block = stack ?? readStack(sortable)
    const ids = block
      ? block.taskIds.filter(taskId => tasksStore.task(taskId)?.status === srcStatus)
      : [String(id)]
    if (ids.length === 0) return

    // Dropped on the running card (#162): swap. The store decides again at the drop (Jetzt may have
    // emptied or changed meanwhile); when it no longer swaps, the drop goes on as an ordinary move.
    if (swapOnDrop && srcStatus !== TaskStatus.Progress && !block && swapIntoProgress(ids[0]!)) {
      if (import.meta.dev) console.log('[DnD] swap', { taskId: ids[0], from: srcStatus })
      return
    }

    // WIP limit is enforced in onDragOver, but the target resolved above can differ from the last
    // hover (drop-zone override, stale group). Re-check so Jetzt never ends up with two tasks. A
    // stack never fits, whatever Jetzt holds, so the check counts the whole stack as it was picked up.
    if (srcStatus !== tgtStatus) {
      const verdict = checkWipMove({
        currentStatus: srcStatus,
        targetStatus: tgtStatus,
        progressCount: tasksStore.tasksProgress.length,
        taskCount: block?.taskIds.length ?? 1,
      })
      if (!verdict.allowed) return
    }

    if (srcStatus === tgtStatus) {
      // Same-column reorder
      if (initialIndex === index) return

      saveRenderedOrder(srcStatus, ids, { nextId, index, downward: index > initialIndex, sameColumn: true })

      if (import.meta.dev) {
        console.log('[DnD] reorder', { taskIds: ids, srcStatus, from: initialIndex, to: index })
      }
    } else {
      // Cross-column transfer
      // Shared status-change path: applies status, completedAt and statistics synchronously
      // (still inside onDragEnd), then syncs upstream. Sync errors are handled inside. A stack moves
      // every member locally at once and writes upstream one member after another.
      const completing = tgtStatus === TaskStatus.Done && block !== null
      const snapshots = completing ? captureCompletionSnapshots(ids) : []
      // Per-write failures are handled inside; the catch is for anything that escapes the chain
      const reportFailure = (error: unknown) => handleSyncError(error, `Failed to move ${ids.join(', ')} to ${tgtStatus}`)
      if (block) {
        updateTaskStatuses(ids, tgtStatus).catch(reportFailure)
      } else {
        updateTaskStatus({ taskId: ids[0]!, status: tgtStatus }).catch(reportFailure)
      }

      // Place the card (or the block) at the dropped index in the target column (the status change
      // above has already put it into that column's list)
      saveRenderedOrder(tgtStatus, ids, { nextId, index, downward: false })

      // Timebox nudge (#389): a timebox-less card dropped into Jetzt asks for one (a block never fits in Jetzt)
      if (tgtStatus === TaskStatus.Progress) boardStore.startTimeboxNudge(ids[0]!)

      // In-card done confirmation (#124): every dropped card. A stack gets one undo toast for all
      // of them (#150)
      if (tgtStatus === TaskStatus.Done) {
        ids.forEach(taskId => boardStore.startConfirmation(taskId, finishedFasterThanPlan(tasksStore.task(taskId))))
        if (completing) notifyCompletedBlock(snapshots)
      }

      if (import.meta.dev) {
        console.log('[DnD] transfer', { taskIds: ids, from: srcStatus, to: tgtStatus, atIndex: index })
      }
    }
  }

  return {
    onDragStart,
    onDragOver,
    onDragEnd,
    refreshDroppableShapes,
  }
}
