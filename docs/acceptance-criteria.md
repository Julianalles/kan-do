# Acceptance Criteria

Persistent functional and design invariants. All features, refactors, and improvements must satisfy these before being considered done. Expressed as observable behaviour.

---

## Board & Task Flow

- The board has exactly four columns in this order: **Offen → Jetzt → Wartet → Erledigt**.
  - It is fine if Waiting and In-Progress visually share one column, one top half, one lower half.
- **WIP limit**: The "Jetzt" column accepts at most one task. Dragging a second task onto it is visibly blocked and the task does not transfer.
- Tasks can be dragged between any columns and reordered within any column.
- Moving a task to a new column is reflected immediately in the UI and persisted after a page reload.
- When offline, the board remains fully usable. Changes made offline survive a reconnect without data loss.

## Topics and Activities (#430, #431)

- A topic or activity can be renamed in one place (Einstellungen -> "Themen und Aktivitäten", or the edit mode of the task sheet's picker: Bearbeiten, then the name's row); the new name appears on every task of every status, in the trash, in the statistics and in the option lists, and the old name appears nowhere. A name that already exists merges into it.
- A rename never sends anything to Notion or Todoist. A name a source owns cannot be renamed here (the field says why); its colour and symbol stay editable and apply only in kan-do.
- A topic can carry one of nine hues and one of 24 symbols, shown as a mark before its name (card, sheet, picker, lists); the name itself stays plain text. A topic with neither shows no mark and no gap.
- Colours and symbols survive a reload, an export/import and the desktop data file; an old data file without them loads unchanged.

## Day Counter (Carried-over Cue)

- A not-done card shows nothing on its first board day (no dots, numeral, sheet line or tooltip) on the card and the task sheet; the count is the days a task was planned: a day under "Meine Aufgaben" does not count, and the count is kept there (#356).
- From day 2 the cue reads as a day number: day 2 shows 2 dots, the numeral `2` and "An 2 Tagen eingeplant" (tooltip and accessible name). Day 7 and later show 6 dots, a `+` and the exact numeral.
- A board day is a local calendar date on which the board was opened; days the board stays closed do not count.
- The triage nudge still appears after 4 carried days and its title reads "Tag 5"; Keep re-arms it unchanged.
- Done cards, cards without a counter entry and pending syncs show nothing.

## Day Closing (#98, #237, #480)

- "Tag abschließen" opens a full-size stage on the new-day recap's photo (not a dialog: no scrim, the app bar stays above it, the board is inert), with one centred sheet (max 32 rem, desktop and phone alike): the date as the stage's subline, the progress headline "n von n geplanten Aufgaben erledigt" (planned = done today + still open), or "Alle Aufgaben erledigt" with a trophy when nothing is left open, or the one line "Heute noch nichts erledigt." when nothing was done and nothing is planned. There is no total time, no list, no checkbox and no choice.
- "Timebox" chart: the done tasks with a timebox and tracked time in three cells, "deutlich unter", "etwa in" and "deutlich über der Timebox", each with its count and one dot per task, and the caption "Basis: n erledigte Aufgaben mit Timebox und erfasster Zeit." "Etwa in" = the difference is at most the larger of 5 minutes and 20 % of the box. Without such a task the chart is not shown.
- "Themen" chart: the done tasks by topic (by number of tasks, not time) as one stacked bar in the ink ramp and a legend (topic mark, name, count); the first four topics by count, the rest folded into "Sonstiges", "Ohne Thema" last. Without a named topic the chart is not shown.
- One line above the buttons says what closing does: "Deine unerledigten Aufgaben kannst du morgen erneut einplanen. Die erledigten Aufgaben werden archiviert." (the second sentence only when nothing is unfinished). "Abbrechen, nichts ändert sich" (a regular secondary button) and Escape change nothing; leaving the page does the same. Focus starts on "Abbrechen, nichts ändert sich".
- "Tag abschließen" (the primary) archives today's done tasks and the earlier unacknowledged ones and takes every unfinished task off today's board for "Alle": a Jetzt task stops its timer and goes through Offen, a Wartet task goes through Offen, nothing is deleted and no time or note is lost. A source that stores planning (Notion with a mapped status) gets its "not planned" status written at once. The board (Heute) is empty afterwards; the next morning the Jetzt, Offen and Wartet tasks stand in "Alle" in one panel "Gestern auf dem Board" (that morning only), with no notice and no second fresh start; the recap's "noch offen" deck lists them.

## Drag-and-Drop Visual Behaviour

- While a task is being dragged, its original slot in the list shows a neutral placeholder / ghost item (same size, no content) — the card does not disappear.
- A visual representation of the dragged card follows the pointer (slight tilt, elevated appearance).
- The floating drag card does not intercept pointer events on the board beneath it.
- When dragging over an empty column, a visual drop hint appears to indicate the area is a valid drop target.
- When the WIP limit would be violated, hovering over that column shows a distinct rejection state (no drop accepted).
- After the drag completes or is cancelled, all visual drag states are removed cleanly.

## Time Tracking

- Time spent on a task only ever increases unless a feature for manual correcting timer spent allows it; it never resets or decreases when data is refreshed from an integration.
- A running timer continues counting after a page reload without losing accumulated time.
- If a time sync to an integration fails, the locally tracked time is not discarded — it is retried automatically.
- Optional time box can be set per task.
  - The app provides visual feedback when a time box is soon to be reached.
  - The app provides visual feedback when a time box is reached.

## Integration Setup & Sync

- The setup wizard flow completes end-to-end: credential entry → database/project selection → property mapping → status mapping → board ready.
- All property and status name mappings reflect what the user configured; no values are assumed or hardcoded by the application.
- If the integration service is unreachable, the board still loads and displays the last known task data.
- Status changes made in the app are eventually reflected in the connected integration after sync.

## Visual & UX Invariants

- All user-facing text is in **German**.
- The UI looks correct in both light mode and dark mode — no missing colours, invisible text, or broken contrast.
- Typography: body text uses the sans-serif brand font; headings use the display font. No fonts are loaded from external CDNs.
- The visual style is calm: generous whitespace, flat hierarchy, minimal container nesting. No heavy cards-within-cards patterns.
- When a task is moved to "Erledigt" (drag, keyboard, menu, sheet or palette), a short completion burst of teal pieces flies out around the card once, within about 1 s, as positive reinforcement (#692). It never blocks input, adds no text or sound and does not play on load or undo. Under reduced motion the task completes without animation.

## Accessibility

- Text on all backgrounds meets WCAG AA contrast in both colour modes.
- Every interactive control (button, input, link) has a visible label or accessible name.
- The entire UI is navigable by keyboard: Tab moves focus through all controls; ESC closes any open modal or drawer.
- Delete (the Mac "delete" key, Backspace, too) on a focused board card deletes it with the usual undo, and focus moves to the next card (#579).
- When a modal or overlay opens, focus moves into it. When it closes, focus returns to the triggering element.

## Build & Runtime

- The project builds without TypeScript errors.
- No JavaScript errors appear in the browser console during normal use.
- Application state (board layout, tasks) is restored correctly after a hard reload.
