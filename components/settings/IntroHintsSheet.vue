<!--
@component IntroHintsSheet
@kind component
@category display
@description The sheet "Kurz erklärt" on the Board tab of Einstellungen (#804): the row "Hinweise zum Einstieg" that turns the intro hints off or starts them again, and below it the short help that lists the intro texts. Always readable, hints on or off.
@usage <IntroHintsSheet /> once, in the Board tab of pages/settings/index.vue, under the "Fokus und Arbeitszeit" sheet. It reads and writes the intro hints through `useIntroHintsSwitch`; no props.
@avoid Not a switch row (SettingSwitchRow): the row has two actions, "Ausschalten" and "Erneut zeigen", and the button names the one that applies. Not the hints themselves (IntroHintOverlay on the board). Not a general help or FAQ page.
@responsibility
- The row: label "Hinweise zum Einstieg" and one help line on the left, the button on the right ("Ausschalten" while the hints run, "Erneut zeigen" otherwise, also for an install from before the hints, which has no record); phone: the button full width under the text, 44 px high. The button is described by the label and the help line (`aria-describedby`). Pattern: aligned with the Fokus switch row (label, help, control on the right; a button, since it has two actions)
- "Ausschalten" confirms with the toast of `useIntroHintsSwitch` (the same path as the link on a hint); "Erneut zeigen" starts all hints again from the first, with no toast: the hint itself is the confirmation
- The help: the five intro texts under small captions (Anfangen, Weitermachen, Auswählen, Tag abschließen, Planen), the texts read from the overlay's own keys (`introHintTextKey`) so the help cannot differ from the hints; "Start" in the phone wording at phone width, "Auswahl" and "Abschluss" with the menu names ("Mehr", "Tag abschließen") from the menus. "Planen" (#803) is the planning note of "Alle", read from its own keys through `introHintTextKey`
-->
<template>
  <PageSheet tag="section" data-testid="intro-hints-settings" aria-labelledby="intro-hints-heading">
    <SectionHeader id="intro-hints-heading" tag="h2" class="pb-4">{{ t('settings.introHints.heading') }}</SectionHeader>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-3 pb-6" data-testid="intro-hints-setting">
      <div class="min-w-0 flex-1 basis-56">
        <p id="intro-hints-label" class="text-default">{{ t('settings.introHints.label') }}</p>
        <p id="intro-hints-help" class="text-body text-muted">{{ t('settings.introHints.help') }}</p>
      </div>
      <UButton
        color="neutral"
        variant="soft"
        class="max-sm:w-full max-sm:justify-center"
        aria-describedby="intro-hints-label intro-hints-help"
        data-testid="intro-hints-toggle"
        @click="running ? turnOff() : restart()"
      >
        {{ t(running ? 'settings.introHints.turnOff' : 'settings.introHints.restart') }}
      </UButton>
    </div>
    <ul class="space-y-5 border-t border-default pt-6" data-testid="intro-hints-help-list">
      <li v-for="entry in entries" :key="entry.id" :data-testid="`intro-hints-entry-${entry.id}`">
        <SectionHeader tag="h3" size="label">{{ t(`settings.introHints.entries.${entry.id}`) }}</SectionHeader>
        <p class="text-body text-default">{{ entry.text }}</p>
      </li>
    </ul>
  </PageSheet>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import PageSheet from '~/components/ui/PageSheet.vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import { useIntroHintsSwitch } from '~/composables/useIntroHintsSwitch'
import { useIsPhone } from '~/composables/useIsDesktop'
import { INTRO_HINT_ORDER, INTRO_PLAN_HINT, introHintTextKey } from '~/lib/introHints'

defineOptions({ name: 'IntroHintsSheet' })

const { t } = useI18n()
const { running, turnOff, restart } = useIntroHintsSwitch()
const isPhone = useIsPhone()

const HELP_IDS = [...INTRO_HINT_ORDER, INTRO_PLAN_HINT] as const
const entries = computed(() =>
  HELP_IDS.map((id) => ({ id, text: t(introHintTextKey(id, isPhone.value), { more: t('nav.more'), dayClose: t('nav.dayClose') }) })))
</script>
