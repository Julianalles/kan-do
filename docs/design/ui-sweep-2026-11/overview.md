# UI consistency sweep 2026-11: overview

## Summary

- 117 items from 100 findings, audited commit `e6786ddc`: 40 obvious fixes (items 1 to 40), 40 proposals (41 to 80), 9 rule candidates (81 to 89), 17 guards (90 to 106), 11 already tracked issues (107 to 117).
- Most valuable 1: item 54, one setup shell for Notion and Reminders in the welcome flow and in settings. It closes three open issues (#562, #575, #577) in one batch and removes the largest inconsistency the walk saw.
- Most valuable 2: item 82 with its guard, item 101. "A view arrives as one piece" was corrected ten times and is still broken in the measured places of ten items (19, 21 to 24, 41, 43, 46, 69, 73); the guard keeps it from coming back.
- Most valuable 3: item 27, 23 controls under the 44 px floor on a phone. Measured, no choice open, small each.
- Blind test: 4 of 4 known issues found unprompted. Three layouts for one kind of flow: items 54 and 56. The plain connection choice in the welcome flow: item 76. Layout shift entering the Notion setup: items 21 and 109 (#577). Redundant text: items 30 and 81.
- Nothing in the app has changed and no issue is filed. Every finding is in exactly one group, or in two where its own text splits it.

How to answer: tick the boxes of what you want done, or reply in chat with the item numbers (for example "1 to 40 except 7, 54, 82 yes, 89 no").

## Obvious fixes

A named rule of `DESIGN.md` is broken or a defect is measured. No design choice is open, unless the item says "one decision".

### Type and headings (8 items, 24 places)

- [x] **1. The task title in its sheet is 24 px, the type table says 22 px**
  - Where: the task sheet's title at both sizes (`components/task/TaskDetailContent.vue:69`).
  - Why: `DESIGN.md` "Type" names Headline, 22 px, for "the title of a task in its sheet". Measured 24 px.
  - Change: give the title the Headline size token.
  - Effort: small
  - Ref: rendered-1, source-23

- [ ] **2. The note text in the task sheet is 16 px, the rows beside it are 14 px**
  - Where: the "Notiz" value in the task sheet, both sizes.
  - Why: `DESIGN.md` "Type" gives notes the Body size (14 px, 15 px on a phone). It may be deliberate; no record of that was found.
  - Change: the Body size token for the note, read and edit state.
  - Effort: small
  - Ref: rendered-2

- [x] **3. Four small group headings write their type by hand, in two different ways**
  - Where: `components/nav/MorePanel.vue:42` and `:85` (12 px, weight 600), `TopicEditor.vue:24` and `:47` (12 px, weight 500).
  - Why: `DESIGN.md` "Head a section" says no hand-written heading classes. The label role of `SectionHeader` is exactly this look.
  - Change: use `SectionHeader size="label"` in the four places.
  - Effort: small
  - Ref: source-4

- [x] **4. The title of the add sheet and the phone drawer writes the sub-heading role by hand**
  - Where: `components/task/TaskSheet.vue:112`.
  - Why: same rule as item 3; a test allows this file by name instead of the file following the rule.
  - Change: give the overlay title the Subhead role through one named utility or the `SectionHeader` role string, and take the file off the test's allow list. The title sits in an overlay slot, so `SectionHeader` itself may not fit.
  - Effort: small
  - Ref: baseline-3, source-4

- [x] **5. The trash page's main heading is smaller and plainer than the group heading under it**
  - Where: `/trash`, filled and empty: "Gelöschte Aufgaben" is 16 px regular, the group heading "Heute" below it is 22 px in the display face.
  - Why: hierarchy is upside down; both are hand-written headings.
  - Change: `SectionHeader` for both, the page-level one not below the group-level one.
  - Effort: small
  - Ref: rendered-7

- [x] **6. Two sheets in Einstellungen have no heading**
  - Where: `/settings`, tabs "Board" and "System". The tab "Aufgabenspeicher" and every sub-page have one.
  - Why: `DESIGN.md` "Layout": "a heading names each sheet".
  - Change: add a heading to the two sheets.
  - Effort: small
  - Ref: rendered-20

- [x] **7. Weight 600 is used on text that is no key figure, in thirteen places**
  - Where: group headings in the Mehr panel, step numbers and the current step's name in the setup rail and the Notion dialog, the command palette's group label, the picked suggestion, the remaining time in the task sheet, the topic in the focus pill, the capacity labels, the done confirmation line on a card, and 2 more places, see the reference.
  - Why: `DESIGN.md` "The One Role Rule": 400 to 500, and 600 for a key figure only.
  - Change: step them to 500. Some may be meant (the picked suggestion is told apart by weight); for those, name in the rule what else may be 600.
  - Effort: small
  - Ref: source-5

- [x] **8. The sort control under a column name carries a 12 px label and a hand-written hover**
  - Where: `components/board/ColumnSortingControl.vue:28-33`.
  - Why: buttons use the 14 px interface size; the test for that checks the theme, not a class at the call site. It may be a deliberate quiet control; the source does not record it.
  - Change: drop the class so it is the plain ghost button, or record it as a listed exception beside the other small board controls.
  - Effort: small
  - Ref: source-10

### Spacing and alignment (3 items, 25 places)

- [x] **9. Eighteen spacing values and icon sizes sit off the 4 px grid**
  - Where: nine utility classes on the 10 and 14 px half steps (among them `RemindersTodayRules`, `TaskCarryOverTriage`, `SourceRow`, `LocalStorageDetails`, `DayCloseSummary`, `DayCloseTimebox`, `ChoiceCard`), five values in component styles (`BoardNotPlanned`, `TaskCard`, `TaskTimeboxNudge`, `BoardFocusBar`, `NewCardFlow`), and four icons sized 13, 14, 14 and 18 px.
  - Why: `DESIGN.md` "Space, size and shape": the 4 px grid with 2 and 6 px as the only half steps; icons are 12, 16, 20 or 24 px.
  - Change: move each to the neighbouring step. Each moves something by 1 to 2 px.
  - Effort: small
  - Ref: baseline-4, source-13

- [x] **10. Left edges miss each other by 8 to 40 px in six places**
  - Where: the welcome Notion flow (step content starts at a different edge on the first step than on later ones; on a phone the field sits 16 px right of the back button), the Notion setup dialog (body 40 px right of title and footer), `/settings/notion` (link and button 12 px apart), the `/settings` tabs (first label 16 px right of the sheet), the task sheet (label "Notiz" 10 px above the row line of "Status").
  - Why: things that belong together share an edge; all six are measured. The tab label may be a normal padded tab.
  - Change: one content edge per shell; fix each place. The dialog place falls away if item 54 is done.
  - Effort: small
  - Ref: rendered-8, feedback-15

- [x] **11. In Statistik one tile's expand button sits 10 px below its heading**
  - Where: `/statistics`, tile "Wann arbeite ich?"; in the three tiles above, button and heading share a line.
  - Why: measured misalignment.
  - Change: align the button with the heading.
  - Effort: small
  - Ref: rendered-29

### States, hover and button form (7 items, 14 places)

- [x] **12. Five pressable elements do not answer hover**
  - Where: the title and the note in the task sheet, the "Metadaten" toggle, the line "Alle erledigten Aufgaben" in Statistik, the colour swatches in the topic editor.
  - Why: `DESIGN.md` "States", Hover. A control that does not answer was corrected four times before (#55, #425, #296, #25).
  - Change: the dotted rule or the row tint for the two editable texts, the ghost fill for the two toggles, a ring step for the swatch.
  - Effort: small
  - Ref: rendered-10, feedback-11

- [x] **13. A row of the statistics table shows no hover**
  - Where: `/statistics`, "Alle erledigten Aufgaben" (`components/statistics/TasksTable.vue:185-192`): the hover colour is white on a white sheet.
  - Why: `DESIGN.md` "Show a list row": a muted tint on hover.
  - Change: the muted tint of the list row, set in the table theme of `app.config.ts` instead of a local style.
  - Effort: small
  - Ref: source-15, rendered-11

- [x] **14. A disabled segmented choice dims to 60 %, the rule says 50 %**
  - Where: `components/ui/SegmentedChoice.vue:60-62`. The block also sets no `not-allowed` cursor; whether the base layer gives it was not checked.
  - Why: `DESIGN.md` "States", Disabled.
  - Change: 50 % and the cursor, or let the base layer's disabled rule reach the group.
  - Effort: small
  - Ref: source-16

- [x] **15. A failing source is red on the app bar and orange in its row**
  - Where: with a failing Notion connection, the dot on the Mehr button is raspberry and the row's "Verbindung prüfen" is orange.
  - Why: `DESIGN.md` "Colour" gives each state one colour (orange: a connection that needs a look; raspberry: destructive and failed).
  - Change: one colour for the state in both places. One decision: which of the two.
  - Effort: small
  - Ref: rendered-12

- [x] **16. A failure in the Reminders setup is a plain red text line, not the notice**
  - Where: welcome, Apple Reminders setup, connection failed (`components/setup/RemindersSetupFlow.vue:80`).
  - Why: every other failure inside a flow is the subtle alert (22 files); `DESIGN.md` "Tell the user something".
  - Change: render it as the subtle error alert like the other setup steps. #575 changes the same flow but not this line.
  - Effort: small
  - Ref: baseline-2

- [x] **17. The destructive button of a row has three looks**
  - Where: soft red is the rule and is used in six places. Off the rule: `components/settings/GithubTokenRow.vue:49` and `components/task/TaskCarryOverTriage.vue:87` (grey with only the icon red), `pages/settings/reminders.vue:69` ("Trennen", a red ghost button).
  - Why: `DESIGN.md` "Trigger an action": the destructive one is soft in the error tone; you asked for exactly this in #216.
  - Change: make the three soft red and drop the two icon colour overrides.
  - Effort: small
  - Ref: source-7, feedback-8

- [x] **18. Saving the database in the Notion settings is a text link beside a real button**
  - Where: `pages/settings/notion.vue:128`: the save action is a link-style button beside a soft "Abbrechen", so the main action of the pair is the lighter one.
  - Why: `DESIGN.md` "Trigger an action": a link belongs inside running text.
  - Change: the save becomes the row's soft or solid action.
  - Effort: small
  - Ref: source-8

### Motion and layout stability (8 items, about 45 places)

- [x] **19. Where the page transition runs, the new page fades in below the old one and jumps up by a screen**
  - Where: Einstellungen to Themen and back, and every change between Statistik, Einstellungen, Papierkorb and Themen (`components/AppShell.vue:33-41`, `assets/css/transitions.css:7-26`).
  - Why: the new page's header starts 744 px too low at 1280 (844 to 884 px on a phone) and lands in one step, so the fade is seen only as a pop.
  - Change: take the leaving page out of the flow while it fades, or let the old page leave before the new one enters.
  - Effort: small
  - Ref: motion-1, feedback-2

- [x] **20. Reduced motion is not instant in seven places**
  - Where: the page transition, the task sheet's content (rises 8 px), the delete gap, the "Metadaten" fold and its caret, the setup rail's connector, the column headers during a drag, the scrim of dialogs, the palette and the add form.
  - Why: `DESIGN.md` "Motion": reduced motion makes it instant. The first four still move something.
  - Change: one global reduced-motion rule that zeroes transitions and animations, with the few progress indicators (spinner, the delete gap's drain, the nudge's countdown) as named exceptions; then delete the per-component rules it replaces.
  - Effort: small
  - Ref: motion-3

- [x] **21. The Notion setup on the welcome page changes the sheet's height in one frame at every step**
  - Where: welcome, Notion flow, each "Weiter" (`components/setup/NotionSetupFlow.vue:159`; the same code in the Reminders flow, not recorded).
  - Why: the footer button jumps 114, 180 and 188 px at 1280; on a phone the whole sheet with the wordmark jumps 124 and 180 px. `DESIGN.md` "Motion" gives a surface changing size 300 ms, and #577 asks for "no sudden sheet size changes".
  - Change: the guided height change the welcome sheet already uses one level up, or a fixed pane height per flow. #577 names the entry into the setup, not the steps inside it; best done with it and item 54.
  - Effort: medium
  - Ref: motion-4

- [x] **22. The Mehr panel changes its content while it fades out**
  - Where: Mehr to Einstellungen and Mehr to Papierkorb from the board (`components/nav/MorePanel.vue`).
  - Why: at about half opacity the panel shrinks from 368 to 146 px high on a phone (350 to 171 px at 1280) and moves, because its rows depend on the new route. Visible for about 50 ms.
  - Change: freeze the panel's rows while it closes.
  - Effort: small
  - Ref: motion-6

- [x] **23. Undoing a delete snaps the cards below by 84 px; the delete itself glides them**
  - Where: board, "Rückgängig" in the gap a deleted card leaves (`components/task/TaskDeletedGap.vue`).
  - Why: `DESIGN.md` "Motion": neighbours make room in 200 ms.
  - Change: open the slot with the same 200 ms the gap closes with.
  - Effort: small
  - Ref: motion-10

- [x] **24. In the task sheet an error line and a chevron make content jump**
  - Where: a title validation error moves every row down 18 px; the "Metadaten" chevron sits beside the label when closed and jumps 190 px to the right when open.
  - Why: content moves without the user asking for motion.
  - Change: reserve the error line under the title; keep the chevron in one place.
  - Effort: small
  - Ref: rendered-4

- [x] **25. Durations and easings sit just beside the motion tokens**
  - Where: literal 140, 180, 220, 240, 260 and 280 ms (up to 27 in the source, for example `TaskCard.vue:572`, `TaskDeletedGap.vue`, `TaskTimeboxNudge.vue`, `NewCardFlow.vue`), and the `ease` keyword on the page transition, the app bar colours and the setup rail.
  - Why: `DESIGN.md` "Motion" has three durations and two easings; a component with its own choreography records it in its doc block.
  - Change: where no doc block asks for the number, fold 140 into 150, 180 and 220 into 200, 240 to 280 into 300 ms, and the stray curves into a token. One pass rated this a choice, not a fix, since 180 ms can go either way.
  - Effort: medium
  - Ref: motion-13, source-14

- [x] **26. A task link and the add link opened directly animate on page load**
  - Where: `/tasks/<id>` loaded directly plays the sheet's 280 ms opening (the 500 ms drawer on a phone); `/tasks/add` loaded directly opens the draft slot and pushes the cards 144 px.
  - Why: `DESIGN.md` "Motion": "never runs on page load". How often a direct link is loaded in the desktop app is unknown.
  - Change: open both at rest when the route is the first one of the session. The recap on a new day also plays on load; that one is meant, see item 83.
  - Effort: small
  - Ref: motion-12

### Hit areas and clipping (2 items, 24 places)

- [x] **27. 23 controls are under the 44 px floor on a phone**
  - Where: add sheet (the three timebox presets, about 30 px wide and side by side; the title field at 40 px), the task title while edited, the in-card add flow ("Zurück" and "Überspringen" at 32 px, "Optionen anzeigen"), ten colour swatches in the topic editor at 40 px, three checkboxes in the welcome flow, the Mehr panel's "Thema" chip and switches, "Alle" in the app bar with four places, and two text links in the Notion setup and settings.
  - Why: `DESIGN.md` "Space, size and shape": a 44 px floor for every control on a phone. The checkbox and switch rows may already be tappable through their label; not tested.
  - Change: bring each to the floor (a larger hit area is enough for the swatches and the round buttons); for a switch or checkbox make the whole row the target and say so in the rule.
  - Effort: small each
  - Ref: rendered-3

- [x] **28. The Notion settings tabs are cut off on a phone**
  - Where: `/settings/notion` at 390 px: the third tab reads "Weitere F" at the screen edge, the fourth is not visible. Whether a swipe scrolls the row was not tried.
  - Why: clipped content with no cue.
  - Change: let the row scroll with a visible cue, or drop the icons on a phone so four labels fit.
  - Effort: small
  - Ref: rendered-9

### Copy and wording (8 items, 22 places)

- [x] **29. Spelling and name forms on the welcome page**
  - Where: "Todoist (Bald verfübar)" (`i18n/locales/de.json:1363`; Einstellungen writes "bald verfügbar"), "Das Kanban Board mit dem du deine Aufgaben …" (hyphen and comma missing), and the product name as "kan-do", "Kan-do" and "Kan-Do" on different steps.
  - Why: the copy rules name "Kan-Do" for running text and a hyphen in compounds; it is the second screen a new user sees.
  - Change: fix the four strings.
  - Effort: small
  - Ref: rendered-32, feedback-14

- [x] **30. Four settings places say the same thing twice, and one page has three names**
  - Where: "Aufgabenspeicher" (the tab's lead and the sheet's first paragraph both say where new tasks are saved), `/settings/data` ("Noch keine Sicherung" and 40 px below "Noch keine Sicherungen. …"), `/settings/notion` ("Datenbank" four times, and a subtitle that repeats the title), the "System" tab (row "Import/Export und App-Reset" opens a page titled "Daten & Speicher" with a sheet "Daten exportieren / importieren").
  - Why: you removed repeating text ten times before; see item 81.
  - Change: drop the second statement in each place; one name for the data page, used by its link.
  - Effort: small
  - Ref: rendered-33, feedback-1

- [x] **31. Durations are written in three formats and one percent value lacks its space**
  - Where: the statistics table ("1h 10min", "45min", "117%"), the outliers ("3 h geplant, 4 h 4 min gebraucht"), card chips and the Jetzt bar ("1:30 h"), the statistics ring ("70:46 h" beside "70 h 46 min insgesamt").
  - Why: the copy rules ask for one term per concept and a space before the percent sign.
  - Change: one duration format for prose ("1 h 10 min"), one compact form for chips, and the table through the same percent format as the tiles. One decision: which compact form.
  - Effort: small
  - Ref: rendered-6

- [x] **32. The metadata line in the task sheet separates facts with bullets and shows the task's id**
  - Where: task sheet, "Metadaten" open: "Lokal • Erstellt: 19.11.2026, 16:26 • seed-open-1".
  - Why: the copy rules forbid a decorative separator and ask for one element per fact. The character is a bullet, not the middle dot the rule and its guard name.
  - Change: one element per fact; decide whether the id belongs there.
  - Effort: small
  - Ref: rendered-34

- [x] **33. The back button of the local setup step says "Zurück", its sibling says "Zurück zur Auswahl"**
  - Where: `components/setup/LocalSetupFlow.vue:17` against the samples step; both lead to the same start view.
  - Why: `DESIGN.md` "Step back": the label names where it leads; you asked for "Zurück zur Auswahl" in #236.
  - Change: the local step uses "Zurück zur Auswahl". The steps inside a flow are item 55.
  - Effort: small
  - Ref: feedback-9, rendered-18

- [x] **34. The unconnected Reminders settings page shows two back buttons and a subtitle that does not fit**
  - Where: `/settings/reminders` in the desktop app, not connected: "Zurück zu Einstellungen" above the title and "Zurück zur Auswahl" inside the sheet, where no choice came before; the subtitle says "Hier änderst du jederzeit, was du beim Einrichten gewählt hast." before anything was set up.
  - Why: `DESIGN.md` "Step back"; the text says something untrue in this state. Only the first step was rendered.
  - Change: no inner back button on the first step here, and a subtitle for the unconnected state. The cut-off text on the same page is #575.
  - Effort: small
  - Ref: rendered-19

- [x] **35. The `/ui` text of the button still describes two heights**
  - Where: `catalog/action/UButton.catalog.ts:15`; the same text is printed to every agent that searches for a button.
  - Why: The One Height Rule (one height, 36 px, #424).
  - Change: reword the entry to the one height.
  - Effort: small
  - Ref: baseline-7

- [x] **36. Four documents and one script still say "user job" where "user task" is meant**
  - Where: `DESIGN.md:188`, `CLAUDE.md:87`, `CONTRIBUTING.md:105`, `.claude/issue-workflow.md:88`, `scripts/ui-find.mjs:67`.
  - Why: your decision of 2026-11-19; the glossary lists "user job" under "Avoid".
  - Change: replace the wording in the five places.
  - Effort: small
  - Ref: baseline-8

### Theme overrides and dead code (4 items, 17 places)

- [x] **37. Seven call-site overrides change the look of a kit component and belong in the theme**
  - Where: the command palette (group label, row height, highlight), `DataStorageNotice`, `DataFolderChangeModal`, `GithubTokenRow`, `TaskCarryOverTriage`, the app bar's problem dot, the topic editor's caret. The other 21 recorded overrides are placement only.
  - Why: `DESIGN.md` "Guards": no visual identity in a call-site override. The list of exceptions gives all 28 the same "will move" reason although the epic is closed.
  - Change: move the seven (two fall away with item 17, one with item 39) and reword the reason of the 21 to "keep: placement" in `tests/config/ui-prop.baseline.json`.
  - Effort: small to medium
  - Ref: baseline-1, source-12

- [x] **38. The green wash of the chip is written as a literal colour mix in five places**
  - Where: `components/ui/ChoiceChip.vue:52` and `:68`, `components/board/BoardFocusBar.vue:111`, `:144`, `:170`.
  - Why: token values live in `main.css`; the focus pill copies the chip's two percentages instead of sharing them.
  - Change: two tokens (the wash and its hover step), used by both.
  - Effort: small
  - Ref: source-3

- [x] **39. The flat note is a restyled alert at two call sites**
  - Where: `pages/trash.vue:26-31` and `components/settings/DataStorageNotice.vue:31`; both remove the ring and tighten the padding by hand.
  - Why: same rule as item 37; `DESIGN.md` names "one quiet line above the content" without an element for it.
  - Change: a named flat variant of the alert in `app.config.ts`, used by both and offered to the reset section in the data settings.
  - Effort: small
  - Ref: source-11

- [x] **40. Two empty style blocks and one dead transition**
  - Where: `pages/index.vue:26`, `pages/tasks.vue:313`, and the unused `.modal-*` classes in `pages/tasks.vue:301-311`.
  - Why: dead code; no transition is named `modal`.
  - Change: delete the three.
  - Effort: small
  - Ref: source-1

## Proposals

A change that involves a choice. Ordered by confidence, then by how visible the place is in the daily flow.

### High confidence

- [x] **41. Opening the topic focus pushes the whole board down 52 px in one frame**
  - Where: Heute at 1280, the funnel beside the Mehr button (`components/board/BoardFocusBar.vue`). The page also becomes scrollable, and picking a topic re-lays the columns in one frame.
  - Why: `DESIGN.md` "Motion" gives neighbours making room 200 ms; see item 82.
  - Change: open the chip row as a guided height change, or place it where it pushes nothing (a reserved row or over the board's top margin).
  - Effort: small
  - Confidence: high, measured in two passes
  - Needs a design round: no
  - Ref: motion-8, rendered-4

- [x] **42. The "Fokus" pill is the one bar still fixed over the list on a phone**
  - Where: Heute on a phone with a topic picked: a 48 px bar fixed above the app bar (`components/board/BoardFocusBar.vue:148-155`). In the screenshot with two cards it covered nothing.
  - Why: you removed four fixed bars over the phone list for covering tasks (#248, #297, #373, #566); see item 85.
  - Change: move the pill into the app bar beside the funnel, or to the head of the column.
  - Effort: medium
  - Confidence: high that it is fixed over the list; it may be wanted as a standing reminder
  - Needs a design round: yes
  - Ref: rendered-25, feedback-5

- [x] **43. "Karten stapeln" moves away from the finger on a phone, and grouping re-lays the board in one frame**
  - Where: Mehr panel, the "Karten stapeln" switch (`components/nav/MorePanel.vue:44-56`). On a phone the panel grows and the switch moves 56 px one frame after the tap; behind it cards jump up to 912 px.
  - Why: a control should not move when pressed; expanding a single stack is a 200 ms motion with no jump.
  - Change: reserve the room of the group-by chips (or grow the phone panel only above the switch), and decide whether turning grouping on deserves the stack motion.
  - Effort: small (panel), medium (regrouping)
  - Confidence: high for the switch, medium for the regrouping, which happens behind the open panel
  - Needs a design round: no for the panel, yes for the regrouping
  - Ref: motion-7
  - Result: the regrouping glides in #610 (`useBoardGlide`, regroup a); the panel part is built as a collapsible row of the Mehr panel.

- [x] **44. "Alle" scrolls two ways, and its phone heading is a size the type table does not have**
  - Where: `/all` at 1280: "Meine Aufgaben" is its own scroll area while the "Heute" column grows the page. On a phone the heading "Meine Aufgaben" is 27 px, every other column heading 36 px (`components/board/BoardNotPlanned.vue:382`).
  - Why: one scroll model per page; `DESIGN.md` "Type" has no 27 px step.
  - Change: one scroll model for both columns; a shorter heading or a recorded fit rule on a phone. #573 touches the same page's bottom space.
  - Effort: medium
  - Confidence: high for the numbers
  - Needs a design round: yes
  - Ref: rendered-24, source-6

- [x] **45. Changing the place has three behaviours: slide, fade and hard cut**
  - Where: Heute and Alle slide (420 ms); Statistik, Einstellungen, Papierkorb and Themen fade between each other; every change to or from the board is a cut. Only 15 of 42 route pairs run the page transition.
  - Why: inconsistent with itself; `DESIGN.md` "Motion" names no route change. The cause of the missing pairs was not looked for.
  - Change: decide one answer for a place change that is not Heute and Alle (a short fade everywhere, or none anywhere) and make every pair do it.
  - Effort: small to medium
  - Confidence: high for the measurement, medium for which answer is right
  - Needs a design round: no (one decision)
  - Ref: motion-2

- [x] **46. Opening and closing a part is built six ways, and five of them open in one frame**
  - Where: no motion: the "Gestern erledigt" note (cards jump 42 px), the statistics tiles (neighbours move 552 px), the topic editor's panel at 1280 (page grows 331 px), the timebox step of the in-card add flow (card grows 22 px), the task sheet when its status changes (96 px shorter). With motion: stacks, "Metadaten", the delete gap, the add slot. Six different toggles and carets, see the reference.
  - Why: inconsistent with each other; `DESIGN.md` has no line for this user task and gives a surface changing size 300 ms.
  - Change: pick one caret, one side for it and one motion for "a block opens in place", record it in `DESIGN.md` and apply it to the five. The statistics tile needs its own answer because it changes its column span.
  - Effort: medium
  - Confidence: high for the measurements, medium for the statistics tile
  - Needs a design round: yes (the affordance and the statistics tile)
  - Ref: baseline-6, motion-9
  - Result: built in #610 (caret a, motion a 300 ms, tile b), see `DESIGN.md` "Open a block in place".

- [x] **47. The buttons at the foot of a dialog or flow have five layouts**
  - Where: add sheet (cancel at the left edge, main at the right), Notion setup dialog (cancel left, back and next together right), topic editor and trash confirmations (both together), disconnect dialog (three full-width buttons stacked, main on top), welcome steps (one full-width button, or one 96 px button at the right).
  - Why: `DESIGN.md` "Trigger an action" says neutral cancel first, main action last, and nothing about placement.
  - Change: one footer per surface kind (dialog, side sheet, flow step) and a line for the stacked case.
  - Effort: medium
  - Confidence: high that they differ
  - Needs a design round: yes
  - Ref: rendered-15

- [x] **48. `DESIGN.md` gives the task sheet two corner radii**
  - Where: "Space, size and shape" says card, sheet, dialog and menu all take 16 px; "The task sheet" says 32 px corners. The code follows the second.
  - Why: the document disagrees with itself, and the closed radius scale has no 32.
  - Change: name the 32 px as a recorded exception of the radius scale, or bring the sheet to 16 px.
  - Effort: small (text) or medium (the sheet's opening motion ends in that radius)
  - Confidence: high that the text disagrees; the choice is yours
  - Needs a design round: no for the text, yes if the radius changes
  - Ref: baseline-5

- [x] **49. Day close and recap are siblings with different footers, and on a phone the button order is reversed**
  - Where: day close: the way out is a soft button, the main button has no icon, on a phone the way out is on top. Recap: the way out is a ghost button, the main button carries an arrow and a focus ring at rest, on a phone the main button is on top. The title sits 104 px lower and the content is 192 px wider in the recap.
  - Why: inconsistent with each other; `DESIGN.md` has no line for a stage.
  - Change: one stage shell: title position, width, footer, the look of the way out and the stacking order on a phone. #580 covers the day close's entry only.
  - Effort: medium
  - Confidence: high
  - Needs a design round: yes
  - Ref: rendered-16

- [x] **50. Day close and Statistik show the same two facts in different words, order and ink**
  - Where: day close "Timebox" ("deutlich unter / etwa in / deutlich über der Timebox", with a green dot for "within", `components/board/DayCloseTimebox.vue:47`) against Statistik "Wo schätze ich falsch?" ("Länger als geplant / Wie geplant / Kürzer als geplant", reverse order, ink only). Topics: a bar counted in tasks against a ring counted in time, with and without the topic mark.
  - Why: `DESIGN.md` "Charts" allows the ink ramp only, no status colour; the copy rules ask for one term per concept. The green may be meant as "done".
  - Change: the same three terms in the same order and ink in both places; an ink step for "within" or a recorded exception for the green; the topic mark in both legends or in neither.
  - Effort: small
  - Confidence: high that they differ, medium for the green
  - Needs a design round: no
  - Ref: rendered-22, source-19

- [x] **51. Key figures have four sizes and no row in the type table; five texts are 16 px**
  - Where: figures at 16, 24, 30 and 36 px (`DayCloseTimebox.vue:18`, `StatsEstimateRing.vue:15`, `StatsTimeSplit.vue:16`). 16 px text: the line under the stage title in day close and recap, a statistics heading, the command palette's group label, the small donut's figure.
  - Why: `DESIGN.md` "Type" has eight roles and says a value outside the table is a defect or a recorded exception.
  - Change: add a key-figure row to the type table (one or two sizes) and move the figures to it; bring the 16 px texts to Body or Subhead.
  - Effort: small
  - Confidence: high for the sizes; which size the figure gets is the choice
  - Needs a design round: no
  - Ref: source-6

- [x] **52. Seven group headings are hand-written at 14 or 16 px because the heading component has no such size**
  - Where: day close ("Themen", "Timebox"), the feedback dialog (three), the local step of the welcome flow, one statistics heading at 16 px.
  - Why: `DESIGN.md` "Head a section" forbids hand-written heading classes, but `SectionHeader` offers no 14 px role.
  - Change: decide whether the 14 px group heading becomes a sixth role or steps down to the label role, then use it in the seven.
  - Effort: small
  - Confidence: high
  - Needs a design round: no
  - Ref: source-4

- [x] **53. Statistik: a half-empty tile, a hole when a tile opens, and a table 144 rows long**
  - Where: `/statistics` at 1280: "Wie entwickle ich mich?" is 390 px high with content to about 200 px; an opened tile moves to the top at full width and the two left behind leave the third cell empty; with the table open the page is 11,289 px long.
  - Why: spacing rhythm; measured.
  - Change: let the remaining tiles fill the row; page or cap the table.
  - Effort: small to medium
  - Confidence: high for the measures
  - Needs a design round: no
  - Ref: rendered-29

- [x] **54. The setup shell exists three times and looks different each time**
  - Where: the Notion and the Reminders flow of the welcome page hold the same rail, pane and scroll wrapper twice (`components/setup/NotionSetupFlow.vue`, `RemindersSetupFlow.vue`); the Notion setup in settings is a third shell, a dialog with its own green numbered stepper and five steps where the welcome flow has six (`components/notion/setup/NotionSetupModal.vue`). Across them: three progress forms, two heading forms, two button widths, sheets 512 and 768 px wide; on a phone the dialog's step labels break as "Daten-bank".
  - Why: you asked for one component in #562 and a systematic approach in #577; `DESIGN.md` asks for a shared primitive from three call sites on.
  - Change: one setup shell (back button, rail, one pane that changes size as a guided motion, the done beat) used by Notion and Reminders in the welcome flow and in settings; the dialog goes. Best done as one batch with #562, #575, #577 and item 21.
  - Effort: large
  - Confidence: high, three of your open issues point at the same shell
  - Needs a design round: yes for the step heading, button width and phone form; the overall look is decided (#441, #481)
  - Ref: feedback-7, rendered-17, source-21

- [x] **55. Inside a setup flow the back button says only "Zurück"**
  - Where: the Notion flow from the token step on (four steps) and the Reminders flow after its first step.
  - Why: `DESIGN.md` "Step back": the label names where it leads. Inside a flow that may be more text than it is worth.
  - Change: either the rule names the plain "Zurück" as allowed for a step back inside a flow, or each label names the step. One pass rated naming the step a plain fix.
  - Effort: small
  - Confidence: high that rule and app disagree
  - Needs a design round: no
  - Ref: feedback-9, rendered-18

- [x] **56. Einstellungen and its sub-pages differ in tab form, column width and row height**
  - Where: tabs: `/settings` 16 px labels in 44 px (recorded reason, #333), `/settings/topics` 14 px in 32 px, `/settings/notion` a vertical list with icons. Column: 672 px on topics, data, GitHub and Reminders, 992 px on Notion. Rows of "Eine App verbinden": 56 px with a button, 44 px without.
  - Why: sibling pages that look like different apps.
  - Change: one tab size for sibling pages or a recorded reason per page; decide whether Notion keeps its wide column. The two missing sheet headings are item 6.
  - Effort: medium
  - Confidence: high
  - Needs a design round: no
  - Ref: rendered-20

- [x] **57. Saving a token looks different on its two pages**
  - Where: `/settings/github`: a soft "Speichern" beside the field and an ink link with an icon. `/settings/notion`: a solid "Speichern" at the foot of the sheet, disabled at rest, and a green link with a typed arrow.
  - Why: the same user task with two forms; no shared element exists for it.
  - Change: one token row and one external-link look (see item 58).
  - Effort: medium
  - Confidence: high that they differ
  - Needs a design round: no
  - Ref: rendered-21

- [x] **58. A text link inside a sentence has five looks**
  - Where: nine links: underlined in the text colour (`pages/settings/data.vue:18` and three more), green with underline on hover only (`pages/settings/notion.vue:79`), green, medium weight and always underlined (`BoardColumn.vue:111`), grey underlined (`SyncWarningModal.vue:122`), dark ink underlined (`GithubTokenRow.vue`).
  - Why: `DESIGN.md` "Colour" names links as forest green; seven of the nine are not.
  - Change: one text-link look (colour, underline at rest or on hover, focus ring) as the theme of the link component, used by all nine; the external link keeps its icon.
  - Effort: small
  - Confidence: high for the count; the look is the choice
  - Needs a design round: no
  - Ref: source-9

- [x] **59. A link-style button stands alone as an action in six places**
  - Where: `pages/settings/notion.vue:97` ("Datenbank ändern"), `pages/settings/updates.vue:36` ("Was ist neu"), the update dialog, "show all" in the statistics patterns, reload and "show all" in the backup list. Three of them strip the padding by hand so the text sits flush left.
  - Why: `DESIGN.md` "Trigger an action": a link belongs inside running text.
  - Change: decide once: the ghost button, or a named flush-left text action in the theme.
  - Effort: small
  - Confidence: high that rule and code disagree, medium on the replacement
  - Needs a design round: no
  - Ref: source-8

- [x] **60. "Loading" has three hand-made spinners**
  - Where: `pages/settings/notion.vue:109`, the database step of the Notion setup, `GithubTokenRow.vue:33`. They differ in glyph and colour, and only the third stops under reduced motion.
  - Why: `DESIGN.md` "States", Loading, wants one answer.
  - Change: one loading line (icon, text, reduced motion) as a small kit element, used by the three.
  - Effort: small
  - Confidence: high
  - Needs a design round: no
  - Ref: source-22

### Medium confidence

- [ ] **61. On a fresh board the Jetzt slot and the Wartet heading are not painted**
  - Where: after "Tag neu planen" in the recap, Heute at both sizes. Both are invisible but present for screen readers, the heading as "Wartet?".
  - Why: `DESIGN.md` "Layout": the Jetzt slot is always one card tall, filled or empty. It may be a deliberate empty-board state.
  - Change: paint the slot on the fresh board, or hide both from screen readers too and record the state in `DESIGN.md`.
  - Effort: small
  - Confidence: medium, measured but possibly meant
  - Needs a design round: no
  - Ref: rendered-5

- [x] **62. Two solid green controls show at once in three states**
  - Where: the undo toast's "Rückgängig" beside the add sheet's "Starten"; the funnel as a solid green circle while a topic focus is on; the switch and the chosen group-by chip in the Mehr panel.
  - Why: `DESIGN.md` disagrees with itself: The One Lamp Rule says selected options are green without being a fill, "States" says selected is a fill.
  - Change: decide what a selected control and a toast action may look like, then align the two sentences; the app follows.
  - Effort: small (text) to medium
  - Confidence: medium, neither side is clearly the defect
  - Needs a design round: no
  - Ref: rendered-13

- [x] **63. A column's sort control shows only while the pointer is in the column**
  - Where: Heute at 1280. The keyboard reaches it while it is not painted; whether it appears on keyboard focus was not checked.
  - Why: a control the keyboard reaches should be visible at least on focus. #579 is about the shake this hover causes.
  - Change: show it on keyboard focus as well, or always in the quiet tone.
  - Effort: small
  - Confidence: medium
  - Needs a design round: no
  - Ref: rendered-14

- [x] **64. On "Alle" the cards under "Meine Aufgaben" show a source icon, the cards under "Heute" do not**
  - Where: `/all` with one source, both sizes.
  - Why: inconsistent within one screen; `DESIGN.md` shows the icon "when the card names its source". A reason may be recorded for the unplanned item.
  - Change: one rule for when a card names its source, applied to both columns.
  - Effort: small
  - Confidence: medium
  - Needs a design round: no
  - Ref: rendered-23

- [x] **65. The card's context menu draws seven dividers for eleven entries**
  - Where: Heute, right-click a card in Offen. Five entries are each a group of one; "Nicht heute" and "Als ungeplant markieren" sit two lines apart and read alike.
  - Why: a divider per entry groups nothing. #374 is the concept behind the two similar entries.
  - Change: three groups (act now, change a value, copy and delete); reword one of the pair so the difference is in the label.
  - Effort: small
  - Confidence: medium
  - Needs a design round: no
  - Ref: rendered-28

- [x] **66. Nine icon-only buttons have no tooltip**
  - Where: the funnel, the focus bar's end button, the capacity info, the card menu, the task sheet's close, "remove for good" in the trash, the "…" of a source row, the two recap deck arrows.
  - Why: you asked for a tooltip on the icon-only add button (#264), and the funnel's former icon was misread (#470). `DESIGN.md` has no rule.
  - Change: an icon-only button that is not a plain close or a "…" carries a tooltip on pointer devices; at least the funnel, the capacity info and "remove for good".
  - Effort: small
  - Confidence: medium, one explicit correction; which of the nine need it is a choice
  - Needs a design round: no
  - Ref: feedback-10

- [x] **67. The round icon button is drawn seven times in component styles**
  - Where: the column's add button, the stack's close, the card menu, the focus bar's end, the funnel, two in the in-card add flow, the plan arrows. Three sizes and three fills, each restating hover and the phone floor.
  - Why: `DESIGN.md` "Components": kit first, themed in `app.config.ts`. The sizes are allowed; the seven copies are the defect.
  - Change: one round icon-button variant in the button theme that the seven places select. Whether one variant fits the card corner was not tried.
  - Effort: medium
  - Confidence: medium
  - Needs a design round: no (the look stays)
  - Ref: source-2

- [x] **68. Pill-shaped fields and containers exist outside the one named exception**
  - Where: the note field of the in-card add flow and the number field of the timebox nudge (raw inputs in a pill), the segmented choice's track, the phone focus bar (white pill row with the app bar's shadow).
  - Why: `DESIGN.md` says fields take 12 px and "no pill-shaped container" except the app bar's pills. The in-card flow was designed as a whole (#72, #434), so this is likely a missing record.
  - Change: record the in-card question language and the phone focus bar as exceptions, or bring the two fields to the field radius.
  - Effort: small (record) or medium (change)
  - Confidence: medium
  - Needs a design round: no for the record, yes for a change
  - Ref: source-17

- [ ] **69. Dragging a card over an empty column closes its old place in one frame**
  - Where: board, a card of Offen held over the empty Jetzt slot: the card below moves 144 px in one step. In other drags the neighbours glide in 200 ms.
  - Why: `DESIGN.md` "States", Drag: neighbours make room in 200 ms. One recording, this case only.
  - Change: keep the result of #393 (no gap behind a dragged card) but reach it as the usual 200 ms move.
  - Effort: medium
  - Confidence: medium
  - Needs a design round: no
  - Ref: motion-11

- [x] **70. The Jetzt card's progress chip replays its entrance every time Heute is reached from Alle**
  - Where: Alle to Heute (`components/task/TaskProgressChip.vue:205-214`): the chip grows from 24 to 264 px for 900 ms after the board has already arrived.
  - Why: `DESIGN.md` "Motion": motion explains a state change; nothing about the task changed. Measured once.
  - Change: play the chip's motion only when the card enters Jetzt or its time changes.
  - Effort: small
  - Confidence: medium
  - Needs a design round: no
  - Ref: motion-15

- [x] **71. The add sheet shows three field looks in one form, and offers other timeboxes than the nudge**
  - Where: `/tasks/add`: filled selects without a border, a number on a dotted rule, an outlined note field; the title has no field look and starts 12 px right of the labels. Timeboxes offered: 15, 30, 60 here; 15, 30, "eigene Dauer" in the nudge on the Jetzt card.
  - Why: `DESIGN.md` names two looks for a value in a label and value row; the note field is a third.
  - Change: the note in the sheet's own language; one list of offered timeboxes.
  - Effort: medium
  - Confidence: medium
  - Needs a design round: yes
  - Ref: rendered-30

- [x] **72. A ticked checkbox is grey in ten places and green in three**
  - Where: grey in the feedback dialog, the annotator and the local welcome step; green in the task's custom fields, the task form and the restore dialog. The two were not compared on screen.
  - Why: `DESIGN.md` "Colour" (selected options are green) against The One Lamp Rule (green without being a fill).
  - Change: one colour for a ticked checkbox as the theme default, no colour at the call sites.
  - Effort: small
  - Confidence: medium
  - Needs a design round: no
  - Ref: source-18

- [x] **73. The command palette changes height in two frames while typing**
  - Where: the palette at the first key of a query with no result: 576 px to 236 px high.
  - Why: layout stability; common behaviour for palettes, measured once.
  - Change: keep the palette at one height; the list area scrolls or shows its empty line inside it.
  - Effort: small
  - Confidence: medium
  - Needs a design round: no
  - Ref: motion-16

- [x] **74. Menus, dialogs and drawers move on the library's timing, not the app's**
  - Where: every menu, popover, select list and tooltip (100 ms), dialogs and the palette (200 ms, the library's curve), tabs and switches, toasts, and the phone drawer (500 ms).
  - Why: `DESIGN.md` "Motion" has 150, 200 and 300 ms and two easings. Whether the drawer should be shorter is taste.
  - Change: either theme the overlay animations onto the tokens (menus 150 ms, dialogs 200 ms, drawer 300 ms) or record them in `DESIGN.md` as the library's motion that the app keeps.
  - Effort: small to medium
  - Confidence: medium
  - Needs a design round: no
  - Ref: motion-14

- [x] **75. The funnel stays in the app bar on day close and recap, and "Fokus" names two features**
  - Where: day close and recap, both sizes; the funnel is called "Fokus", the setting on `/settings` is "Jetzt-Karte im Fokus".
  - Why: a board filter on a screen with no board; one term for two concepts. #478 is the term registry.
  - Change: hide the funnel while a stage is open; a second word for one of the two features.
  - Effort: small
  - Confidence: medium
  - Needs a design round: no
  - Ref: rendered-31

- [x] **76. The first-run step offers its apps as small round checkboxes that read as radio buttons**
  - Where: welcome, local step: 16 px circles under "Du kannst eine oder mehrere verbinden", two of three disabled, in the app's most spacious step. Einstellungen shows the same apps as a list with icons and buttons, in another order.
  - Why: too light for its place, and inconsistent with the settings list.
  - Change: the choice card or the settings rows for this step, the available app first. You named this yourself on 2026-11-19: for a first-run step with only a few choices, selection elements that are more spacious and carry the official icon of each service.
  - Effort: medium
  - Confidence: medium
  - Needs a design round: yes
  - Ref: rendered-26

- [x] **77. The setup's fact chips look pressable**
  - Where: welcome Notion intro and database step, and the Notion dialog ("Notion-Konto", "Titel", "Fälligkeit" …): outlined pills with an icon that do nothing.
  - Why: `DESIGN.md` gives a small fact the neutral badge; the chip shape belongs to picking an option.
  - Change: the neutral badge, or a plain list with icons.
  - Effort: small
  - Confidence: medium
  - Needs a design round: no
  - Ref: rendered-27

- [x] **78. Confirming "Trennen" is the solid green button when nothing is unsynced**
  - Where: `components/settings/DisconnectSourceDialog.vue:78-80`.
  - Why: The Status Is Not Decoration Rule: green is action or done, red is destructive. The rule's words cover a pair of buttons; a dialog confirm is a reading of it.
  - Change: decide whether a confirming "Trennen" may be green.
  - Effort: small
  - Confidence: medium
  - Needs a design round: no
  - Ref: feedback-8

### Low confidence

- [x] **79. Two lists outside the board show a one-sentence empty note instead of the empty state with a graphic**
  - Where: the statistics task list (`components/statistics/TasksTable.vue:17`) and the backup list (`components/settings/DataBackupList.vue:60`).
  - Why: in #68 you wanted "a calm graph and a subline" outside the board; `DESIGN.md` narrowed that to a page or tab whose main content is a list. The narrowing may be what you accepted in #106, which is why this is low.
  - Change: decide whether these two count as such a place; if yes, they take the empty state.
  - Effort: small
  - Confidence: low
  - Needs a design round: no
  - Ref: feedback-13

- [x] **80. The Reminders list rows show Apple's list colour**
  - Where: welcome, Reminders setup, list choices: a 12 px dot (`components/setup/RemindersListChoices.vue:27-30`), the only colour from outside the tokens.
  - Why: `DESIGN.md` says integration brand colours do not appear. It is the user's own list colour, not a brand colour, so the rule may not be meant for it; probably not worth changing.
  - Change: keep it as a recorded exception, or drop the dot. #575 changes the same list.
  - Effort: small
  - Confidence: low
  - Needs a design round: no
  - Ref: source-20

## Rule candidates

Corrections you gave more than once, worded as a rule to adopt or decline. None of them is in `DESIGN.md`; ticking one sends it through the rule proposal step first.

- [x] **81. Say it once: a heading, description or control that only repeats what its neighbour already says (a stepper label, the page subline, a field label, a labelled button) is left out.**
  - Given: ten times (#441, #480, #568, #431, #575, #581, #434, #237, #238, #367).
  - `DESIGN.md` today: has "One heading level in a menu", for menus and popovers only. Nothing contradicts the rule.
  - Open places: the Reminders step headline (#575), the heading in the Notion settings dialog (#562), the drop note on "Alle" (#581), and item 30.
  - Effort: small
  - Ref: feedback-1

- [x] **82. A view arrives as one piece: the incoming content does not rearrange after it is visible, a surface changes size only as a guided motion, and hover never moves a neighbour.**
  - Given: ten times (#43, #577, #225, #579, #427, #490, #294, #436, #376, #581).
  - `DESIGN.md` today: "Motion" says what motion is for and "States" says a card never moves; nothing forbids unintended movement.
  - Open places: #577, #579, #581, and the measured ones in items 19, 21 to 24, 41, 43, 46, 69 and 73. The guard is item 101.
  - Effort: small for the rule
  - Ref: feedback-2

- [x] **83. A once-a-day key moment (welcome to board, recap, planning to Heute, day close) is a full-size stage and moves slower than a mechanical change; the key moments share the curtain.**
  - Given: six decisions (#433, #463, #245, #480, #295, #400).
  - `DESIGN.md` today: says something else. "Motion" knows only 150, 200 and 300 ms, calls motion "short" and says it "never runs on page load"; the app runs these moments at 420 to 1400 ms and plays the recap on app start, following your decisions.
  - Change: adopt the rule, name two or three key-moment durations as tokens in the Motion table (the eight local values become these), and correct the page-load sentence to name the key moments. No visible change.
  - Effort: small
  - Ref: feedback-3, motion-12, motion-13

- [x] **84. A sheet holds what is operated and the hard data; a page's intro (headline, lead sentence) and a side note lie flat on the canvas.**
  - Given: four times (#238, #217, #428, #437).
  - `DESIGN.md` today: says something else in three lines: "Everything you read, enter or edit lies on a sheet" (line 62), the welcome brand as "the one exception" (line 106), and the trash header still listed as a sheet (line 197). The app already follows your decisions.
  - Change: adopt the rule and correct the three lines. The wording may need a pass.
  - Effort: small
  - Ref: feedback-4

- [x] **85. On a phone only the app bar is fixed over a list; an action or a note sits in the header or at the end of the list.**
  - Given: four times (#248, #297, #373, #566).
  - `DESIGN.md` today: no rule.
  - Open places: the focus pill, item 42. #573 covers the capacity overlay on "Alle".
  - Effort: small
  - Ref: feedback-5

- [x] **86. No scroll area inside a page that scrolls, except a list inside a sheet.**
  - Given: twice (#575, #44).
  - `DESIGN.md` today: no rule.
  - Open places: #575 names the Reminders setup; the Notion flow and the Notion settings dialog have the same scroll wrapper (`components/setup/NotionSetupFlow.vue:53`) and are not in the issue. Fix both flows in one change.
  - Effort: small when done with #575
  - Ref: feedback-6

- [x] **87. What belongs together shares an edge: a heading, a button or a note takes the content edge of the block it belongs to.**
  - Given: nine corrections about edges and gaps, shared with item 88 (#437, #297, #573, #293, #33, #469, #373, #242, #565).
  - `DESIGN.md` today: no named rule. The wording is broad.
  - Open places: item 10.
  - Effort: small
  - Ref: feedback-15

- [x] **88. Nothing is pressed to an edge: a control inside a strip keeps the strip's padding on every side.**
  - Given: within the same nine corrections as item 87 (most directly #293 and #573).
  - `DESIGN.md` today: no named rule.
  - Open places: #573 for the capacity overlay.
  - Effort: small
  - Ref: feedback-15

- [x] **89. A process the user stays in until it is done (a setup, a key moment) is a page or a stage; a dialog is for a question or a short task the user returns from, and carries no header or footer line without a purpose.**
  - Given: three times (#43, #468, #237 with #463). Each was also about its own surface.
  - `DESIGN.md` today: words it the other way round in "Ask in a dialog" ("… For flows that need the whole stage").
  - Open places: the Notion setup dialog in settings (#562, item 54). The three-step feedback dialog fits the rule.
  - Change: adopt the rule and reword the `DESIGN.md` line.
  - Effort: small
  - Ref: feedback-16

## Guards

One per class of obvious fix where a guard was proposed, so the class cannot come back. The first two are the ratchets proposed in the plan; you decide whether they are wanted.

- [x] **90. Ratchet: raw elements per page may only fall**
  - Covers: the proposed rule "pages hold no raw elements", as a count instead of a ban.
  - Today: 110 raw tags in pages and layouts, 61 without layout `div`s. The three settings pages `index` (18), `reminders` (9) and `topics` (7) hold 34 of the 61; a settings row has no shared element.
  - Change: a `tests/config` ratchet on the count without `div`, per file.
  - Effort: small
  - Ref: plan decision; counts from the source scan

- [x] **91. Ratchet: style blocks and inline styles per component may only fall**
  - Covers: the second half of the same proposed rule.
  - Today: 51 style blocks in 50 files (3,345 lines, 82 % in board and task components, which are justified), no static inline style, 41 bound styles in 28 files (38 carry data).
  - Change: a plain block count would only freeze the board. Two narrower counts say more: files with a style block outside board, task, kit, overlay and recap (14 today, 13 after item 40), and the lines of each board and card block.
  - Effort: small
  - Ref: plan decision; counts from the source scan

- [x] **92. Lint: no empty style block**
  - Covers: item 40.
  - Change: the Vue ESLint rule for empty blocks (`vue/no-empty-component-block`; check that the installed version has it), or the count of item 91.
  - Effort: small
  - Ref: source-1

- [x] **93. Ratchet: hand-written headings**
  - Covers: items 3, 4, 5 and 52. Today's test forbids the display face outside five files; any other hand-written heading passes.
  - Change: in `tests/config/display-layout.test.ts`, a count of `h1` to `h6` and `legend` with a text or font class, which may only fall.
  - Effort: small
  - Ref: source-4, baseline-3, source-23

- [x] **94. Ratchet: weight 600**
  - Covers: item 7. Font weight is not checked today.
  - Change: in `tests/config/design-lock-in.test.ts`, a count of weight 600 per file with a reason; the key figures stay listed.
  - Effort: small
  - Ref: source-5, source-23

- [x] **95. Test: no line height through the size class**
  - Covers: item 1. The test forbids `leading-*` but not `text-<size>/<line height>`.
  - Change: extend the pattern in `tests/config/design-lock-in.test.ts:48`.
  - Effort: small
  - Ref: source-23

- [ ] **96. Test: no smaller button height in a style block**
  - Covers: The One Height Rule. The test reads height classes only; a `min-height` in a style block passes (two places in the "Gestern erledigt" note, 32 and 28 px, are not on the list of small-by-design buttons).
  - Change: in `tests/config/button-ladder.test.ts`, a height below 36 px on a class used by a button needs the file on that list.
  - Effort: small
  - Ref: source-23

- [x] **97. Test: a delete button is soft red or sits in a menu**
  - Covers: item 17.
  - Change: in `tests/config/button-ladder.test.ts`, a button with the delete icon is soft in the error tone.
  - Effort: small
  - Ref: source-7

- [x] **98. Ratchet: a look written as a class on a kit component**
  - Covers: items 8, 18, 39 and 59. The existing ratchet counts the override prop only, so a look moved from the prop to a class passes. 16 tags today.
  - Change: a third ratchet in `tests/config/ratchets.test.ts` on text, font, padding-to-zero, ring and background classes on kit components.
  - Effort: small
  - Ref: source-8, source-10, source-11, source-23

- [x] **99. Lint: half steps, off-grid spacing and icon sizes in style blocks**
  - Covers: item 9. Spacing is checked for arbitrary classes only; the icon check reads size classes only.
  - Change: in `scripts/lint/design-tokens.mjs`, flag the 10 and 14 px utilities, padding, margin and gap in style blocks that are off the grid, and width and height on a class an icon carries, with the per-file allow list the script already has.
  - Effort: small
  - Ref: source-13, baseline-4, source-23

- [x] **100. Ratchet: easing keywords and hidden motion values**
  - Covers: item 25. The motion ratchet counts numbers and curves only: 47 easing keywords in 18 files pass, as do 20 durations or curves stored in a custom property and the values passed to scripted animations.
  - Change: add the keywords, the custom properties that hold a time or a curve, and the scripted animation options to the count behind `scripts/lint/literal-baseline.json`.
  - Effort: small to medium
  - Ref: source-14, motion-13, source-23

- [x] **101. Spec: nothing jumps during a transition, and reduced motion is instant**
  - Covers: rule candidate 82 and items 19 to 24. In the recordings a guided motion never exceeded 131 px per frame; every defect was one or two steps of 22 to 912 px.
  - Change: one helper ("no tracked box moves more than n px in a single frame unless allow-listed for that step") in the specs that already walk the welcome and setup steps, the Mehr panel, the disclosures and the undo of a delete; a second assertion under reduced motion (no animation longer than 1 ms except the named indicators). Frame timing on CI needs a trial before it gates.
  - Effort: medium
  - Ref: motion-17, feedback-2, motion-3

- [x] **102. Spec: every hand-built pressable answers hover**
  - Covers: item 12. The rule exists and was broken four times before; 17 raw buttons in 11 files and four elements with a button role are hand-built today.
  - Change: a spec that hovers each on `/ui` and the board and asserts the hand cursor and a changed style.
  - Effort: small
  - Ref: feedback-11, rendered-10

- [x] **103. Spec: phone hit areas on the seeded screens**
  - Covers: item 27. The 23 controls passed every existing check, because the test reads classes and nothing measures a rendered box.
  - Change: one spec that walks the seeded screens at 390 px and asserts 44 × 44 for every visible control or its hit area, with a named exception list.
  - Effort: small
  - Ref: rendered-35

- [ ] **104. Test: no alert role on a plain paragraph**
  - Covers: item 16.
  - Change: add a plain paragraph with `role="alert"` outside a field error to what `warning-notices.test.ts` forbids.
  - Effort: small
  - Ref: baseline-2

- [ ] **105. Spec: the bright-ground contrast check for the day close**
  - Covers: The Bright Ground Rule ("checked, not assumed"). The welcome page and the recap are checked, the day close is not. The contrast itself is fine: title 10.9:1, date 6.8:1 at 1280.
  - Change: the same two contrast lines in `tests/e2e/day-close.spec.ts` at both widths.
  - Effort: small
  - Ref: feedback-12, rendered-36

- [x] **106. Test: durations and percent go through the shared formatter**
  - Covers: item 31.
  - Change: a unit test that no component formats minutes or percent outside the shared formatter.
  - Effort: small
  - Ref: rendered-36

Not guarded on purpose: the table row hover and the disabled look (items 13 and 14) move into the theme, where the `/ui` fingerprint test already sees them. The override list of item 37 already has its ratchet; it only needs the reworded reasons.

## Already tracked

One line per open issue, with what the sweep adds. Tick a line to have the additions written into the issue as a comment.

- [x] **107. #573 (capacity overlay on "Alle")**: the same page also scrolls two ways and has an off-scale phone heading (item 44); the overlay is the tracked place of rule candidates 85 and 88; the capacity echo itself was not walked. Ref: feedback-5, feedback-15, rendered-24
- [x] **108. #575 (room and list options in the Reminders setup)**: the same scroll wrapper is in the Notion flow and the Notion settings dialog (item 86); the Reminders step headline repeats the stepper (item 81); on the unconnected settings page the last paragraph is cut by the inner scroll area (item 34); the failure line and the list colour dot sit in the same flow (items 16 and 80). Ref: feedback-6, feedback-1, rendered-19, baseline-2, source-20, feedback-7
- [x] **109. #577 (shuffling when entering the Notion setup)**: measured: the sheet's width change starts with the leave, so the leaving block stretches from 448 toward 704 px while it fades (12 layout shifts, sum 0.049; one 256 px jump under reduced motion). The steps inside the setup jump too and are not in the issue (item 21); the shared shell is item 54. Ref: motion-5, motion-4, feedback-2, feedback-7, rendered-17
- [x] **110. #579 (list items shake on hover over a column)**: the sort control that appears on that hover is also reachable by keyboard while unpainted (item 63); one of the three open places of rule candidate 82. Ref: feedback-2, rendered-14
- [x] **111. #580 (day close opens with the opposite curtain)**: measured entry 1400 ms, leave 700 ms for the photo and 200 ms for the content; the stage's footer and title differ from the recap's (item 49); the durations belong to rule candidate 83. Ref: feedback-3, rendered-16
- [x] **112. #581 (add button and drop note on "Alle")**: the drop note "Hier ablegen: nicht heute" is one of the places of rule candidate 81 (`components/board/BoardNotPlanned.vue:52`), the appearing and vanishing add button one of rule candidate 82. Ref: feedback-1, feedback-2
- [x] **113. #554 (overlay dimming under the phone browser bar)**: the sweep adds nothing.
- [x] **114. #562 (align the two Notion setup cases)**: the settings dialog has its own green numbered stepper with five steps against six, labels that break on a phone, a body 40 px right of its title, and a heading that repeats the dialog title; Reminders in settings already runs on the page. All of it falls away with item 54; rule candidate 89 names the dialog. Ref: feedback-7, source-21, rendered-17, feedback-1, feedback-16, rendered-8
- [x] **115. #374 (the concept behind "Nicht heute" and unplanned)**: in the card's context menu the two entries sit two lines apart and read alike (item 65). Ref: rendered-28
- [x] **116. #478 (term registry)**: "Fokus" names both the topic filter and the setting "Jetzt-Karte im Fokus" (item 75). Ref: rendered-31
- [x] **117. #587 (leftovers of the floating Now window)**: the sweep adds nothing; the window's fixed pixel values were left out of item 9 for this reason.
