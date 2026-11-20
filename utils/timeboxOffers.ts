/**
 * The timeboxes offered as one-click answers: the add sheet's presets and the nudge on the Jetzt card share this one
 * list (#613), so 15 and 30 always mean the same offer. The nudge keeps "eigene Dauer" as its free field; the context
 * menu and the command palette have their own longer list (`TIMEBOX_PRESETS` in `utils/taskMenuOptions.ts`).
 */
export const TIMEBOX_OFFER_MINUTES: readonly number[] = [15, 30, 60]
