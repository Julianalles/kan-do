/**
 * @composable useRemindersHint
 * @description The sentence that explains why a Reminders task is where it is (#553), for the card footer and the sheet.
 * Rules and cases: `lib/remindersHint.ts`; this adds today's date and the words.
 * @responsibility Reactive `{ kind, text, icon }` or `null` for every task that has nothing to explain.
 */
import { computed, type ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToday } from '~/composables/useToday'
import { remindersHint, ruleKeyOf, type RemindersHintKind } from '~/lib/remindersHint'
import { ICONS } from '~/lib/icons'
import { dayKey } from '~/utils/recapDay'
import type { Task } from '~/types/task'

export interface ShownHint {
  kind: RemindersHintKind
  text: string
  icon: string
}

export function useRemindersHint(task: () => Pick<Task, 'source' | 'reminders' | 'status' | 'notPlanned'> | undefined): ComputedRef<ShownHint | null> {
  const { t } = useI18n()
  const { today } = useToday()
  return computed(() => {
    const current = task()
    const hint = current ? remindersHint(current, dayKey(today.value)) : null
    if (!hint) return null
    const rule = hint.recurrence === null ? null : ruleKeyOf(hint.recurrence)
    // A rule the words do not cover is shown as Reminders holds it
    const named = hint.recurrence === null ? '' : rule ? t(rule.key, { n: rule.n }) : hint.recurrence
    return { kind: hint.kind, text: t(hint.key, { rule: named }), icon: hint.kind === 'repeats' ? ICONS.repeats : ICONS.dueToday }
  })
}
