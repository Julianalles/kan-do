/**
 * The rule of the drag between "Alle Aufgaben" and Offen (#355): what a drop means, and which cards the side takes.
 */
import { describe, it, expect } from 'vitest'
import { TaskStatus } from '~/types/taskStatus'
import { NOT_PLANNED_GROUP, isNotPlannedZone, notPlannedZoneAccepts, resolvePlanDrop, staysInOwnGroup } from '~/utils/planDrop'

const zone = { id: 'not-planned-zone', data: { notPlannedZone: true } }
const dropZone = (taskStatus: TaskStatus) => ({ id: `column-drop-zone-${taskStatus}`, data: { taskStatus } })
const held = (group: unknown = NOT_PLANNED_GROUP) => ({ id: 'np', initialGroup: NOT_PLANNED_GROUP, group, data: { notPlannedCard: true } })
const card = (from: TaskStatus, group: unknown = from) => ({ id: 'card', initialGroup: from, group })

describe('resolvePlanDrop', () => {
  it.each([
    ['sorted into Offen, dropped on an Offen card', held(TaskStatus.Open), card(TaskStatus.Open), 'plan'],
    ['sorted into Offen, dropped on itself', held(TaskStatus.Open), held(TaskStatus.Open), 'plan'],
    ['sorted into Offen, no target under the pointer', held(TaskStatus.Open), null, 'plan'],
    ['still in its list, dropped on the drop zone of Offen', held(), dropZone(TaskStatus.Open), 'plan'],
    ['sorted into Offen, back over its own side', held(TaskStatus.Open), zone, 'back'],
    ['never left its list', held(), null, 'back'],
    ['on its own slot', held(), held(), 'back'],
    ['on the drop zone of another column', held(TaskStatus.Open), dropZone(TaskStatus.Done), 'back'],
    ['sorted into another column', held(TaskStatus.Waiting), null, 'back'],
    // "Heute" on "Alle" lists the Jetzt and Wartet cards (#797): held over one, the drop is still a drop on "Heute"
    ['still in its list, held over a Wartet card of "Heute"', held(), card(TaskStatus.Waiting), 'plan'],
    ['still in its list, held over the Jetzt card of "Heute"', held(), card(TaskStatus.Progress), 'plan'],
    ['still in its list, held over a done card', held(), card(TaskStatus.Done), 'back'],
  ] as const)('a "Alle Aufgaben" card %s: %s', (_label, source, target, expected) => {
    expect(resolvePlanDrop(source, target)).toBe(expected)
  })

  it('an Offen card on the side is taken off; a card of another column is not', () => {
    expect(resolvePlanDrop(card(TaskStatus.Open), zone)).toBe('unplan')
    // The sortable's group follows it through columns: the column it started in decides (#372)
    expect(resolvePlanDrop(card(TaskStatus.Open, TaskStatus.Waiting), zone)).toBe('unplan')
    expect(resolvePlanDrop(card(TaskStatus.Done), zone)).toBe('back')
  })

  it('a Wartet card listed in "Heute" on "Alle" leaves today on the side; the Jetzt card never does (#797)', () => {
    expect(resolvePlanDrop(card(TaskStatus.Waiting), zone)).toBe('unplan')
    expect(resolvePlanDrop(card(TaskStatus.Waiting, TaskStatus.Open), zone)).toBe('unplan')
    expect(resolvePlanDrop(card(TaskStatus.Progress), zone)).toBe('back')
    // The side is no target for the Jetzt card at all: it shows no answer
    expect(notPlannedZoneAccepts(card(TaskStatus.Progress))).toBe(false)
    expect(notPlannedZoneAccepts(card(TaskStatus.Waiting))).toBe(true)
  })

  it('an ordinary board drop is not its business', () => {
    expect(resolvePlanDrop(card(TaskStatus.Open), card(TaskStatus.Waiting))).toBeNull()
    expect(resolvePlanDrop(card(TaskStatus.Open), dropZone(TaskStatus.Done))).toBeNull()
    expect(resolvePlanDrop(card(TaskStatus.Open), null)).toBeNull()
    expect(resolvePlanDrop(null, null)).toBeNull()
  })

  it('a card of the side is not mistaken for the side', () => {
    expect(isNotPlannedZone(held())).toBe(false)
    expect(isNotPlannedZone(zone)).toBe(true)
    expect(isNotPlannedZone(null)).toBe(false)
  })
})

describe('notPlannedZoneAccepts', () => {
  it('takes every card but one of its own that has not left its list', () => {
    expect(notPlannedZoneAccepts(card(TaskStatus.Open))).toBe(true)
    expect(notPlannedZoneAccepts(held())).toBe(false)
    expect(notPlannedZoneAccepts(held(TaskStatus.Open))).toBe(true)
  })
})

describe('staysInOwnGroup', () => {
  it('on "Alle" a card is sorted only among the cards of the status it started in (#797)', () => {
    expect(staysInOwnGroup(TaskStatus.Waiting, TaskStatus.Waiting)).toBe(true)
    expect(staysInOwnGroup(TaskStatus.Waiting, TaskStatus.Open)).toBe(false)
    expect(staysInOwnGroup(TaskStatus.Open, TaskStatus.Waiting)).toBe(false)
    expect(staysInOwnGroup(TaskStatus.Open, TaskStatus.Progress)).toBe(false)
    expect(staysInOwnGroup(TaskStatus.Progress, TaskStatus.Open)).toBe(false)
    expect(staysInOwnGroup(TaskStatus.Open, TaskStatus.Open)).toBe(true)
  })

  it('a "Alle Aufgaben" card goes among Offen\'s cards only; no target or its own side refuses nothing', () => {
    expect(staysInOwnGroup(NOT_PLANNED_GROUP, TaskStatus.Open)).toBe(true)
    expect(staysInOwnGroup(NOT_PLANNED_GROUP, TaskStatus.Waiting)).toBe(false)
    expect(staysInOwnGroup(NOT_PLANNED_GROUP, NOT_PLANNED_GROUP)).toBe(true)
    expect(staysInOwnGroup(TaskStatus.Open, undefined)).toBe(true)
  })
})
