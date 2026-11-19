# Findings: source scan

Session 3 of `plan.md`. Scanned on `7cb8024a`; `git diff e6786ddc --stat -- components pages layouts assets app.config.ts` is empty, so the source equals the audited commit `e6786ddc`. A delta to `ui-kit-audit.md`: what that audit and `baseline.md` already settle is not repeated.

Scope: `components/`, `pages/`, `layouts/`, `app.vue`, `app.config.ts`, without `pages/ui.vue`, `pages/error-test.vue` and `components/prototype/`. Nothing was rendered. Where a finding needs the running app to be sure, its confidence says so and names what session 4 or 5 would measure.

How it was scanned: two throwaway scripts (`.playwright-screenshots/ui-sweep/3/css.py` and `tags.py`, not committed) list every declaration of every `<style>` block and every tag of every template with its attributes; the rest is `rg`. Open issues were checked with `gh issue list --state open` (12 open on 2026-11-19).

How deep step 1 went: 22 style blocks were read in full (all of 3.2 to 3.4 below, and of 3.1 `BoardFocusBar`, `BoardFocusTrigger`, `BoardColumnNotice`, `ColumnDropZone`, `TaskDraftCard`, `BoardCapacityDock`, `TrashEntryRow`); the control rules of `NewCardFlow`, `TaskTimeboxNudge` and `BoardColumnYesterdayNote` were read; the other 25 board and card blocks were scanned by declaration (type, colour, spacing, size, shadow, outline, opacity, motion, z-index), not line by line.

This file was written by the parent session from the subagent's report, word for word (the harness refuses report files written by a subagent). Not verified, and marked as such below: that the statistics table sits on a white sheet (source-15), that `app.config.ts` sets no checkbox default colour (source-18), that `vue/no-empty-component-block` exists in the installed plugin version (guard table), and whether the base layer already gives a disabled `SegmentedChoice` the `not-allowed` cursor (source-16).

## Step 1: `<style>` blocks

51 blocks in 50 files, 3,345 non-empty lines. 2,727 of them (82 %) are in `components/board/` (1,541) and `components/task/` (1,186).

The blocks are clean on the guarded foundations: no colour literal, no radius off the scale, no z-index above 20 without a token, every `font-size` a token (one `calc`, see source-6), every focus ring written with the `--focus-ring-*` tokens. What the guards do not see is in the findings below.

### 3.1 Justified: board and card domain (29 files)

`DESIGN.md` "Components" ("custom components for the board domain"), `.claude/rules/drag-and-drop.md`, and "Motion" (own choreography recorded in the doc block).

`BoardColumn`, `ColumnDropZone`, `SortableTaskWrapper`, `BoardColumnProgressContent`, `BoardColumnHeader`, `BoardColumnNotice`, `BoardColumnYesterdayNote`, `BoardNotPlanned`, `BoardNotPlannedGroup`, `BoardNotPlannedItem`, `BoardPageDots`, `BoardCapacityDivider`, `BoardCapacityEcho`, `BoardCapacityDock`, `BoardFocusBar`, `BoardFocusTrigger`, `AddTaskSlot`, `TaskDraftCard`, `NewCardFlow`, `TaskCard`, `TaskStack`, `TaskStackHeader`, `TaskStackPill`, `TaskDeletedGap`, `TaskCarryOverDots`, `TaskProgressChip`, `TaskCompletionBurst`, `TaskTimeboxNudge`, and `RecapDeck` (the swipe deck).

Justified as a whole, but seven of them draw the same round button again (source-2), two draw a field (source-17) and `BoardFocusBar` copies the chip's wash (source-3).

### 3.2 Justified: a kit primitive owns its look (6 files)

`ChoiceChip`, `SegmentedChoice` (see source-16, source-17), `SwatchRadioGroup`, `MinutesField`, `MiddleEllipsis`, `TopicMark`.

### 3.3 Justified: shell, platform and page layout (11 files)

`AppShell` (desktop title bar strip), `layouts/sub-page.vue` (viewport height below the bar), `pages/overlay.vue` and `overlay/NowWindow` (the native floating window: fixed px, system font; open leftovers are in #587), `pages/welcome.vue` (photo crop per The Bright Ground Rule, the hang line, the step slide), `pages/trash.vue` (the entry grid), `TrashEntryRow` (layout only), `TopicEditorHost` (drawer height), `TopicEditor` (swatch and symbol grid), `SetupRail` (the line between two dots), `NotionSetupFlow` (hides the duplicate heading of `TokenStep`: a prop on the step would say the same without reaching into the child, low).

### 3.4 A token, a theme variant or a kit component would do (4 files)

| File | What the block does | Instead |
|---|---|---|
| `pages/index.vue:26`, `pages/tasks.vue:313` | empty blocks | delete (source-1) |
| `pages/tasks.vue:301-311` | `.modal-enter-*` transition classes no `<Transition name="modal">` uses | delete (source-1) |
| `statistics/TasksTable.vue:184-193` | row cursor and hover of `UTable` | the `table` theme in `app.config.ts` (source-15) |
| `task/TaskPriorityBadge.vue:79-86` | `.priority-high` tint (warning 100 / 700) beside `class="bg-muted"` on the same `UBadge` | a badge colour in the theme; the look is the recorded one ("the one tinted badge"), only its place is ad hoc. Low, no own finding |

## Step 2: inline styles, arbitrary values, call-site overrides

**Inline `style`:** none static. **`:style`:** 41 bindings in 28 files. 38 carry data (a custom property for an index, a width, a duration; chart sizes and ink-ramp colours through `inkColor()`; the dragged element's box). Three carry a colour that is a design choice: `DayCloseTimebox.vue:21` with `:47` (source-19), `RemindersListChoices.vue:29` (source-20), and `TopicEditor.vue:60` (a topic hue on its swatch: The Topic Mark Rule allows it).

**Arbitrary Tailwind values:** 12 with a value (the rest are `data-[state=…]` selectors): `min-h-[150px]` (`BoardColumn.vue:93`), `min-w-[260px]` (`DatePickerField`), `max-h-[60dvh]` ×3 and `md:grid-cols-[13rem_1fr]` ×2 (the two setup flows), `grid-cols-[auto_1fr]` (`DataRestoreModal`), `grid-rows-[minmax(0,1fr)]` (`TaskDetailContent`), `left-[calc(50%+1.25rem)]` and `w-[calc(100%-2.5rem)]` (`NotionSetupModal`, the stepper of source-21), `border-[1.5px]` (`ChoiceCard`). All layout; the existing guard (`SCALE_ALLOWLIST`) passes them. None is a finding by itself.

**Call-site `ui` props:** 29 entries in 24 files, classified in source-12 (7 change the look, 22 are placement).

**Call-site `class` on a Nuxt UI component that changes its look:** 16 tags (source-7, source-8, source-10, source-11). The `ui` ratchet does not see these: a look moved from `:ui` to `class` passes.

## Step 3: raw elements

Per page: the table under "Step 5". In feature components, raw elements that do a user task a kit component exists for:

| Raw element | Count | Kit component | Finding |
|---|---|---|---|
| `<button>` | 9 | `UButton` | none: all nine are in `raw-button.baseline.json` |
| `<h2>` to `<h4>`, `<legend>`, `<label>` with hand-written type | 12 | `SectionHeader` | source-4 |
| `<input>`, `<textarea>` | 4 (`NewCardFlow` ×2, `TaskTimeboxNudge`, `MinutesField`) | `UInput`, `MinutesField` | source-17 |
| `<details>` / `<summary>` | 2 | none named | baseline-6 |
| `<table>` | 1 (`RemindersTodayRules`) | `UTable` / `ListRow` | `map.md` user task 7 |
| styled `NuxtLink` / `ULink` / `ExternalLink` as a text link | 9 | none named | source-9 |
| a spinner built from a `div` | 1 | `UIcon` / `UButton loading` | source-22 |
| step indicator built from `span`s | 2 implementations | `SetupRail` | source-21 (#562) |

## Step 4: the named rules of `DESIGN.md`

| Rule | Check | Result |
|---|---|---|
| The One Lamp Rule | solid primary `UButton`s per template with their `v-if` | none found in the source (every file has one per state; `DisconnectSourceDialog` pairs soft error with solid). Rendered guard exists |
| The Status Is Not Decoration Rule | role colour classes (34) and `color=` props | source-19 (green in a chart), source-21 (green fills as step numbers); no `info`, no `secondary` in use |
| The Topic Mark Rule | `--topic-` | only `TopicMark` and `TopicEditor`: none found |
| The Marker Rule | `--marker` | the column header and one burst tint (recorded): none found |
| The Frozen Primary Rule | not a source check | – |
| The Receding Text Rule | `opacity-*` classes, `opacity:` on text | no opacity on text in classes; source-16 (a disabled group at 60 %) |
| The Bright Ground Rule | rendered | session 4 |
| The One Role Rule (face, weights) | `font-display`, `font-semibold`, `font-weight: 600` | source-5 |
| Type table | size classes and `font-size` | source-6, source-10, source-23 (the task title) |
| Spacing scale | half-step classes, padding / margin / gap in `<style>` | source-13 |
| Control height, The One Height Rule | `UButton` classes, CSS on a button's class | source-2, source-10, source-23 |
| Radius, "no pill-shaped container" | `border-radius` in `<style>` | source-17 |
| Icon size | CSS sizes on icons | four icons sized in CSS outside 12 / 16 / 20 / 24; the guard checks `size-*` classes on `UIcon` only. Folded into source-13 |
| The Sheets Cast Shadows Rule | `box-shadow`, `filter` in `<style>` | source-17 (the phone focus bar) |
| Motion tokens | durations and easings | source-14 |
| States | `cursor-pointer`, `hover:`, `disabled:`, opacity | source-15, source-16 |
| Trigger an action | variants, colours, sizes of all `UButton` tags | source-7, source-8, source-10 |
| Pick one of a few | – | `map.md` user task 2; source-18 adds the checkbox colour |
| Type into a field | raw inputs | source-17 |
| Show a list row | – | `map.md` user task 7; source-15 (table row hover) |
| Show a status or count | `UBadge` props | 4 badges, all `soft` neutral: none found |
| Head a section | raw headings | source-4 |
| Tell the user something | `UAlert` props (31 tags, all `subtle`) | source-11; baseline-2 |
| Switch a view / choose an option | `UTabs` props | as `map.md` user task 8: none new |
| Step back | `arrow-left` | only `BackButton`: none found |
| Charts | colours in chart components | source-19 |
| Ask in a dialog, no bare `UModal` | tags | `UModal` in the three allowed files only: none found |
| Behaviour rules | not source checks beyond `map.md` user tasks 11 and 12 | – |
| Guards | each guard read for what it does not see | source-23 |

## Findings

### source-1: two empty style blocks and one dead transition
- User task: none (dead code)
- Where: `pages/index.vue:26` (`<style scoped lang="css"></style>`), `pages/tasks.vue:313` (`<style></style>`), `pages/tasks.vue:301-311` (`.modal-enter-active` … `.modal-leave-to`)
- Evidence: `rg '<Transition'` over components, pages, layouts: no transition is named `modal`; the two blocks have no content
- Against: `ui-kit-audit.md` "Unused CSS classes" (marked done in `baseline.md`)
- Proposed change: delete the three.
- Group: obvious fix
- Confidence: high
- Effort: small
- Needs design round: no
- Already tracked: no

### source-2: the round icon button is drawn seven times in component CSS
- User task: trigger an action
- Where: `BoardColumnHeader.vue:281-312` (`.column-header__add`, 32 px, canvas fill), `TaskStackHeader.vue:102-128` (close, 32 px, "same look as the header add button"), `TaskCard.vue:471-476` (`.task-menu-btn`, 28 px, canvas fill), `BoardFocusBar.vue:134-146` (`.board-focus-bar__end`, 28 px, primary), `BoardFocusTrigger.vue:53-88` (nav-pill height, canvas fill on hover), `NewCardFlow.vue:1016-1028` (`.ncf__nav`, 28 px) and `:1090-1099` (`.ncf__action`), `assets/css/board.css` (`.plan-arrow`, 32 px, primary 100)
- Evidence: each is a `UButton` whose width, height, minimum width, pill radius, fill and hover are set again by a class of its host; three sizes (28, 32, nav height) and three fills; each restates the 44 px phone floor because its own `min-height` outranks the theme's
- Against: `DESIGN.md` "Components" (Nuxt UI first, themed in `app.config.ts`); The One Height Rule lists these buttons as allowed, so the size is not the defect, the seven copies are
- Proposed change: one round icon-button variant in the `button` theme (canvas fill, soft primary; 32 px and the 28 px corner size) that the seven places select, so hover, press, focus and the phone floor come from one rule.
- Group: proposal
- Confidence: medium: the copies are read in the source; whether one variant can hold the card-corner geometry was not tried
- Effort: medium
- Needs design round: no (the look stays)
- Already tracked: no

### source-3: the primary wash of the chip is written as a literal mix in five places
- User task: pick one of a few; show a status
- Where: `ChoiceChip.vue:52` and `:68`, `BoardFocusBar.vue:111`, `:144`, `:170` (`color-mix(in oklab, var(--ui-primary) 10%` and `18%`)
- Evidence: the focus pill's comment says it is "the answer chip's primary wash"; it repeats the two percentages instead of sharing them
- Against: `DESIGN.md` "Foundations" (token values live in `main.css`)
- Proposed change: two tokens (the wash and its hover step) in `main.css`, used by both.
- Group: obvious fix
- Confidence: high
- Effort: small
- Needs design round: no
- Already tracked: no

### source-4: twelve headings and group labels write their type by hand
- User task: head a section
- Where: `MorePanel.vue:42` and `:85` (`h2`, `text-xs font-semibold text-muted`), `DayCloseTopics.vue:15` and `DayCloseTimebox.vue:15` (`h4`, `text-sm font-medium text-highlighted`), `FeedbackDialog.vue:196`, `:202` (`h3`) and `:161` (`legend`, all `text-sm font-medium`), `StatsTiles.vue:91` (`h3`, `text-base font-medium`), `LocalSetupFlow.vue:26` (`legend`, `text-sm font-medium text-highlighted`), `TopicEditor.vue:24` (`label`) and `:47` (`legend`, both `text-xs font-medium text-muted`, which is the `label` role of `SectionHeader` word for word), and `TaskSheet.vue:112` (baseline-3)
- Evidence: `rg '<h[1-6]|<legend'`; four different strings for a small heading above a group: 12 px 600 muted, 12 px 500 muted, 14 px 500, 16 px 500
- Against: `DESIGN.md` "Components", "Head a section" ("no hand-written heading classes"); `SectionHeader` has no 14 px role, which is why six places write one
- Proposed change: move the 12 px ones to `SectionHeader size="label"`; decide whether the 14 px group heading becomes a sixth role or steps to the label role, then use it in the others.
- Group: obvious fix for the four 12 px places; proposal for the 14 and 16 px ones
- Confidence: high
- Effort: small
- Needs design round: no
- Already tracked: no (baseline-3 covers `TaskSheet.vue:112` only)

### source-5: weight 600 on text that is no key figure, in thirteen places
- User task: none (foundation, type)
- Where: `MorePanel.vue:42`, `:85` (group headings); `SetupRail.vue:48`, `:55` and `NotionSetupModal.vue:40` (step numbers and the current step's name); `CommandPalette.vue:104` (group label, `text-base font-semibold`; the comment above it still says "display-role group headings"); `PropertyValueTrigger.vue:42` (the picked suggestion); `TaskDetailContent.vue:692` (remaining time, with the warning colour); `BoardFocusBar.vue:126` (the topic in the pill); `BoardCapacityDivider.vue:154` and `BoardCapacityEcho.vue:125` (the label, with `letter-spacing: 0.02em`); `TaskCard.vue:662` (the done confirmation line); `NewCardFlow.vue:1144` (key cue)
- Evidence: `rg 'font-semibold|font-weight: 600'`: 16 class uses and 6 declarations; six are key figures (the statistics rings and verdict, the day-close count, the table's accuracy, the donut figure) and two are `<strong>` in running text
- Against: `DESIGN.md` "The One Role Rule" ("the sans, at 400 to 500 (600 for a key figure)")
- Proposed change: step them to 500, or name in the rule what else may be 600 (a picked value, a step number).
- Group: obvious fix
- Confidence: medium: the rule is plain, but some of these may be meant (the picked suggestion is told apart by weight); the user says which
- Effort: small
- Needs design round: no
- Already tracked: no

### source-6: text sizes outside the type table
- User task: none (foundation, type)
- Where: 16 px (`text-base`) on desktop in `DayCloseStage.vue:49` and `NewDayRecap.vue:53` (the line under the stage title), `StatsTiles.vue:91` (a heading), `CommandPalette.vue:104` (group label), `StatsTimeSplit.vue:16` (the small donut's figure); 30 px (`text-3xl`) in `DayCloseTimebox.vue:18`; 24 px (`text-2xl`) for the figures in `StatsEstimateRing.vue:15` and `StatsTimeSplit.vue:16`; 27 px on a phone in `BoardNotPlanned.vue:382` (`calc(var(--text-display) * 0.75)`)
- Evidence: class counts: `text-body` 99, `text-sm` 90, `text-xs` 50, `text-base` 5, `text-2xl` 3, `text-3xl` 1; `main.css:34` comments `--text-2xl` as "not a role"
- Against: `DESIGN.md` "Type" (eight roles: 48, 36, 22, 18, 15, 14, 14, 12 px; "a value outside a table is a defect or a recorded exception"). The key figure is named in the weight rule but has no row in the table, and it has four sizes today (16, 24, 30, 36 px)
- Proposed change: add a key-figure row to the type table (one or two sizes) and move the figures to it; bring the 16 px texts to Body or Subhead.
- Group: proposal
- Confidence: high for the sizes; which size the figure role gets is the open choice
- Effort: small
- Needs design round: no
- Already tracked: no (`redesign-gap-audit.md` listed 16 and 30 px before the redesign; they are still there)

### source-7: a destructive button in a row has three looks
- User task: trigger an action; confirm an irreversible action
- Where: soft in the error tone (the rule): `TaskSheetActions.vue:40`, `TrashEntryRow.vue:40` and `:53`, `DataResetSection.vue:52`, `pages/trash.vue:40`, `TaskCarryOverTriage.vue:53`. Ghost neutral with only the icon red: `GithubTokenRow.vue:49`, `TaskCarryOverTriage.vue:87` (the same component as `:53`, in its other layout). Ghost in the error tone: `pages/settings/reminders.vue:69` ("Trennen", third in a row of soft buttons)
- Evidence: the `variant` / `color` pairs of all `UButton` tags; the red icon comes from a call-site `:ui="{ leadingIcon: 'text-error' }"` (two of the `ui-prop` baseline entries)
- Against: `DESIGN.md` "Trigger an action" ("the destructive one of such a pair, which is soft in the error tone so it is told apart at a glance")
- Proposed change: make the three soft error and drop the two `ui` overrides.
- Group: obvious fix
- Confidence: high
- Effort: small
- Needs design round: no
- Already tracked: no

### source-8: the link button stands alone as an action in seven places
- User task: trigger an action
- Where: `pages/settings/notion.vue:97` ("Datenbank ändern") and `:128` (save the database, a primary link beside a soft "Abbrechen": the main action of the pair is the lighter one), `pages/settings/updates.vue:36` ("Was ist neu", `px-0`), `UpdateDialog.vue:54` (`px-0`), `StatsPatterns.vue:40` (show all, `min-h-11 px-0`), `DataBackupList.vue:58` (reload) and `:104` (show all)
- Evidence: `rg 'variant="link"'` without the tabs; three of the seven strip the padding with `px-0` so the text sits flush left, a variant made at the call site
- Against: `DESIGN.md` "Trigger an action" ("Link inside running text"); the one recorded inline link is `FeedbackDialog.vue:149`
- Proposed change: the save in `notion.vue:128` becomes the row's soft or solid action (no choice open); for the other six decide once: ghost, or a named flush-left text action in the theme.
- Group: proposal (obvious fix for `notion.vue:128`)
- Confidence: high that the rule and the code disagree; medium on the replacement
- Effort: small
- Needs design round: no
- Already tracked: no

### source-9: a text link inside a sentence has five looks
- User task: move between places (open a deeper page from a sentence)
- Where: underlined in the text colour: `pages/settings/data.vue:18`, `LocalStorageDetails.vue:31` (`NuxtLink`), `FeedbackDialog.vue:218`, `:235` (`ULink`); green, underline on hover only: `pages/settings/notion.vue:79`; green, medium weight, always underlined: `BoardColumn.vue:111`; toned grey, underlined, offset 2: `SyncWarningModal.vue:122`; highlighted ink, underlined, offset 2: `GithubTokenRow.vue:95`, `:114`
- Evidence: `rg 'underline'` over the templates: nine links, five class strings, three elements (`NuxtLink`, `ULink`, `ExternalLink`)
- Against: `DESIGN.md` "Colour" (forest green: "… links …"): seven of the nine are not green; inconsistent with each other
- Proposed change: one text-link look (colour, underline at rest or on hover, focus ring) as the theme of `ULink`, used by all nine; `ExternalLink` keeps its icon.
- Group: proposal
- Confidence: high for the count; the look is the choice
- Effort: small
- Needs design round: no
- Already tracked: no (`map.md` user task 33 names the two elements, not the looks)

### source-10: the sort control's button carries a 12 px label
- User task: group, sort or filter the board
- Where: `ColumnSortingControl.vue:28-33` (`class="text-label font-medium text-muted hover:text-default"` on a ghost `UButton`, with a 16 px icon in the leading slot "beside the 12 px label")
- Evidence: source; `button-ladder.test.ts:222` ("keeps the label of every button at the 14 px interface step") tests the theme, not a call-site class
- Against: `DESIGN.md` "Type" (Interface, 14 px: buttons); "States" (hover written by hand at the call site)
- Proposed change: drop the class so the button is the ghost button, or record it as a listed exception beside the other small board controls.
- Group: obvious fix
- Confidence: medium: it may be a deliberate quiet control under the column name; the source does not record it
- Effort: small
- Needs design round: no
- Already tracked: no

### source-11: the flat note is a `UAlert` restyled at two call sites
- User task: tell the user something
- Where: `pages/trash.vue:26-31` (`class="items-center py-3 ring-0"`), `DataStorageNotice.vue:31` (`:ui="{ title: 'text-sm font-medium text-default', root: 'py-3 ring-0', … }"`)
- Evidence: the same two classes remove the ring and tighten the padding of the subtle alert in both; `map.md` user task 15 names a third form of the same idea (`DataResetSection`, icon and text without a box)
- Against: `DESIGN.md` "Guards" ("no visual identity in a call-site `ui` prop"); "Tell the user something" names "one quiet line above the content" without an element for it
- Proposed change: a named variant of `alert` in `app.config.ts` for the flat note, used by both (and offered to `DataResetSection`).
- Group: obvious fix
- Confidence: high
- Effort: small
- Needs design round: no
- Already tracked: no

### source-12: of the 29 call-site `ui` entries, seven change the look and 22 are placement
- User task: several (answers baseline-1, which left this open)
- Where: look: `CommandPalette.vue:100-111` (`paletteUi`: group label type, row height, highlight fill), `DataStorageNotice.vue:31` (source-11), `DataFolderChangeModal.vue:61` (legend and description type of the radio group), `GithubTokenRow.vue:49` and `TaskCarryOverTriage.vue:92` (the red icon, source-7), `AppNav.vue:128` (the problem dot's tone, from the status), `TopicEditor.vue:84` (the caret's turn). Placement (width, scroll, padding to zero, `sr-only`, wrapping, named layout classes): `CommandPalette.vue:22`, `ColumnSortingControl`, `NewCardFlow`, `FeedbackDialog`, `NotionSetupModal`, `TasksTable`, `AddTargetSwitch`, `TaskCard`, `TaskCardContextMenu`, `TaskPropertySelect`, `TopicPropertyPicker`, `TopicEditorHost`, `TaskSheet` ×2, `ResponsiveOverlay` ×3, `GithubTokenRow.vue:124`, `pages/settings/index.vue:63` (a larger hit area), `notion.vue:46`, `topics.vue:21`, `AppDialog` (the recorded keep)
- Evidence: every entry of `tests/config/ui-prop.baseline.json` opened; 28 carry the same reason ("moves into the app.config.ts theme …")
- Against: `DESIGN.md` "Guards"
- Proposed change: move the seven (two fall away with source-7, one with source-11); reword the reason of the 21 placement entries to "keep: placement", so the baseline shows what is left.
- Group: obvious fix
- Confidence: high
- Effort: small
- Needs design round: no
- Already tracked: no

### source-13: more values off the 4 px grid than baseline-4 counted
- User task: none (foundation, spacing and icon size)
- Where: utility classes beyond the six of baseline-4: `size-2.5` in `DayCloseTimebox.vue:21` and `ChoiceCard.vue:30`, `max-md:after:-inset-3.5` in `pages/settings/index.vue:63`. In `<style>` blocks: 10 px in `BoardNotPlanned.vue:286`, `TaskCard.vue:654`, `TaskTimeboxNudge.vue:259`; 14 px in `BoardFocusBar.vue:109`; `0.15rem 0.3rem` in `NewCardFlow.vue:1138` (the key cue). Icons sized in CSS off the icon scale: 13 px `TaskProgressChip.vue:311`, 14 px `BoardColumnYesterdayNote.vue:205` and `TaskStackPill.vue:117`, 18 px `AddTaskSlot.vue:307`
- Evidence: the declaration list of all style blocks: 11 spacing declarations are neither on the grid nor 2 or 6 px; five of them are geometry tied to another element (`TaskCard.vue:497`, `TaskStackHeader.vue:125`, `BoardColumnHeader.vue:198`, the `NowWindow` ×2) and are left out here
- Against: `DESIGN.md` "Space, size and shape" (spacing; icon size 12, 16, 20, 24)
- Proposed change: move the eight to the neighbouring step; the four icons to 12 or 16 px.
- Group: obvious fix
- Confidence: high for the values; each moves something by 1 to 2 px, so session 4's screenshots decide whether any is needed
- Effort: small
- Needs design round: no
- Already tracked: no

### source-14: 47 easing keywords pass the motion guard, and 180 and 220 ms sit beside the tokens
- User task: none (foundation, motion)
- Where: keyword easings (`ease` 24, `linear` 7, `ease-out` 10, `ease-in` 4, `ease-in-out` 2) in 18 files, most in `assets/css/app-nav.css` (10), `TaskProgressChip.vue` (4), `TaskDeletedGap.vue` (4), `mobile-nav.css` (4), `pages/welcome.vue` (3). Token duration with a keyword curve: `BoardFocusBar.vue:140`, `BoardFocusTrigger.vue:64`, `TasksTable.vue:187`, `pages/tasks.vue:304`. Literal durations: 180 ms ×8, 220 ms ×6, 260 ms ×5, 320 ms ×4, 240 ms ×3, 140 ms ×3, 300 ms ×2 (written as a number beside the token), 280 ms ×2, one each of 130, 480, 500, 600, 650, 700 (`pages/welcome.vue:34`, `duration-700`) and 1200 ms
- Evidence: a count over every `transition` and `animation` declaration (style blocks and `assets/css`) and every `ease-*` / `duration-<n>` class; `scripts/lint/design-tokens.mjs:235-236` counts numbers and `cubic-bezier(` only, so `transition: color var(--duration-fast) ease` is invisible to it. The step slide exists twice with different numbers: `pages/welcome.vue:304-307` (260 ms in, 140 ms out, 32 px) and `NewCardFlow.vue:1156-1172` (150 ms, 20 px)
- Against: `DESIGN.md` "Motion" (three durations, two easings; own choreography is recorded in the doc block)
- Proposed change: count the keywords in the motion ratchet; fold 180 ms into `--duration-fast` or `--duration-base` and 220 ms into `--duration-base` where no doc block asks for the number.
- Group: guard (the keyword count); proposal (folding the durations)
- Confidence: high for the counts; whether 180 against 200 ms is visible is session 5's measurement
- Effort: small (guard), medium (folding)
- Needs design round: no
- Already tracked: no

### source-15: a row of the statistics table answers hover with white on white
- User task: show a list row; look through tasks of the past
- Where: Statistik, "Alle Aufgaben": `statistics/TasksTable.vue:185-192` (`:deep(tbody tr:hover) { background-color: var(--ui-bg-elevated) }`)
- Evidence: `assets/css/main.css:120-121`: `--ui-bg` and `--ui-bg-elevated` are both white; whether the table lies on a white sheet was not checked in the source
- Against: `DESIGN.md` "Show a list row" ("a muted tint on hover"); "States", Hover
- Proposed change: the muted tint of `ListRow`, set in the `table` theme of `app.config.ts` instead of a `:deep` rule.
- Group: obvious fix
- Confidence: medium: read in the source; session 4 confirms that no hover shows
- Effort: small
- Needs design round: no
- Already tracked: no

### source-16: a disabled `SegmentedChoice` dims to 60 %, not 50 %
- User task: pick one of a few
- Where: `ui/SegmentedChoice.vue:60-62` (`opacity: 0.6`); no `cursor: not-allowed` in the block
- Evidence: source
- Against: `DESIGN.md` "States", Disabled ("50 % opacity, `not-allowed`")
- Proposed change: 50 % and the cursor, or let the base layer's disabled rule reach the group.
- Group: obvious fix
- Confidence: high for the opacity; the cursor may come from the base layer (not checked)
- Effort: small
- Needs design round: no
- Already tracked: no

### source-17: pill-shaped fields and containers outside the one named exception
- User task: type into a field; pick one of a few; group, sort or filter the board
- Where: fields: `NewCardFlow.vue:1111-1124` (`.ncf__note`, a raw `<input>` with the pill radius and an inset hairline) and `TaskTimeboxNudge.vue:294-306` (`.nudge__field`, a raw number `<input>` in a pill; `MinutesField` is the kit's number field). Containers: `SegmentedChoice.vue:53-58` (the track), `BoardFocusBar.vue:160-167` on a phone (the chip row: white, pill radius, and `--shadow-nav-pill`) and `:169-172` (the focus pill with the same shadow)
- Evidence: source
- Against: `DESIGN.md` "Space, size and shape" (fields 12 px; "No pill-shaped container, with one exception: the app bar's pills"); The Sheets Cast Shadows Rule (the nav pill is "the one named exception")
- Proposed change: record the in-card question language (answers, fields and controls on a card are pills) and the phone focus bar as exceptions in `DESIGN.md`, or bring the two fields to the field radius; say whether `SegmentedChoice` follows the `UTabs` pill track.
- Group: proposal
- Confidence: medium: the rule text is plain, but the in-card flow was designed as a whole (#72, #434), so this is likely a missing record, not a defect
- Effort: small (record) or medium (change)
- Needs design round: no for the record; yes for a change
- Already tracked: no

### source-18: a ticked checkbox is set to neutral in ten places and left green in three
- User task: switch something on or off
- Where: `color="neutral"`: `FeedbackDialog.vue:162-186` (six), `FeedbackAnnotator.vue:73`, `LocalSetupFlow.vue:27` and two more; green: `TaskDetailCustomFields.vue:27` (`color="primary"`), `TaskForm.vue:230` and `DataRestoreModal.vue:34` (no colour, so the default)
- Evidence: the `color` prop of all 13 `UCheckbox` tags; no default colour for the checkbox was found in `app.config.ts` (searched, not read in full)
- Against: `DESIGN.md` "Colour" (forest green: "… selected options …") against The One Lamp Rule (green "without being a fill"); inconsistent with each other
- Proposed change: one colour for a ticked checkbox as the theme default, no `color` at the call sites.
- Group: proposal
- Confidence: medium: the props are read in the source; session 4 compares the two side by side
- Effort: small
- Needs design round: no
- Already tracked: no (`map.md` user task 3 asks when it is a switch, a checkbox or a chip, not the colour)

### source-19: the day-close timebox chart uses the action green
- User task: read a chart
- Where: day-close stage, "Timebox": `board/DayCloseTimebox.vue:47` (`color: 'var(--ui-primary)'` for "within", ink steps for "under" and "over")
- Evidence: source; the statistics charts take their colours from `inkColor()`
- Against: `DESIGN.md` "Charts" ("the ink ramp only; no status colour, no topic hue")
- Proposed change: an ink step for "within", or record the green (done within the timebox) as the chart's one exception.
- Group: proposal
- Confidence: medium: the rule is plain; the green may be meant as "done", which the rule's wording does not allow in a chart
- Effort: small
- Needs design round: no
- Already tracked: no

### source-20: the Reminders list rows show Apple's list colour
- User task: pick one of a few (the role of each Reminders list)
- Where: welcome, Reminders setup, list choices: `setup/RemindersListChoices.vue:27-30` (`:style="{ background: list.color ?? … }"`, a 12 px dot)
- Evidence: source; the only colour found that comes from outside the tokens
- Against: `DESIGN.md` "The Status Is Not Decoration Rule" ("integration brand colours do not appear at all") and "A warm neutral canvas … colour comes in small doses"
- Proposed change: keep it as a recorded exception (the dot is how the user knows the list from the Reminders app) or drop the dot.
- Group: proposal
- Confidence: low: it is the user's own list colour, not a brand colour; the rule may not be meant for it. #575 changes the same list
- Effort: small
- Needs design round: no
- Already tracked: no (#575 covers the space and the options of this list, not the dot)

### source-21: the Notion setup has two step indicators
- User task: walk through a setup
- Where: `notion/setup/NotionSetupModal.vue:30-52` (a row of 28 px circles filled solid green up to the current step, a green line between them, the name below) and `setup/SetupRail.vue` (a rail of 24 px circles in ink with a check when done; a bar below `md`)
- Evidence: source; the dialog's solid green circles also sit in the same dialog as its solid green button
- Against: inconsistent with each other; The One Lamp Rule (marks are "green without being a fill")
- Proposed change: the dialog uses `SetupRail`.
- Group: proposal
- Confidence: high
- Effort: medium
- Needs design round: no
- Already tracked: #562 ("Align Notion setup flow cases": make both one component, the welcome flow's UI is the newer one)

### source-22: "loading" has three hand-made spinners
- User task: show that something is loading
- Where: `pages/settings/notion.vue:109` (`i-ph-arrow-clockwise` with `animate-spin`), `DatabaseSelectionStep.vue:33` (a `div` with a green bottom border, `animate-spin`), `GithubTokenRow.vue:33` (`motion-safe:animate-spin` on the state icon)
- Evidence: `rg 'animate-spin'`; only the third stops under reduced motion
- Against: `DESIGN.md` "States", Loading (one answer); `map.md` user task 19 lists the gap, this adds that the three differ in glyph, colour and reduced-motion answer
- Proposed change: one loading line (icon, text, reduced motion) as a small kit element, used by the three.
- Group: proposal
- Confidence: high
- Effort: small
- Needs design round: no
- Already tracked: no

### source-23: what the guards do not see
- User task: none (guards)
- Where and evidence, each read in the guard's source:
  - `tests/config/ratchets.test.ts` (`ui-prop`): counts `:ui` bindings; the same look written as `class` on a Nuxt UI component passes (16 tags today, source-7, 8, 10, 11)
  - `tests/config/button-ladder.test.ts:153-160`: forbids `h-8` / `min-h-8` / `size-8` classes on a button; a `min-height` on the button's class in a `<style>` block passes (`BoardColumnYesterdayNote.vue:192` and `:241`, 32 and 28 px, are not on the `SMALLER_BY_DESIGN` list)
  - `tests/config/design-lock-in.test.ts:48`: forbids `leading-*`; a line height set through the size class passes (`TaskDetailContent.vue:69`, `text-2xl/tight`: the task title in its sheet at 24 px where the type table says Headline, 22 px; whether `InlineEditable size="xl"` overrides it is session 4's measurement)
  - `tests/config/display-layout.test.ts:35`: forbids `font-display` outside five files; any other hand-written heading passes (source-4)
  - `scripts/lint/design-tokens.mjs`: spacing is checked for arbitrary classes only, so half-step classes and every padding, margin and gap in a `<style>` block pass (source-13); easing keywords pass (source-14); `font-weight` is not checked (source-5)
- Against: `DESIGN.md` "Guards" (the table states these guarantees without the gaps)
- Proposed change: see "Step 5", one guard per class.
- Group: guard
- Confidence: high
- Effort: small each
- Needs design round: no
- Already tracked: no

## Step 5: counts for the two ratchets, and the cheapest guard per class

### Ratchet A: raw elements per page

Raw HTML tags in the template, counted by tag (`tags.py`); "without `div`" is the number the ratchet would hold, since a `div` is layout.

| File | All | Without `div` | Tags |
|---|---|---|---|
| `pages/settings/index.vue` | 26 | 18 | `p` 6, `span` 5, `label` 3, `ul` 3, `section` 1 |
| `pages/settings/reminders.vue` | 11 | 9 | `p` 6, `section` 3 |
| `pages/settings/topics.vue` | 10 | 7 | `span` 5, `p` 1, `ul` 1 |
| `pages/trash.vue` | 11 | 6 | `section` 2, `p` 2, `h2` 1, `span` 1 |
| `pages/welcome.vue` | 13 | 6 | `p` 3, `main` 1, `img` 1, `header` 1 |
| `pages/settings/updates.vue` | 11 | 5 | `p` 5 |
| `pages/settings/notion.vue` | 8 | 2 | `p` 1, `span` 1 |
| `pages/tasks.vue` | 3 | 2 | `main` 1, `h1` 1 |
| `layouts/sub-page.vue` | 6 | 2 | `h1` 1, `main` 1 |
| `pages/statistics.vue` | 4 | 2 | `details` 1, `summary` 1 |
| `pages/settings/data.vue` | 3 | 1 | `p` 1 |
| `pages/settings/github.vue` | 2 | 1 | `p` 1 |
| `pages/index.vue`, `settings/sources.vue` | 1 each | 0 | |
| `pages/overlay.vue`, `statistics/[id].vue`, `tasks/[id].vue`, `tasks/add.vue`, `app.vue` | 0 | 0 | |
| **Total** | **110** | **61** | |

Two numbers differ from `map.md` part C: `settings/index.vue` 18 (not 17: the `section`), and `statistics.vue` has the `details` as well as the `summary` (the script missed the `details` tag, it is added here by hand from `pages/statistics.vue:25-27`). The three settings pages with the most raw elements (`index`, `reminders`, `topics`) hold 34 of the 61. That is the same place as the gap of `map.md` user task 6 (a settings row has no shared element).

### Ratchet B: `<style>` blocks and inline styles per component

- `<style>` blocks: 51 in 50 files (44 scoped, 7 global: `AppShell`, `TaskCompletionBurst`, `TaskTimeboxNudge`, `TopicEditorHost`, `pages/overlay.vue`, `pages/tasks.vue`, `pages/welcome.vue`); 3,345 non-empty lines. By area: `components/board` 1,541, `components/task` 1,186, `components/ui` 184, `components/overlay` 93, `components/recap` 90, `components/topic` 77, `components/trash` 60, pages 61, `components/setup` 23, `AppShell` 16, `components/statistics` 7, layouts 7. The five largest: `TaskCard` 436, `NewCardFlow` 396, `TaskTimeboxNudge` 226, `AddTaskSlot` 184, `TaskStack` 166 (lines of the block).
- Inline `style`: 0. `:style` bindings: 41 in 28 files.
- Recommendation for the proposal: a count of blocks would freeze the board at its justified 29 and say little. Two narrower counts say more: (1) files with a `<style>` block outside `components/board`, `components/task`, `components/ui`, `components/overlay` and `components/recap`: 14 today (`AppShell`, `TasksTable`, `SetupRail`, `NotionSetupFlow`, `TopicEditor`, `TopicEditorHost`, `TopicMark`, `TrashEntryRow`, `pages/index`, `pages/tasks`, `pages/trash`, `pages/welcome`, `pages/overlay`, `layouts/sub-page`), 13 after source-1; (2) the lines of each board and card block, which may only fall.

### The cheapest guard per class of obvious fix

| Class | Findings | Guard |
|---|---|---|
| Empty or dead style block | source-1 | an ESLint rule of the Vue plugin for empty blocks (`vue/no-empty-component-block`; check that the installed plugin version has it), or the block count of ratchet B |
| Hand-written heading | source-4, baseline-3 | `display-layout.test.ts`: a ratchet on `<h1>`–`<h6>` and `<legend>` with a `text-*` or `font-*` class (may only fall) |
| Weight 600 | source-5 | `design-lock-in.test.ts`: a ratchet on `font-semibold` and `font-weight: 600` per file with a reason (the key figures stay listed) |
| Destructive button form | source-7 | `button-ladder.test.ts`: a button with the delete icon (`ICONS.delete`) is `color="error" variant="soft"` or sits in a menu |
| Look written as `class` on a Nuxt UI component | source-8, 10, 11 | `ratchets.test.ts`: a third ratchet beside `ui-prop`, on `text-*`, `font-*`, `px-0`, `ring-*`, `bg-*` classes on `U*` tags (16 today) |
| Call-site `ui` identity | source-12, baseline-1 | exists (`ui-prop`); reword the reasons so the baseline tells keep from move |
| Half steps and off-grid spacing | source-13, baseline-4 | `design-tokens.mjs` `checkScaleLiterals`: flag `-2.5` / `-3.5` utilities, and padding, margin and gap in `<style>` that are not on the grid, 2 or 6 px, with the per-file allowlist it already has |
| Icon size in CSS | source-13 | the same check: width and height on a class that a `UIcon` carries |
| Easing keywords | source-14 | `design-tokens.mjs` `motionLiteralCount`: add the keywords to the count behind `literal-baseline.json` |
| Table row hover, disabled look | source-15, 16 | none needed beyond the fix: both move into the theme or the base layer, where `/ui`'s fingerprint test sees them |
| Line height through the size class | source-23 | `design-lock-in.test.ts:48`: extend the pattern to `text-<size>/<line height>` |
| Button height in a `<style>` block | source-23 | `button-ladder.test.ts`: a `min-height` or `height` below 2.25rem on a class used by a `UButton` needs the file on `SMALLER_BY_DESIGN` |
