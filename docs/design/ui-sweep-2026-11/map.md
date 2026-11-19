# User-task map

Session 1 of `plan.md`, audited commit `e6786ddc`. Job or supporting activity → user task → Pattern → the elements that do it today.

Sources: the manifest (`npm run -s ui:manifest`: 141 app components, 30 Nuxt UI components), `DESIGN.md` "Components" and "Behaviour", the templates of `pages/**`, `layouts/` and `components/AppShell.vue` (raw markup and Nuxt UI used directly), `rg` for each kit element's users. Excluded: `pages/ui.vue`, `pages/error-test.vue`, `components/prototype/`. Nothing was rendered: a verdict here says what the source shows, and session 4 compares the looks.

Verdicts: **settled** (one element, or several with a rule that says which), **convergence candidate** (several elements do the same user task and no rule tells them apart; the reason is given), **gap** (no shared element: raw markup or a per-file solution).

## Part A: jobs and supporting activities, and the user tasks on the way

Numbers refer to part B. A user task that serves every job (trigger an action, tell the user something) is listed under "Everywhere".

| Job or activity | Surfaces | User tasks |
|---|---|---|
| J1 Plan the day | Alle (`/all`), Heute, the new-day recap, the new-day notice, the capacity divider | 28 look through past tasks, 29 key moment, 22 move a task, 23 read a card, 14 answer a question about one card, 9 group or filter the board |
| J2 Capture a new ad-hoc task | the Jetzt slot, the in-card flow in Offen and Alle, the add sheet (`/tasks/add`), the command palette | 20 add a task, 21 set a timebox, 2 pick one of a few, 5 type into a field |
| J3 Decide and pick the next work item | Heute (Offen, stacks, topic focus, sort), the Mehr panel | 22 move a task, 23 read a card, 9 group or filter the board, 17 open a menu |
| J4 Get the planned work done | the Jetzt card and its timer, the timebox nudge, the task sheet, Wartet, the floating Now window | 4 edit a value in a row, 21 set a timebox, 14 answer a question about one card, 12 undo, 23 read a card |
| J5 Review the past day's work | the day-close stage, the new-day recap, the Yesterday note | 29 key moment, 28 look through past tasks, 27 read a chart, 18 open and close a part |
| J6 Learn from previous work | Statistik, `/statistics/:id` | 27 read a chart, 18 open and close a part, 8 choose an option in a page, 28 look through past tasks |
| Supporting: setup | welcome and its four flows, the Notion setup dialog | 10 walk through a setup, 2 pick one of a few, 25 enter a token, 30 step back |
| Supporting: settings | `/settings` and its sub-pages | 6 change a setting, 7 show a list row, 26 save or discard a section, 31 switch a view in a page |
| Supporting: data safety | `/settings/data`, the trash, the data notices, the sync warning | 11 confirm an irreversible action, 12 undo, 15 tell the user something |
| Supporting: feedback and updates | the feedback dialog, `/settings/updates`, "What's new" | 13 ask in a dialog, 10 walk through a setup (the three steps), 15 tell the user something |
| Everywhere | | 1 trigger an action, 15 tell the user something, 16 show an empty place, 19 show loading, 24 head a page or a section, 32 hold content as a surface, 33 move between places, 3 switch on or off |

## Part B: user task → Pattern → elements → verdict

### 1. Trigger an action
- Pattern (`DESIGN.md`): "Trigger an action": `UButton`, one height, solid for the one main action, soft, ghost, link.
- Elements: `UButton` everywhere. Nine raw `<button>` remain, each the one button inside a primitive or a recorded exception (`tests/config/raw-button.baseline.json`): `ChoiceChip`, `ListRow`, `PropertyValueTrigger`, `SwatchRadioGroup`, `AddTaskSlot`, `NewCardOptionList`, `AppNav` (the ⋯ pill), `StatsTile` (heading toggle), `TopicPropertyPicker` (edit row).
- Verdict: **settled**. For session 4: soft against ghost side by side in rows of two and three actions (`trash.vue` ×3, `reminders.vue` ×3, `updates.vue` ×5, `notion.vue` ×5).

### 2. Pick one of a few
- Pattern: "Pick one of a few": `ChoiceChip`; the one choice card for larger options; "a toggle that stays on beside others is the chip too". "Choose an option in a page": `UTabs` pill.
- Elements: `ChoiceChip` (`MorePanel`, `TaskTimeboxNudge`, `BoardFocusBar`, `NewCardFlow`); `ChoiceCard` (`SyncWarningModal`, its only user; the welcome page's first choice is two `UButton`s and `LocalSetupFlow` offers its services with `UCheckbox`); `SegmentedChoice` (`RemindersListChoices`, one user); `UTabs` pill (`NewDayRecap`, `StatsTiles`); `URadioGroup` (`DataFolderChangeModal`, one user); `SwatchRadioGroup` (`TopicEditor`); `USelect` for a short fixed list (`pages/settings/index.vue`, `notion.vue`, the Notion wizard steps); the rows of `NewCardOptionList` (raw buttons in the select menu's item look); `UDropdownMenu` items with a check (`ColumnSortingControl`).
- Verdict: **convergence candidate**. `SegmentedChoice` and the `UTabs` pill are both a segmented track for a short choice, and `DESIGN.md` names only the second; `URadioGroup` has one use beside `ChoiceCard`, which does the same for options with a description; and the "one choice card" has a single user, while the welcome page's first choice (the largest choice of the app) does not use it.

### 3. Switch something on or off
- Pattern: none named (only "a toggle that stays on beside others is the chip").
- Elements: `USwitch` (`pages/settings/index.vue` ×2, `MorePanel`, `CustomPropertiesStep`); `UCheckbox` (`DataRestoreModal`, `LocalSetupFlow`, `TaskForm`, `TaskDetailCustomFields`, `FeedbackAnnotator`, `FeedbackDialog`); `ChoiceChip` with `aria-pressed` (`MorePanel`, `BoardFocusBar`).
- Verdict: **convergence candidate**. Nothing says when an on/off choice is a switch, a checkbox or a chip; the welcome flow offers further services with checkboxes, settings offers behaviours with switches.

### 4. Edit a value in a label/value row (task sheet)
- Pattern: "Edit a value in a label/value row": a select with a chevron, or text on a dotted rule; one height.
- Elements: `TaskPropertyRow` with `TaskPropertySelect`, `PropertyValueTrigger`, `InlineEditable`, `MinutesField`, `DatePickerField`, `TopicPropertyPicker`; `TaskDetailCustomFields` (adds `UCheckbox` and `UInput`).
- Verdict: **settled** (owner, 2026-11-11). For session 4: the one height and the shared hover, focus and disabled across all six.

### 5. Type into a field (forms)
- Pattern: "Type into a field": `UInput`, `USelect`, `UTextarea` at 36 px; errors through `UFormField`.
- Elements: `UFormField` in nine files (`notion.vue`, `MorePanel`, `GithubTokenRow`, `TokenStep`, `DatabaseSelectionStep`, `PropertyMapper`, `StatusMappingStep`, `PriorityMappingStep`, `FeedbackDialog`); fields without it in `TaskForm`, `TopicEditor`, `TaskCardContextMenu`, `CustomPropertiesStep`; two hand-written field errors (`TaskForm.vue:45`, `InlineEditable.vue:120`, both `text-sm text-error-700`).
- Verdict: **convergence candidate**. The field error has two forms (the `UFormField` error and a hand-written paragraph), and labels are sometimes a `UFormField` label and sometimes a line of their own (`TopicEditor`).

### 6. Change a setting (one row: name, explanation, control)
- Pattern: none named. "Settings" in `DESIGN.md` only says how settings are grouped.
- Elements: raw markup per page: `pages/settings/index.vue` (8 `div`, 6 `p`, 5 `span`, 3 raw `label` beside `USwitch` ×2 and `USelect`), `updates.vue` (6 `div`, 5 `p`, `UButton` ×5), `reminders.vue` (6 `p`, 3 `section`), `data.vue` and `github.vue` (one lead paragraph each); `UFormField` does the same job in `MorePanel`.
- Verdict: **gap**. The most repeated layout of the settings pages has no shared element; each page writes its own label, explanation and control placement.

### 7. Show a list row
- Pattern: "Show a list row": `ListRow`, one density, muted tint on hover.
- Elements: `ListRow` (`settings/index.vue` ×2, `topics.vue`, `SourceRow`, `DataBackupList`, `DataConflictCopies`, `StatsOutliers`). Outside it: the rows of `MorePanel`, `RemindersListChoices`, `CustomPropertiesStep`, `StatsWeekTable`, `RemindersTodayRules` (a four-row table), `BoardColumnYesterdayNote` (title rows as ghost buttons), three raw `ul` in `settings/index.vue`; `TrashEntryRow` is a card with a side column (kept by decision).
- Verdict: **convergence candidate**. Five row lists were built after `ListRow` or kept beside it; whether each has a reason is not recorded for the three Reminders and Mehr lists.

### 8. Choose an option in a page / 31. Switch a view in a page
- Pattern: "Switch a view in a page": `UTabs` `variant="link"`; "Choose an option in a page": `UTabs` pill.
- Elements: `UTabs` in `settings/index.vue` (`size="xl"`, recorded reason #333), `topics.vue`, `notion.vue`, `NewDayRecap`, `StatsTiles` (`size="sm"`).
- Verdict: **settled** by rule. For session 4: three tab sizes (`xl`, default, `sm`) side by side, and whether each use matches its variant's meaning (view or option).

### 9. Group, sort or filter the board
- Pattern: "A view filter never hides Jetzt" (Behaviour); the chip for the choices.
- Elements: `MorePanel` (group-by chips, switches), `ColumnSortingControl` (`UDropdownMenu`), `BoardFocusTrigger` and `BoardFocusBar` (topic chips).
- Verdict: **convergence candidate**, low. Three entry points (a panel, a column menu, a funnel beside the bar) change what the board shows; whether they read as one family is a rendered question.

### 10. Walk through a setup or a flow of steps
- Pattern: "Step back in a flow": `BackButton`; "Steps of a flow slide sideways". No Pattern for the shell of a step: where the progress shows, where the buttons sit, what the head looks like.
- Elements: inside the welcome sheet `LocalSetupFlow`, `SamplesSetupFlow`, `NotionSetupFlow` and `RemindersSetupFlow` (the last two with `SetupRail`, each with its own reduced-motion code and `<style>`); `NotionSetupModal` with `WizardController` in an `AppDialog` (the same Notion steps in a dialog); `FeedbackDialog` (three steps in one dialog); `DataFolderChangeModal`.
- Verdict: **convergence candidate**. Four flows and two dialogs each lay out a step themselves. Partly tracked: #562 (Notion setup cases), #575 (Reminders flow space), #577 (welcome to setup transition).

### 11. Confirm an irreversible or far-reaching action
- Pattern (Behaviour): "Undo instead of confirm … An irreversible action confirms in place, never in a modal."
- Elements: in place: `pages/trash.vue` (empty the trash: `UAlert` and buttons), `TrashEntryRow` (delete for good), `DataResetSection` (the button turns into the question), `TaskSheetActions` (delete), `DataExportImport`, `DataBackupList`. In a dialog: `DisconnectSourceDialog`, `DataRestoreModal`, `DataConflictModal`, `DataFolderChangeModal`, `UpdateDialog`.
- Verdict: **convergence candidate**. Five confirmations are dialogs although the rule says "never in a modal"; some may be flows that need the stage (a preview, a choice between versions), but that is not recorded per dialog. The in-place confirmations also differ in form (a notice with buttons, a button that changes, a sentence).

### 12. Undo an action
- Pattern: "Undo instead of confirm": the undo toast; the delete gap on the board (`TaskDeletedGap`).
- Elements: toasts through `useUndoWindow`, `useCompletionUndo`, `useTaskSwap`, `useTaskMove`, `usePlanToasts`; `TaskDeletedGap` in the card's place.
- Verdict: **settled** (two forms, both named). For session 4: the copy form and the button of the undo across the five toast sources.

### 13. Ask in a dialog
- Pattern: "Ask in a dialog": `AppDialog` in three widths; `ResponsiveOverlay` when it becomes a drawer.
- Elements: `AppDialog` (10 users); `ResponsiveOverlay` (`TaskSheet`); `UModal` directly in `CommandPalette` only; `UDrawer` directly in `TopicEditorHost` and `NewCardFlow`.
- Verdict: **settled**. For session 4: footers (cancel first, main action last) and header form across the ten dialogs.

### 14. Answer a question about one card or one column, in place
- Pattern: "Ask about one card": on the card (`TaskTimeboxNudge`, the new-card flow); "Ask in place".
- Elements: `TaskTimeboxNudge`, `NewCardFlow`, `TaskCarryOverTriage` (card and sheet), `NewDayTimeNote`, `NewDayNote`, `BoardColumnNotice`.
- Verdict: **convergence candidate**, low. Three notices on the board (`NewDayNote`, `NewDayTimeNote`, `BoardColumnNotice`) carry a question or an action each in their own component.

### 15. Tell the user something
- Pattern: "Tell the user something": undo toast, `UAlert` subtle inside a flow, `UFormField` error, one quiet line above the content.
- Elements: `UAlert` (22 files); toasts (12 composables, plus `AddTaskSlot` and `NewCardFlow` calling the toast directly); `DataStorageNotice` (quiet line: `welcome`, `tasks`, `data`, `LocalStorageDetails`); `DataResetSection` (icon and text on the sheet, with the recorded reason "no card in a card"); a plain red line in `RemindersSetupFlow.vue:80` (finding baseline-2).
- Verdict: **convergence candidate**. Inside a sheet the notice has two forms (`UAlert`, and icon plus text without a box) and only one of them is in `DESIGN.md`.

### 16. Show an empty place
- Pattern: "Show an empty place": `EmptyState` for a page or tab of a list, `EmptyNote` elsewhere; empty columns stay blank.
- Elements: `EmptyState` (`trash.vue`, `topics.vue`); `EmptyNote` (`CustomPropertiesStep`, `BoardNotPlanned`, `DataBackupList`, `WhatsNewDialog`, `TasksTable`, `StatsOutliers`, `CommandPalette`); a two-line form in `DatabaseSelectionStep`; the seed notes say an empty Offen shows "its sentence" after "Tag neu planen".
- Verdict: **convergence candidate**, low: the sentence in an empty Offen against "empty columns stay blank", to confirm in the running app; #581 is an open issue about the Alle view's empty state.

### 17. Open a menu of actions
- Pattern: none named beyond "One heading level in a menu".
- Elements: `UDropdownMenu` (`SourceRow`, `ColumnSortingControl`, `TaskSheetActions`), `UContextMenu` (`TaskCardContextMenu`), `UPopover` panels (`AppNav` Mehr, `BoardCapacityDivider`, `NewCardFlow`, `DatePickerField`).
- Verdict: **settled**. For session 4: the trigger of each menu (dots icon, caret, label) side by side.

### 18. Open and close a part
- Pattern: none named.
- Elements: native `<details>` (`pages/statistics.vue:27`, `SyncWarningModal.vue:104`), `UCollapsible` (`TaskDetailMetadata`), the heading toggle of `StatsTile`, a ghost `UButton` (`BoardColumnYesterdayNote`), `ListRow` action with `expanded` (`topics.vue`, `StatsOutliers`), "show all" in `DataBackupList`, the stack header.
- Verdict: **convergence candidate** (finding baseline-6).

### 19. Show that something is loading
- Pattern: "States", Loading: for a control only (the disabled look plus a spinner).
- Elements: `UButton` `loading`; hand-placed spinner icons in `pages/settings/notion.vue`, `MorePanel`, `GithubTokenRow`, `DatabaseSelectionStep`, `StatsVerdict`; `NuxtLoadingIndicator` in `AppShell`; no skeleton anywhere.
- Verdict: **gap**. A loading region (a page, a list, a panel) has no shared element and no rule.

### 20. Add a task
- Pattern: "The task sheet" (the add form is the sheet), "Ask about one card" (the new-card flow).
- Elements: `NewCardFlow` (in the card, Offen and Alle), `AddTaskSlot` with `TaskDraftCard` and `TaskForm` in the sheet (`/tasks/add`), the Jetzt slot's ad-hoc add, the command palette.
- Verdict: **settled** by decision (two forms). For session 4: field order, labels and the save control of the in-card flow against the sheet form.

### 21. Set a timebox
- Pattern: none named for the user task; each surface has its own.
- Elements: chips in `TaskTimeboxNudge`, the Timebox step of `NewCardFlow` with `NewCardOptionList`, `MinutesField` and `PropertyValueTrigger` suggestions in `TaskDetailContent` and `TaskForm`.
- Verdict: **convergence candidate**. One value is set through four controls (chips, an option list, a number field, suggestion triggers); the offered values and their order may differ per surface.

### 22. Move a task / 23. Read a card's state
- Pattern: "The task card", "States" (Card, Drag), `.claude/rules/drag-and-drop.md`.
- Elements: `TaskCard`, `SortableTaskWrapper`, `TaskStack` with header and pill, `TaskCardContextMenu`, the plan arrows of `BoardNotPlannedItem`, `TaskProgressChip`, `TaskCarryOverDots`, `TaskPriorityBadge`, `TaskSourceIcon`, `TopicMark`.
- Verdict: **settled** (the board domain). The card also appears read-only in the trash, the recap deck and the day close: for session 4, whether the same card is the same card there.

### 24. Head a page or a section
- Pattern: "Head a section": `SectionHeader` (five roles) and `PageHeader`; no hand-written heading classes.
- Elements: `PageHeader` through `layouts/sub-page.vue`; `SectionHeader` (30 users); raw headings: `h1` in `pages/tasks.vue` and `layouts/sub-page.vue`, `h2` in `pages/trash.vue`; the welcome page has its own `header`; `TaskSheet.vue:112` writes the sub-heading role by hand (finding baseline-3); `Subline` under a large title (welcome only).
- Verdict: **convergence candidate**, low: the raw `h2` in `trash.vue` and the welcome head beside the two components.

### 25. Enter a token or a secret
- Pattern: none named.
- Elements: `TokenStep` (Notion, in the welcome flow and the dialog), `pages/settings/notion.vue` (`UInput` ×2 in `UFormField`), `GithubTokenRow` (its own state area: empty, checking, saved, failed).
- Verdict: **convergence candidate**. Three token fields with their own check, saved and failed states.

### 26. Save or discard changes of a section
- Pattern: none named.
- Elements: `NotionSettingsSection` (save and cancel per section, five uses in `notion.vue`), `TopicEditor` (its own save), the task sheet (saves each value at once), switches and selects on `/settings` (save at once), `reminders.vue`.
- Verdict: **convergence candidate**. Explicit save per section on one settings page, immediate save on the others; nothing says which applies when.

### 27. Read a chart
- Pattern: "Charts": hand-built SVG in the ink ramp only.
- Elements: `StatsRing`, `StatsEstimateRing`, `StatsTrendBars`, `StatsRhythmBars`, `StatsRhythmGrid`, `StatsTimeSplit`, `StatsPatterns`, `StatsWeekTable`; `DayCloseTimebox`, `DayCloseTopics`; `BoardCapacityDivider` and `BoardCapacityEcho`.
- Verdict: **settled**. For session 4: the day-close charts beside the statistics charts of the same data (timebox share, time by topic).

### 28. Look through tasks of the past
- Pattern: none named.
- Elements: `TasksTable` (`UTable`, Statistik), `StatsOutliers` (`ListRow`), `RecapDeck` (a swipe deck of cards), the done list of `DayCloseStage` / `DayCloseSummary`, `BoardColumnYesterdayNote` (title rows), `TrashEntryRow` (cards).
- Verdict: **convergence candidate**, low. Six forms for a list of finished or removed tasks; several are deliberate key moments, so the open point is only whether title, time and topic appear in the same order and form.

### 29. Go through a key moment (close the day, start the day)
- Pattern: "Ask in a dialog" says "for flows that need the whole stage"; no line for the stage itself.
- Elements: `DayCloseStage`, `NewDayRecap` (both a full stage on the recap's photo).
- Verdict: **convergence candidate**: two siblings to compare for shell, head, the place of the main button and the way out. #580 (day-close entry transition) is open.

### 30. Step back
- Pattern: "Step back in a flow or a deeper route": `BackButton`.
- Elements: `BackButton` (`layouts/sub-page.vue` ×2, the four welcome flows).
- Verdict: **settled**.

### 32. Hold content as a surface
- Pattern: "Hold content as a surface": `TaskCard`, `PageSheet`.
- Elements: `PageSheet` (14 users); `TaskCard`; the welcome sheet (its own CSS in `pages/welcome.vue`, although the Pattern names welcome under `PageSheet`); the stages; `TaskMorphShell` (finding baseline-5 on its radius).
- Verdict: **convergence candidate**, low: the welcome sheet.

### 33. Move between places / open a deeper page
- Pattern: "Move between places": the app bar.
- Elements: `AppNav`, `MorePanel`, `CommandPalette`; link rows: `ListRow` as a link, `NuxtLink` directly in `pages/settings/data.vue` and `LocalStorageDetails`; `ExternalLink` (4 users) and `ULink` (`BoardColumn`, `FeedbackDialog`).
- Verdict: **settled** for places; **convergence candidate**, low, for an in-app text link (`NuxtLink` raw against `ULink`).

### 34. Show a status, a count or a small fact
- Pattern: "Show a status or count": a neutral `UBadge`, one size.
- Elements: `UBadge` (`TaskPriorityBadge`, `CustomPropertiesStep`, `SourceRow`, `BoardNotPlannedGroup`), `UChip` (the app bar's problem dot), `TaskStackPill`, `TaskCarryOverDots`, `SetupChipList` (rounded chips with an icon in the setup intros), `UTooltip` for the explanation (7 users).
- Verdict: **convergence candidate**, low: `SetupChipList` draws a chip that is neither the badge nor the choice chip.

## Part C: counts for the later sessions

- Convergence candidates: 2, 3, 5, 7, 10, 11, 15, 18, 21, 25, 26, 29 (and low: 9, 14, 16, 24, 28, 32, 33, 34). Gaps: 6, 19.
- Raw elements per page template (without `div`): `settings/index.vue` 17 (`p` 6, `span` 5, `label` 3, `ul` 3), `trash.vue` 7, `reminders.vue` 9, `updates.vue` 5, `topics.vue` 7, `welcome.vue` 6, `statistics.vue` 1 (`summary`), `notion.vue` 2, `data.vue` 1, `github.vue` 1, `tasks.vue` 2. Session 3 counts them exactly for the ratchet.
- `<style>` blocks: 50 files in `components/`, `pages/`, `layouts/` (pages: `index`, `tasks` ×2, `trash`, `welcome`, `overlay`; layout: `sub-page`).
- `<component :is>`: `AppShell` (copy editor host, command palette), `TaskSheetHost` (footer lead), and the `tag` prop of `ChoiceCard`, `PageSheet`, `Subline`, `SectionHeader`.
