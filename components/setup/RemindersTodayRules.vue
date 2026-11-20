<!--
@component RemindersTodayRules
@kind component
@category display
@description What the date in Apple Reminders does on the board (#552, today rule a of epic #481): the four-row examples table (which date counts as today) and the line about what Kan-do writes. Explains only; the rules themselves are slice 4.
@usage <RemindersTodayRules show-lead /> as the Heute step of the setup (with the lead) and under "Heute" in the Erinnerungen-Einstellungen (without it)
@avoid Not a control and not a place to change the rule: there is nothing to choose here in v1.
@responsibility
- A real `<table>` (a visually hidden caption, row headers): Heute is the one row that puts a task on the board and is set in the highlight ink, the other three read "In Alle Aufgaben"
- The write line states the one thing Kan-do changes (the date, only when the user plans a task for today) and that Undo restores it
- Pattern: reference table, new (no existing pattern shows a rule as rows; searched: table, rule, explain)
-->
<template>
  <div class="flex flex-col gap-3" data-testid="reminders-today-rules">
    <p v-if="showLead" class="text-body text-default">{{ t('onboarding.flow.reminders.today.lead') }}</p>
    <div class="overflow-hidden rounded-lg border border-default">
    <table class="w-full border-collapse text-sm">
      <caption class="sr-only">{{ t('onboarding.flow.reminders.today.tableLabel') }}</caption>
      <tbody class="divide-y divide-default">
        <tr v-for="row in rows" :key="row.key" :data-testid="`reminders-today-row-${row.key}`">
          <th scope="row" class="px-4 py-3 text-left font-normal text-default">{{ t(`onboarding.flow.reminders.today.row${row.label}`) }}</th>
          <td class="px-4 py-3 text-right" :class="row.onBoard ? 'font-medium text-highlighted' : 'text-muted'">
            {{ row.onBoard ? t('onboarding.flow.reminders.today.onBoard') : t('onboarding.flow.reminders.today.inMyTasks') }}
          </td>
        </tr>
      </tbody>
    </table>
    </div>
    <p class="text-sm text-muted" data-testid="reminders-today-writes">{{ t('onboarding.flow.reminders.today.writes') }}</p>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineOptions({ name: 'RemindersTodayRules' })

withDefaults(defineProps<{
  /** The sentence above the table ("Das Datum in Erinnerungen entscheidet, …"): the setup step has it, the settings section does not */
  showLead?: boolean
}>(), { showLead: false })

const { t } = useI18n()

const rows = [
  { key: 'today', label: 'Today', onBoard: true },
  { key: 'earlier', label: 'Earlier', onBoard: false },
  { key: 'later', label: 'Later', onBoard: false },
  { key: 'none', label: 'None', onBoard: false },
]
</script>
