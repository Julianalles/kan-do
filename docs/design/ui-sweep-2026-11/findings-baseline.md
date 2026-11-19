# Findings: baseline

Session 1 of `plan.md`, audited commit `e6786ddc`. Findings of the three earlier audits that are still open and that no open issue covers, plus what turned up while checking them. Source checks only; nothing here was rendered. Status of every earlier finding: `baseline.md`.

### baseline-1: 28 call-site `ui` overrides are still waiting to move into the theme
- User task: several (dialogs, the task sheet, the app bar, fields); see the file list
- Where: 24 files listed in `tests/config/ui-prop.baseline.json` (29 entries; `AppDialog.vue` is the one recorded "keep"): `CommandPalette` ×2, `GithubTokenRow` ×2, `TaskSheet` ×2, `ResponsiveOverlay` ×3, and one each in `ColumnSortingControl`, `NewCardFlow`, `FeedbackDialog`, `AppNav`, `NotionSetupModal`, `DataFolderChangeModal`, `DataStorageNotice`, `TasksTable`, `AddTargetSwitch`, `TaskCard`, `TaskCardContextMenu`, `TaskCarryOverTriage`, `TaskPropertySelect`, `TopicPropertyPicker`, `TopicEditor`, `TopicEditorHost`, `pages/settings/index.vue`, `notion.vue`, `topics.vue`
- Evidence: the baseline file's own reason on each entry: "moves into the app.config.ts theme or a token with its category slice (epic #58 D1)"; the epic is closed and the entries are still there
- Against: `DESIGN.md` "Guards" ("no visual identity in a call-site `ui` prop"); `ui-kit-audit.md` "Buttons, overlays, overrides"
- Proposed change: go through the 28 entries once: move what is identity into the theme or a named variant, and rewrite the reason of what is placement to "keep" so the baseline says what is left.
- Group: obvious fix
- Confidence: medium, because the entries were not opened one by one here; session 3 step 2 says which are identity
- Effort: medium
- Needs design round: no
- Already tracked: no

### baseline-2: a failure in the Reminders setup is a plain red text line, not the notice
- User task: tell the user something (a state inside a flow)
- Where: welcome, Apple Reminders setup, connection failed: `components/setup/RemindersSetupFlow.vue:80` (`<p class="mt-4 text-body text-error" role="alert">`)
- Evidence: source; every other failure inside a flow is a `UAlert` (22 files), and this line uses the base `text-error` step where the status-text rule uses the deep step (`text-error-700`)
- Against: `DESIGN.md` "Components", "Tell the user something" (`UAlert` subtle for a state inside a flow)
- Proposed change: render the failure as `UAlert` subtle error like the other setup steps; add the plain `role="alert"` paragraph to what `warning-notices.test.ts` forbids.
- Group: obvious fix (and a guard: a `role="alert"` on a plain `<p>` outside a field error)
- Confidence: high, read in the source; contrast of the base step on the sheet not measured
- Effort: small
- Needs design round: no
- Already tracked: no (#575 is about the space and the list options of the same flow)

### baseline-3: the task sheet's title writes the sub-heading role by hand
- User task: head a section
- Where: the add sheet and the phone drawer title: `components/task/TaskSheet.vue:112` (`'font-display text-lg font-medium tracking-display …'`)
- Evidence: source; `display-layout.test.ts:36` allows `font-display` in this file by name
- Against: `DESIGN.md` "Components", "Head a section" ("no hand-written heading classes")
- Proposed change: give the overlay title the Subhead role through one named utility or the `SectionHeader` role string, and take the file off the test's allow list.
- Group: obvious fix
- Confidence: medium, because the string is handed to an overlay's title slot class, where `SectionHeader` itself may not fit
- Effort: small
- Needs design round: no
- Already tracked: no

### baseline-4: six spacing classes sit on the 10 and 14 px half steps
- User task: none (foundation)
- Where: `components/setup/RemindersTodayRules.vue` ×2, `components/task/TaskCarryOverTriage.vue`, `components/settings/SourceRow.vue`, `components/settings/LocalStorageDetails.vue`, `components/board/DayCloseSummary.vue` (classes ending in `-2.5` or `-3.5`)
- Evidence: `rg '\b(p|px|py|…|gap|space-[xy])-(2\.5|3\.5)\b'` over components, pages, layouts and `app.config.ts`: 6 hits in 5 files; scoped CSS not counted
- Against: `DESIGN.md` "Space, size and shape" ("the 4 px grid; 2 and 6 px are the only half steps")
- Proposed change: move each to the neighbouring grid step and add the two half steps to the literal guard.
- Group: obvious fix (and a guard)
- Confidence: high for the classes; low for completeness, because padding written in `<style>` blocks is session 3's
- Effort: small
- Needs design round: no
- Already tracked: no

### baseline-5: `DESIGN.md` gives the task sheet two corner radii
- User task: hold content as a surface
- Where: `DESIGN.md` "Space, size and shape" ("card, page sheet, task sheet, dialog and menu all take 16 px") against "Components", "The task sheet" ("720 px wide, 32 px corners"); the code follows the second: `components/task/TaskMorphShell.vue:26` (`rounded-(--task-sheet-radius)`, 32 px per its doc block, line 11)
- Evidence: the two quoted sentences
- Against: `DESIGN.md` against itself; the closed radius scale (8, 12, 16, pill, circle) has no 32
- Proposed change: decide which is meant: name the task sheet's 32 px as a recorded exception of the radius scale, or bring the sheet to 16 px.
- Group: proposal
- Confidence: high that the text disagrees; the choice is the user's
- Effort: small (text) or medium (the morph's end radius)
- Needs design round: no for the text; yes if the radius changes
- Already tracked: no

### baseline-6: opening and closing a part has six implementations
- User task: open and close a part (disclosure)
- Where: native `<details>` in `pages/statistics.vue:27` and `components/sync/SyncWarningModal.vue:104`; `UCollapsible` in `components/task/TaskDetailMetadata.vue`; the heading toggle of `components/statistics/StatsTile.vue:24`; a ghost `UButton` toggle in `components/board/BoardColumnYesterdayNote.vue:40`; `ListRow` action with `expanded` (`pages/settings/topics.vue`, `StatsOutliers`); a "show all" button in `components/settings/DataBackupList.vue:106`
- Evidence: `rg '<details|<summary|aria-expanded'`; `redesign-gap-audit.md` part 2 named "one disclosure affordance (same caret, same motion)" as a merge candidate and the decisions of step 4 do not mention it
- Against: inconsistent with each other; `DESIGN.md` "Components" has no line for this user task
- Proposed change: pick one caret, one side for it and one motion for every disclosure, and add the line to `DESIGN.md`; the components can stay.
- Group: proposal
- Confidence: medium, the count is from the source; how different they look is session 4's comparison
- Effort: medium
- Needs design round: yes
- Already tracked: no

### baseline-7: the `/ui` text of the button still describes two heights
- User task: trigger an action
- Where: `/ui`, entry `UButton`: `catalog/action/UButton.catalog.ts:15` ("in two heights (32 px, and 36 px for the one main action …")
- Evidence: source and the manifest (`npm run ui:find` prints this text to every agent that searches for a button)
- Against: `DESIGN.md` "The One Height Rule" (one height, 36 px, owner 2026-11-17, #424)
- Proposed change: reword the entry to the one height.
- Group: obvious fix
- Confidence: high
- Effort: small
- Needs design round: no
- Already tracked: no

### baseline-8: four documents still say "user job" for a user task
- User task: none (wording)
- Where: `DESIGN.md:188` ("One line per user job"), `CLAUDE.md:87`, `CONTRIBUTING.md:105`, `.claude/issue-workflow.md:88`; also the usage line of `scripts/ui-find.mjs:67` ("<job words>")
- Evidence: `rg -i 'user job'`; `GLOSSARY.md` now lists "user job" under "Avoid"
- Against: `GLOSSARY.md` "User task" (user decision 2026-11-19)
- Proposed change: replace the wording in the four documents and the script's usage line.
- Group: obvious fix
- Confidence: high
- Effort: small
- Needs design round: no
- Already tracked: no
