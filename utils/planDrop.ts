import { TaskStatus } from '~/types/taskStatus'

/**
 * The drag between "Meine Aufgaben" and Offen on the place "Alle" (#355, epic #334).
 *
 * A card under "Meine Aufgaben" is a sortable of this group: it can be picked up, but the group takes no card
 * (each of its sortables accepts only itself), so nothing is sorted inside the side. The side as a whole is one
 * droppable that carries `data.notPlannedZone` (a card of the side carries `data.notPlannedCard`).
 */
export const NOT_PLANNED_GROUP = 'not-planned'

/** A sortable's group on the board: a column's status, or the "Meine Aufgaben" side */
export type BoardSortableGroup = TaskStatus | typeof NOT_PLANNED_GROUP

/** The parts of a dnd-kit source and target the rule reads; both are loose shapes of dnd-kit entities */
interface PlanDropSource { initialGroup?: unknown; group?: unknown }
interface PlanDropTarget { group?: unknown; data?: { taskStatus?: TaskStatus; notPlannedZone?: boolean } | undefined }

/** Whether `target` is the droppable of the "Meine Aufgaben" side */
export const isNotPlannedZone = (target: unknown): boolean =>
  (target as PlanDropTarget | null | undefined)?.data?.notPlannedZone === true

/**
 * What a drop means for planning, decided once for the drop handler and the screen-reader line:
 * - `plan`: a "Meine Aufgaben" card dropped on Offen (its node sits in Offen's list, or Offen's drop zone is the target)
 * - `unplan`: an Offen card (or stack) dropped on the "Meine Aufgaben" side
 * - `back`: a "Meine Aufgaben" card dropped anywhere else: it returns to where it was, nothing is stored
 * - `null`: an ordinary board drop, not this rule's business
 */
export function resolvePlanDrop(source: unknown, target: unknown): 'plan' | 'unplan' | 'back' | null {
  const { initialGroup, group } = (source ?? {}) as PlanDropSource
  const overSide = isNotPlannedZone(target)
  if (initialGroup === NOT_PLANNED_GROUP) {
    if (overSide) return 'back'
    const zoneStatus = (target as PlanDropTarget | null | undefined)?.data?.taskStatus
    // A column's drop zone names its column; without one the card is where dnd-kit last sorted it
    const landed = zoneStatus !== undefined ? zoneStatus : group
    return landed === TaskStatus.Open ? 'plan' : 'back'
  }
  if (!overSide) return null
  return initialGroup === TaskStatus.Open ? 'unplan' : 'back'
}

/**
 * The side's `accept`: every card but one of its own that has not left yet. A "Meine Aufgaben" card still in its
 * list finds no target on its own side (a keyboard step goes straight to Offen, a drop there does nothing); once
 * dnd-kit sorted it into Offen, the side takes it back.
 */
export function notPlannedZoneAccepts(source: unknown): boolean {
  const { initialGroup, group } = (source ?? {}) as PlanDropSource
  return !(initialGroup === NOT_PLANNED_GROUP && group === NOT_PLANNED_GROUP)
}
