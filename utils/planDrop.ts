import { TaskStatus } from '~/types/taskStatus'
import { canBeOffToday } from '~/lib/taskPlanning'

/**
 * The drag between "Alle Aufgaben" and Offen on the place "Alle" (#355, epic #334).
 *
 * A card under "Alle Aufgaben" is a sortable of this group: it can be picked up, but the group takes no card
 * (each of its sortables accepts only itself), so nothing is sorted inside the side. The side as a whole is one
 * droppable that carries `data.notPlannedZone` (a card of the side carries `data.notPlannedCard`).
 */
export const NOT_PLANNED_GROUP = 'not-planned'

/** A sortable's group on the board: a column's status, or the "Alle Aufgaben" side */
export type BoardSortableGroup = TaskStatus | typeof NOT_PLANNED_GROUP

/** The parts of a dnd-kit source and target the rule reads; both are loose shapes of dnd-kit entities */
interface PlanDropSource { initialGroup?: unknown; group?: unknown }
interface PlanDropTarget { group?: unknown; data?: { taskStatus?: TaskStatus; notPlannedZone?: boolean } | undefined }

/** Whether `target` is the droppable of the "Alle Aufgaben" side */
export const isNotPlannedZone = (target: unknown): boolean =>
  (target as PlanDropTarget | null | undefined)?.data?.notPlannedZone === true

/**
 * What a drop means for planning, decided once for the drop handler and the screen-reader line:
 * - `plan`: a "Alle Aufgaben" card dropped on Offen (its node sits in Offen's list, Offen's drop zone is the target, or
 *   it is held over a Jetzt or Wartet card that "Heute" lists on "Alle", #797)
 * - `unplan`: an Offen card (or stack) dropped on the "Alle Aufgaben" side, or a Wartet card listed in "Heute" there (#797):
 *   it leaves today and keeps Wartet
 * - `back`: a "Alle Aufgaben" card dropped anywhere else: it returns to where it was, nothing is stored
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
    // Held over a Jetzt or Wartet card (#797): those stand in "Heute" on "Alle", the only place this card can meet one,
    // and it is never sorted among them. The drop is still a drop on "Heute"
    const targetGroup = (target as PlanDropTarget | null | undefined)?.group
    const onTodayExtra = targetGroup === TaskStatus.Progress || targetGroup === TaskStatus.Waiting
    return landed === TaskStatus.Open || onTodayExtra ? 'plan' : 'back'
  }
  if (!overSide) return null
  return typeof initialGroup === 'number' && canBeOffToday(initialGroup) ? 'unplan' : 'back'
}

/**
 * The side's `accept`: every card but one of its own that has not left yet. A "Alle Aufgaben" card still in its
 * list finds no target on its own side (a keyboard step goes straight to Offen, a drop there does nothing); once
 * dnd-kit sorted it into Offen, the side takes it back. Never the Jetzt card (#797, listed in "Heute" on "Alle"): Jetzt
 * always belongs to today, so the side is no target for it and shows no answer.
 */
export function notPlannedZoneAccepts(source: unknown): boolean {
  const { initialGroup, group } = (source ?? {}) as PlanDropSource
  if (initialGroup === TaskStatus.Progress) return false
  return !(initialGroup === NOT_PLANNED_GROUP && group === NOT_PLANNED_GROUP)
}

/**
 * Whether a drag on the place "Alle" may sort the card next to `targetGroup` (#797). "Heute" there lists the Jetzt and Wartet
 * cards behind Offen's own, each a sortable of its own status, and no drop on "Alle" changes a status: a card is sorted only
 * among the cards of the status it started in. A "Alle Aufgaben" card goes among Offen's cards (it is planned there).
 */
export function staysInOwnGroup(initialGroup: unknown, targetGroup: unknown): boolean {
  const own = initialGroup === NOT_PLANNED_GROUP ? TaskStatus.Open : initialGroup
  return targetGroup === undefined || targetGroup === NOT_PLANNED_GROUP || targetGroup === own
}
