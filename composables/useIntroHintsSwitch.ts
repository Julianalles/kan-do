/**
 * @composable useIntroHintsSwitch
 * @description Turning the intro hints off and on again (#804). The link "Hinweise ausschalten" on a hint and the button
 * "Ausschalten" in Einstellungen, Board both call `turnOff`, so the confirmation cannot be missed on one of the two paths;
 * "Erneut zeigen" is `restart`. Call it in setup (the toast needs the app context).
 * @responsibility
 * - `turnOff()`: sets the record's `on` to false (the answered hints and their days stay) and shows a toast that says the
 *   hints are off and that the intros can be read in the settings at any time. A record that is already off or does not
 *   exist writes and says nothing
 * - `restart()`: all hints start again from the first (a fresh record, also for an install from before #800); no toast,
 *   the hint is its own confirmation
 * - `running`: the hints are on, which decides the settings row's button
 * - Nothing here touches a task or a connection
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '#imports'
import { useSettingsStore } from '~/store/settings'

export function useIntroHintsSwitch() {
  const settings = useSettingsStore()
  const toast = useToast()
  const { t } = useI18n()

  const running = computed(() => settings.introHints?.on === true)

  function turnOff(): void {
    if (!running.value) return
    settings.setIntroHintsOn(false)
    toast.add({
      title: t('board.introHint.toast.title'),
      description: t('board.introHint.toast.description'),
      icon: 'i-ph-check-circle',
      color: 'neutral',
      duration: 6000,
    })
  }

  function restart(): void {
    settings.restartIntroHints()
  }

  return { running, turnOff, restart }
}
