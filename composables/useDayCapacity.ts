/**
 * @module useDayCapacity
 * @description The key of the Offen list item after which the day is full (#132), for the capacity divider. Reads
 * Jetzt and Wartet from the tasks store, the tracked work sessions from the statistics store and the user-set working day (#306) from the settings store; the maths is in
 * `lib/dayCapacity`. A card without a time box counts what similar finished tasks took (`lib/learnedEstimate` over `completionRecords`, #302), else 30 min; the estimator is rebuilt only when the records change. Wartet follows the topic focus like the Offen list does, so one scope is counted (Jetzt never hides). Off (null) when `enabled` is false. Recomputes with the board, the sessions and the day.
 */
import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { capacityLineAfter, plannedMinutes, remainingDayMinutes } from '~/lib/dayCapacity'
import { createEstimator } from '~/lib/learnedEstimate'
import { useSettingsStore } from '~/store/settings'
import { useTaskStatisticsStore } from '~/store/taskStatistics'
import { useTasksStore } from '~/store/tasks'
import type { ColumnItem } from '~/types/columnItem'
import { useBoardFocus } from '~/composables/useBoardFocus'
import { useToday } from '~/composables/useToday'

export function useDayCapacity(items: MaybeRefOrGetter<ColumnItem[]>, enabled: MaybeRefOrGetter<boolean>) {
  const tasks = useTasksStore()
  const statistics = useTaskStatisticsStore()
  const settings = useSettingsStore()
  const { today } = useToday()
  const { applyFocus } = useBoardFocus()

  // Rebuilt when `completionRecords` changes (records tokenized once), not with every board change
  const estimator = computed(() => createEstimator(statistics.completionRecords))

  const lineAfterKey = computed<string | null>(() => {
    if (!toValue(enabled)) return null
    void today.value
    return capacityLineAfter(toValue(items), {
      usedMinutes: plannedMinutes([...tasks.tasksProgress, ...applyFocus(tasks.tasksWaiting)], estimator.value),
      capacityMinutes: remainingDayMinutes(statistics.workSessions, new Date(), settings.workingHoursMinutes),
      estimate: estimator.value,
    })
  })

  return { lineAfterKey }
}
