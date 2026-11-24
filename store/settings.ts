import { defineStore, acceptHMRUpdate } from 'pinia'
import { ref } from 'vue'
import { sanitizeWorkingMinutes } from '~/lib/dayCapacity'
import { freshIntroHints, needsShownDay, sanitizeIntroHints, type IntroHintsRecord } from '~/lib/introHints'

/**
 * App-wide preferences (#394). A store of its own, not a slice of `board-store`: settings are not board
 * configuration, and it travels with export/import and the desktop data file through `PERSISTED_KEYS`.
 *
 * `focusEnabled`: while a task sits in Jetzt, the overlay lets the rest of the board step back (default on).
 * Nothing stored (every existing install) means `true`; hydration writes nothing on its own (#273).
 *
 * `floatingNowEnabled` (#383): the floating Now window shows the Jetzt task over other apps (desktop only, default on).
 * Additive like `focusEnabled`: nothing stored means `true`, a stored non-boolean reads as `true` in memory (no write).
 * The window's position is not here: it is machine-local and Rust keeps it (ADR 020).
 *
 * `autoUpdateCheck` (#746): the desktop app asks GitHub for the latest release about ten seconds after launch (default on).
 * Off: no automatic request at all (GitHub would see the IP address); "Nach Updates suchen" on /settings/updates still
 * checks by hand. Additive like `floatingNowEnabled`: nothing stored or a non-boolean reads as `true` (no write).
 *
 * `workingHoursMinutes` (#306): the working day the user sets for the capacity divider, whole half hours from 1 to
 * 12 h as minutes; `null` = automatic (learned from tracked work). Additive: older data hydrates to `null`, a
 * malformed stored value is dropped in memory by `afterHydrate` (no write; the next mutation persists it).
 *
 * `introHints` (#800): the record of the intro hints (shape and rules: `lib/introHints.ts`). `null` = the hints never
 * started, which is every install from before #800: they see no hint. Only the welcome setup starts them
 * (`startIntroHints`). Additive: nothing stored hydrates to `null`, a malformed value reads as `null` and a malformed
 * hint entry is dropped in memory (`afterHydrate`, no write). It is the app's own data: never sent to a connection.
 * #804: `setIntroHintsOn(false)` turns the hints off (the record stays), `restartIntroHints()` replaces it with a fresh one
 * (also from `null`); the settings' row "Hinweise zum Einstieg" and the link on a hint use them.
 */
export const useSettingsStore = defineStore('settings', () => {
  const focusEnabled = ref(true)

  function setFocusEnabled(value: boolean) {
    focusEnabled.value = value
  }

  const floatingNowEnabled = ref(true)

  function setFloatingNowEnabled(value: boolean) {
    floatingNowEnabled.value = value
  }

  const autoUpdateCheck = ref(true)

  function setAutoUpdateCheck(value: boolean) {
    autoUpdateCheck.value = value
  }

  const workingHoursMinutes = ref<number | null>(null)

  function setWorkingHoursMinutes(value: number | null) {
    workingHoursMinutes.value = sanitizeWorkingMinutes(value)
  }

  const introHints = ref<IntroHintsRecord | null>(null)

  /** The welcome setup's ending: the hints start. A record that is already there is kept (answered hints stay answered). */
  function startIntroHints() {
    if (introHints.value === null) introHints.value = freshIntroHints()
  }

  /** The hint `id` is on screen on `day`: stored once per day, at most three days (`needsShownDay`). */
  function markIntroHintShown(id: string, day: string) {
    const record = introHints.value
    if (!record || !needsShownDay(record, id, day)) return
    const entry = record.hints[id] ?? { answered: false, days: [] }
    introHints.value = { ...record, hints: { ...record.hints, [id]: { ...entry, days: [...entry.days, day] } } }
  }

  /** The user did the step of hint `id`: it ends for good, whether it was on screen or not. */
  function answerIntroHint(id: string) {
    const record = introHints.value
    if (!record || record.hints[id]?.answered) return
    const entry = record.hints[id] ?? { answered: false, days: [] }
    introHints.value = { ...record, hints: { ...record.hints, [id]: { ...entry, answered: true } } }
  }

  /** "Schließen": the hint ends, and no other hint shows for the rest of `day`. */
  function closeIntroHint(id: string, day: string) {
    const record = introHints.value
    if (!record) return
    const entry = record.hints[id] ?? { answered: false, days: [] }
    introHints.value = { ...record, quietDay: day, hints: { ...record.hints, [id]: { ...entry, answered: true } } }
  }

  /** "Hinweise ausschalten" (on a hint or in the settings): no hint shows; the record (answered hints, days) is kept. */
  function setIntroHintsOn(on: boolean) {
    const record = introHints.value
    if (!record || record.on === on) return
    introHints.value = { ...record, on }
  }

  /** "Erneut zeigen" (#804): all hints start again from the first. Also for an install from before #800, which has no record. */
  function restartIntroHints() {
    introHints.value = freshIntroHints()
  }

  return {
    introHints,
    startIntroHints,
    setIntroHintsOn,
    restartIntroHints,
    markIntroHintShown,
    answerIntroHint,
    closeIntroHint,
    focusEnabled,
    setFocusEnabled,
    floatingNowEnabled,
    setFloatingNowEnabled,
    autoUpdateCheck,
    setAutoUpdateCheck,
    workingHoursMinutes,
    setWorkingHoursMinutes,
  }
}, {
  persist: {
    key: 'settings-store',
    pick: ['focusEnabled', 'floatingNowEnabled', 'autoUpdateCheck', 'workingHoursMinutes', 'introHints'],
    afterHydrate: (ctx: { store: { workingHoursMinutes: unknown; floatingNowEnabled: unknown; autoUpdateCheck: unknown; introHints: unknown } }) => {
      ctx.store.workingHoursMinutes = sanitizeWorkingMinutes(ctx.store.workingHoursMinutes)
      if (typeof ctx.store.floatingNowEnabled !== 'boolean') ctx.store.floatingNowEnabled = true
      if (typeof ctx.store.autoUpdateCheck !== 'boolean') ctx.store.autoUpdateCheck = true
      ctx.store.introHints = sanitizeIntroHints(ctx.store.introHints)
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any)

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSettingsStore, import.meta.hot))
}
