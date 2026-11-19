# Findings: the user's feedback (session 2)

Sweep `docs/design/ui-sweep-2026-11/plan.md`, session 2, 2026-11-19. Source checked at `7cb8024a`; `git diff e6786ddc --stat -- components pages layouts assets app.config.ts` is empty, so the code equals the audited commit.

## Method and limits

- Read: all 234 issues (open and closed) that carry `polish`, `consistency`, `ux-impact`, `needs-design`, `rule-candidate` or `agent-decided`, with their comments. Issue numbers below are today's tracker: `https://github.com/jaylouiz/kan-do/issues/<n>`.
- What counts as the user's words: the "Original notes" section an agent kept when it rewrote a body, bodies never rewritten, comments without an agent marker (`D1: …`, `R1: …`), the relayed `decision-answer` comments, and body lines marked `(user, <date>)`. Agent-written problem statements, review findings and decision records were not used as corrections. Every issue is filed under the same GitHub login, so the split is by these markers, not by author.
- Pull requests: no review comment exists in the repository (`pulls/comments` is empty) and no PR carries a comment written by the user; the feedback lives in the issues only.
- Issues that are only `agent-decided` (about 110, mostly sync, server, CI and hook bugs) were read for user comments and answers; they hold no UI correction beyond those listed here.
- Not found in the tracker: the rule candidates "#473" (named in the decision comment of #441) and "#474" (named in #434). `gh issue view 473` and `474` do not resolve. Their reasons are picked up here as feedback-1 and in part C.
- Step 3 was done by reading and grepping the source. Whether a hover, a shift or an alignment is right on screen is for sessions 4 and 5; where a finding needs that, it says so.
- This file was written by the parent session from the subagent's report, word for word (the harness refuses report files written by a subagent).

## Part A: the corrections, grouped

One line per correction: what the user wanted different, the reason given, the issue.

### A1. Remove what repeats or only explains

| Issue | Correction | Reason in the user's words |
|---|---|---|
| #441 | no heading "Bevor es losgeht"; remove the step headlines beside the stepper | "The stepper already says 'Vorbereitung'"; "redundant to the stepper label and even to selection fields" |
| #480 | remove the date from the sheet; remove the working time headline | "redundant to page subline" |
| #568 | remove the note under the stacking pills, shrink the description | "Removing non-essential descriptions for sake of less UI elements, quicker understanding" |
| #431 | remove the "Ansicht" heading in the Mehr panel | "seems unjustified second headline layer of structure" (adopted: `DESIGN.md` "One heading level in a menu") |
| #575 (open) | smaller step headlines, or none | "remove entirely if the current step is clear to the user otherwise" |
| #581 (open) | hide the round add button beside an empty state; remove the "Hier ablegen: Nicht heute" note | "the empty state already has button for adding"; "clear from the overall concept and model of this page" |
| #434 | no text label on the forward button | "it clutters and takes space from the step title" |
| #237 | remove the motivation sentence; shorter text under "Für morgen" | "appears rather goofy and artificial" |
| #238 | remove the two sublines above the statistics verdict | a calmer page intro |
| #367 | drop the second sentence of the empty "Nicht geplant" | |
| #244, #273, #296 | no ⋮ menu in the task sheet, no check mark in the Erledigt title, no icons in the context menu | |
| #566 | no capacity element on the unplanned side | "too much noise" |

### A2. Nothing moves, flickers or appears that the user did not cause

| Issue | Correction | Reason |
|---|---|---|
| #43 | the step change must not animate "each element … individually" | "a smooth transition for the full content at once" |
| #577 (open) | welcome to setup: no shuffling, no sudden sheet size change | "a lot of elements are being shuffled around"; asks for "a systematic, UI-kit driven approach" |
| #225 | hovering a card moved the column headlines; a dropped card flashed | "Appears flaky, unsolid" |
| #579 (open) | list items shake on hover over a column | "No shaky elements movement on just mouse hover" |
| #427 | the board showed for a moment before the recap | "without any content flicker" |
| #490 | recap to planning went through "Heute" first | "A lot of moving parts for the user" |
| #294 | fade to the board only once it is loaded | "so that there's no layout shift or anything after" |
| #436 | no short appearance of the card when pausing | "sudden" |
| #376 | statistics appears "out of a sudden" after a silent wait | "leaving the user a bit confused" |
| #581 (open) | | "As always, consider purposeful transitions. At least no sudden appearance/vanishing of items" |

### A3. Key moments of the day are staged and slower

| Issue | Correction | Reason |
|---|---|---|
| #433 | the first move from planning to "Heute" is slower; same for recap to planning | "a one-time-per-day key transition helping to tell the story. Hence the greater emphasize over other micro animations of pur mechanical actions" |
| #463 | recap fades in slowly; welcome leaves as a curtain | "A curtain that reveals the board" |
| #245 | the recap closes as a curtain, on the photo only, with a feathered edge | "they start fresh" |
| #463, #480 | the day close leaves the modal and becomes a full-size stage | "a full size experience like the other key moments" |
| #580 (open) | the day close opens with the opposite curtain | |
| #295, #400 | the done confirmation stays longer and fades slower | "so that the user has a moment to really notice the appreciation" |

### A4. Sheets for what is operated and for hard data; intros and side notes lie flat

| Issue | Correction | Reason |
|---|---|---|
| #238 | the statistics verdict sits flat on the page, the tiles keep their sheets | "a bit calmer page headline / intro element while the parts below stick out on sheets, containing the 'real' hard data" |
| #217 | the trash header leaves its sheet and becomes a flat note | "looks a bit lost. It is a secondary aspect. let's reduce elevation" |
| #428 | recap headline, summary and decks directly on the background | "Put only the controls in a sheet" |
| #437 | brand and subline out of the welcome sheet | page header above the sheet |
| #333 | two sheets of the sources page become one | "They are one concern on this page, hence one sheet" (adopted: `DESIGN.md` "Sheets on a desk") |
| #1 | | "any user input interaction would happen in a bright … surface, elevated from the canvas" |

### A5. On a phone nothing but the app bar is fixed over the list

| Issue | Correction | Reason |
|---|---|---|
| #248 | the sticky add bar goes; the add button moves into the column header | "taking a lot space and covering tasks" |
| #297 | "Tag abschließen" is the end of the list, not sticky | "instead of heaving it sticky above the app nav" |
| #373 | the footer button on "Alle" goes into the app bar | "so that no tasks are hidden by n multiple navigation elements, especially on mobile" |
| #566 | the fixed capacity bar on the phone goes | "too much noise" |
| #290 | the page dots hide while a drawer is open | so the drawer handle "is visually not mixed up with active column dot" |

### A6. No scroll area inside a page; use the room there is

| Issue | Correction | Reason |
|---|---|---|
| #575 (open) | no scrolling inside the setup sheet on desktop; only a list inside the sheet may scroll | "Double scroll bars … user has to scroll in a quite small area, considering otherwise plenty App space … the looks is untidy" |
| #44 | the recap has no scroll bar | |
| #333, #216 | a row keeps name and actions on one line; meta text uses the horizontal room | "using horizontal the space well" |
| #437 | buttons side by side "where space allows" | |
| #294 | a shorter first screen on the phone | "so that more of the background image becomes visible" |

### A7. Shared edges, equal gaps, room around things

| Issue | Correction |
|---|---|
| #437 | title "left-aligned with the left edge of the sheet content below (same padding)" |
| #297 | the day-close button takes the cards' width |
| #573 (open) | the capacity overlay is wider than the card, so the text is not "too pressed to a visual edge" |
| #293 | "Leave some spacing around the button. today it looks pressed"; both strips' buttons get one shape |
| #33 | the same space above the Wartet headline as below it |
| #469, #373 | the horizontal gap between cards equals the vertical one; a smaller gap shows what belongs together |
| #242, #565, #239 | headlines centred above their stacks; title and buttons centred in the pill; the marker centred on the baseline |

### A8. A flow the user stays in is not a modal; a modal carries no chrome without a purpose

| Issue | Correction | Reason |
|---|---|---|
| #43 | setup flows on the page | "the model pattern does not fit so well as it's a process the user should stay in and there's nothing to switch back to" |
| #468 | the task sheet without header or footer lines | "It's okay to have them with a certain purpose but not only because the typical modal … looks like this" |
| #237, #463 | the day close outgrew its dialog | "bringing the modal pattern to a limit"; "This does not fit the modal pattern" |

### A9. The same thing is built once and looks the same everywhere

| Issue | Correction |
|---|---|
| #293 | deleted gap and yesterday note: "treat as one component with different parameters / variants" |
| #562 (open) | Notion setup in the welcome flow and in settings: "Make both one component … so it's not a double maintenance" |
| #334, #567 | Offen on "Alle" has "same looks and vertical position as in Today view"; the filter there uses the "aligned pattern"; adding a task uses the same in-card flow |
| #237 | list the done tasks "in a similar pattern" |
| #236 | the back button: "Establish this as a navigation pattern so that it can be used in the settings page" |
| #424 | all buttons take the primary's size: "tidier and less cluttered" |
| #565 | "align icon styles. why is one bold and one thin?" |

### A10. A control answers and says what it is

| Issue | Correction |
|---|---|
| #55 | the stack's close button: "Add missing hover state and change cursor to pointer" |
| #425 | app bar items get a hover effect |
| #296 | "menu items show no hover effect" |
| #25 | task cards get a hover effect |
| #264 | the icon-only add button gets a tooltip |
| #470 | the filter button's icon "typically represents a sorting feature" |
| #216 | a delete button is soft red, "so its visually clearer that it is a destructive action" |
| #225, #434, #16 | a place that takes input looks like the standard field ("do not meet input standards"; "Regular select/input field styles, not a stroked line"; "look like an input box") |

### A11. Product behaviour (listed for completeness, already rules)

"A card in Jetzt should never be hidden" (#161, adopted #235). Unfinished tasks go back "so the user has to make a intentional choice" (#334, adopted #352, `PRODUCT.md` principle 7). The app never moves cards by itself (#387). One clear next step (#373, #294). Places that share a column move sideways as one surface (#334, #351: decided as a one-off). No middle dots in copy (#412, `docs/copy/voice.md`, guarded). The sync warning must not look alarming for a suspicion (#369). Overlays dim the whole window (#207, #419: "robust and complete"; #554 open for the phone browser bar).

## Part B: rule candidates and findings

### feedback-1: text and controls that repeat a neighbour were removed ten times; no rule says "say it once" outside menus
- User task: 24 head a page or a section; 10 walk through a setup
- Where: occurrences in A1 (#441, #480, #568, #431, #575, #581, #434, #237, #238, #367). Places that still repeat today: the Reminders setup shows a display-size step headline beside the stepper (`components/setup/RemindersSetupFlow.vue:39-48`) while the Notion flow hides the same headline (`components/setup/NotionSetupFlow.vue:46-52`, `sr-only`); the Notion setup dialog in settings shows "Notion-Einrichtung" under the dialog's own title (`components/notion/setup/wizard/steps/TokenStep.vue:16`); the drop note "Hier ablegen: nicht heute" (`components/board/BoardNotPlanned.vue:52`)
- Evidence: the quotes in A1; `DESIGN.md` "Behaviour" has "One heading level in a menu" (menus and popovers only)
- Against: no rule yet; inconsistent with the Notion flow after #441
- Proposed change: adopt a rule such as "Say it once: a heading, description or control that only repeats what its neighbour already says (a stepper label, the page subline, a field label, a labelled button) is left out." Then remove the three places.
- Group: rule candidate
- Confidence: high, ten corrections in eight surfaces with the same reason
- Effort: small
- Needs design round: no
- Already tracked: #575 (Reminders headline), #562 (settings dialog), #581 (drop note); the rule itself: no (the candidate "#473" is not in the tracker)

### feedback-2: unintended movement was corrected ten times; `DESIGN.md` "Motion" does not forbid it
- User task: 29 go through a key moment; 10 walk through a setup; 23 read a card
- Where: occurrences in A2 (#43, #577, #225, #579, #427, #490, #294, #436, #376, #581). Open today: #577 (welcome to setup), #579 (hover shake in Offen), #581 (add button appears and vanishes)
- Evidence: the quotes in A2; `DESIGN.md` "Motion" says what motion is for, and "States" says a card "never moves", but nothing says that a view arrives as one piece or that hover moves nothing else
- Against: no rule yet (fundamental: layout stability)
- Proposed change: adopt a rule such as "A view arrives as one piece: the incoming content does not rearrange after it is visible, a surface changes size only as a guided motion, and hover never moves a neighbour." Guard it with the layout-shift measurement of session 5 as a spec for the step changes of every flow.
- Group: rule candidate
- Confidence: high, the same complaint in every design round that had a transition
- Effort: medium (the guard); the open places are tracked
- Needs design round: no
- Already tracked: #577, #579, #581 for the places; the rule and the guard: no

### feedback-3: the key moments run 420 to 1400 ms, `DESIGN.md` "Motion" knows only 150, 200 and 300 ms and "short"
- User task: 29 go through a key moment
- Where: `assets/css/recap-stage.css:15-16,27` (700 and 1400 ms), `assets/css/transitions.css:33` (welcome curtain 1300 ms), `assets/css/app-nav.css:65,308,313` (420, 1200, 1400 ms), `assets/css/board.css:102,119` (420, 1200 ms), `assets/css/board-focus-overlay.css:48` (1100 ms); the user's decisions in A3 (#433, #463, #245, #480, #295, #400)
- Evidence: `DESIGN.md` "Motion" table and the sentence "It is short, never decorative"; the user's reason in #433
- Against: `DESIGN.md` "Motion" (the app and the document disagree, the app follows the user)
- Proposed change: adopt a rule such as "A once-a-day key moment (welcome to board, recap, planning to Heute, day close) is a full-size stage and moves slower than a mechanical change; they share the curtain." and name the key-moment durations as tokens in the Motion table, so the eight local values become two or three.
- Group: rule candidate
- Confidence: high, six decisions with one stated reason
- Effort: small (rule and tokens), no visible change
- Needs design round: no
- Already tracked: #580 (the day close's opening curtain) only

### feedback-4: intro text and side notes were taken off sheets four times; `DESIGN.md` still says everything read lies on a sheet
- User task: 32 hold content as a surface; 24 head a page or a section
- Where: A4 (#238, #217, #428, #437). `DESIGN.md:62` ("Everything you read, enter or edit lies on a sheet"), `DESIGN.md:106` (calls the welcome brand "the one exception"), `DESIGN.md:197` (still lists the "trash header" as a `PageSheet`; `pages/trash.vue:25-55` is a flat `UAlert` since #217). Flat today without a named exception: the statistics verdict, the trash note, the recap's headline and summary, the day close's title and date (`components/board/DayCloseStage.vue:47-50`)
- Evidence: the quotes in A4
- Against: `DESIGN.md` "Direction" and "Hold content as a surface" (document and app disagree)
- Proposed change: adopt a rule such as "A sheet holds what is operated and the hard data. A page's intro (headline, lead sentence) and a side note lie flat on the canvas." and correct the three lines of `DESIGN.md`.
- Group: rule candidate
- Confidence: high for the rule (four decisions, one direction); medium for the wording
- Effort: small
- Needs design round: no
- Already tracked: no

### feedback-5: fixed bars over the phone list were removed four times; the topic focus pill is the one left
- User task: 9 group or filter the board
- Where: A5 (#248, #297, #373, #566). Remaining: `components/board/BoardFocusBar.vue:148-155` (`position: fixed` above the app bar on a phone while a topic focus is on)
- Evidence: the quotes in A5; source read only, not seen on screen
- Against: no rule yet; inconsistent with the four removals
- Proposed change: adopt a rule such as "On a phone only the app bar is fixed over a list; an action or a note sits in the header or at the end of the list." and decide where the "Fokus: <topic>" pill goes (into the app bar beside the funnel, or the head of the column).
- Group: rule candidate
- Confidence: medium, the pill shows only while a filter is on and may be wanted as a standing reminder; session 4's 390 px screenshots of a focused board would confirm whether it covers a card
- Effort: small (rule), medium (moving the pill)
- Needs design round: yes, for the pill
- Already tracked: #573 covers the capacity overlay on "Alle" only

### feedback-6: the scroll area inside the setup sheet is also in the Notion flow, the issue names Reminders only
- User task: 10 walk through a setup
- Where: `components/setup/NotionSetupFlow.vue:53` and `:57`, the same wrapper as `components/setup/RemindersSetupFlow.vue:50` (`max-h-[60dvh] overflow-y-auto md:max-h-(--modal-height-wizard)`); also `components/notion/setup/NotionSetupModal.vue:59`
- Evidence: #575 "Double scroll bars … At least in desktop size, there is no scrolling within the sheet"; #44 (recap without scroll bar)
- Against: the user's acceptance criterion in #575; the height token is named for a modal the flow no longer is
- Proposed change: fix both flows in one change (the sheet grows with its step and the page scrolls; only a list inside may scroll) and word it as a rule: "No scroll area inside a page that scrolls, except a list inside a sheet."
- Group: rule candidate (two occurrences: #575, #44), with the Notion flow as an uncovered place
- Confidence: high for the place (same line of code), medium for the rule (two occurrences)
- Effort: small when done with #575
- Needs design round: no
- Already tracked: #575 for Reminders; the Notion flow: no

### feedback-7: the setup shell exists three times
- User task: 10 walk through a setup
- Where: `components/setup/NotionSetupFlow.vue:36-60,107-192` and `components/setup/RemindersSetupFlow.vue:29-52,126-205` hold the same rail grid, pane animation, scroll wrapper and `DONE_BEAT_MS`; `components/notion/setup/NotionSetupModal.vue` is a third shell for the same steps, opened from `pages/settings/index.vue:175`, while Reminders in settings runs on the page (`pages/settings/reminders.vue:17`)
- Evidence: #562 "Make both one component … so it's not a double maintenance"; #293 "treat as one component with different parameters / variants"; #577 "a systematic, UI-kit driven approach that could be applied to similar use cases"; #43 (setup is not a modal)
- Against: `DESIGN.md` "Components" (a shared primitive from three call sites on); inconsistent between the two sources in settings (dialog against page)
- Proposed change: one setup shell (back button, rail, one pane that changes size as a guided motion, done beat) used by Notion and Reminders in the welcome flow and in settings; the dialog goes.
- Group: proposal
- Confidence: high, three open issues of the user point at the same shell
- Effort: medium
- Needs design round: no (the look is decided in #441 and #481)
- Already tracked: #562 (Notion's two cases), #577 (the transition), #575 (the room); none names the shared shell, so they are best done as one batch

### feedback-8: a row's destructive action has three looks
- User task: 1 trigger an action; 11 confirm an irreversible action
- Where: soft in the error tone (the rule): `components/task/TaskSheetActions.vue:40`, `components/trash/TrashEntryRow.vue:53`, `components/task/TaskCarryOverTriage.vue:53`. Ghost neutral with a red icon: `components/settings/GithubTokenRow.vue:49`, `components/task/TaskCarryOverTriage.vue:87`. Ghost in the error tone: `pages/settings/reminders.vue:69` ("Trennen"). And the confirm of "Trennen" is the solid green button when nothing is unsynced: `components/settings/DisconnectSourceDialog.vue:78-80`
- Evidence: #216 "put delete button in soft red (error tone) theme so its visually clearer that it is a destructive action"; `DESIGN.md` "Trigger an action" ("the destructive one of such a pair, which is soft in the error tone") and "The Status Is Not Decoration Rule" (green is action or done, red destructive)
- Against: `DESIGN.md` "Trigger an action"
- Proposed change: one look for the destructive action of a row (soft, error tone) in the four places, and decide whether a confirming "Trennen" may be green.
- Group: proposal (the rule's words cover "a pair"; a row of three and a dialog confirm are a reading of it)
- Confidence: high for the token row and the triage row, medium for the dialog
- Effort: small
- Needs design round: no
- Already tracked: no

### feedback-9: the back button of the local setup step says "Zurück", its sibling says "Zurück zur Auswahl"
- User task: 30 step back
- Where: `components/setup/LocalSetupFlow.vue:17` (`common.back`) against `components/setup/SamplesSetupFlow.vue:16` (`onboarding.flow.backToChoice`); both lead to the same start view. Inside the Notion and Reminders flows every step after the first also reads "Zurück" (`NotionSetupFlow.vue:34`, `RemindersSetupFlow.vue:27`)
- Evidence: #236 "the 'Zur Auswahl' button gets an arrow and is wording should become 'Zurück zur Auswahl'"; `DESIGN.md` "Step back": "the label 'Zurück zu <where>' names where it leads"
- Against: `DESIGN.md` "Step back in a flow or a deeper route"
- Proposed change: `LocalSetupFlow` uses "Zurück zur Auswahl". For a step back inside a flow, either the rule names the plain "Zurück" as allowed or the label names the step.
- Group: obvious fix (the local step); proposal (the wording of the rule for inner steps)
- Confidence: high, same destination with two labels
- Effort: small
- Needs design round: no
- Already tracked: no

### feedback-10: nine icon-only buttons have no tooltip
- User task: 1 trigger an action
- Where: `components/board/BoardFocusTrigger.vue:14` (the funnel), `components/board/BoardFocusBar.vue:44`, `components/board/BoardCapacityDivider.vue:89`, `components/task/TaskCard.vue:68` (card menu), `components/task/TaskMorphShell.vue:33` (close), `components/trash/TrashEntryRow.vue:53` (remove for good), `components/settings/SourceRow.vue:64` ("…"), `components/recap/RecapDeck.vue:65,78`. With a tooltip today: the Offen add button, the plan arrows, the Mehr button, the annotator's tools
- Evidence: #264 "it has no hover tooltip, so its purpose is only carried by the icon"; #470, where the funnel's former icon was read as sorting. Counted from the source: 13 self-closing icon-only `UButton`, 9 outside a `UTooltip`
- Against: inconsistent with the Offen add button (#264); no rule in `DESIGN.md`
- Proposed change: an icon-only button that is not a plain close or a "…" carries a tooltip with its accessible name on pointer devices (at least the funnel, the capacity info and "remove for good").
- Group: proposal
- Confidence: medium, one explicit correction; which of the nine need it is a choice
- Effort: small
- Needs design round: no
- Already tracked: no

### feedback-11: a control that does not answer was corrected four times; the rule exists, a guard for hand-built controls does not
- User task: 1 trigger an action
- Where: A10 (#55, #425, #296, #25), each fixed in its place. Hand-built pressables today: the 17 raw `<button>` in 11 files (`AddTaskSlot`, `NewCardOptionList`, `AppNav`, `StatsTile`, `TopicPropertyPicker`, `ChoiceCard`, `ChoiceChip`, `ListRow`, `PropertyValueTrigger`, `SwatchRadioGroup`, `InlineEditable`) and the `role="button"` of `TaskStack.vue:54`, `NowWindow.vue:45`, `InlineEditable.vue:46,68`
- Evidence: `DESIGN.md` "States" (Pressable: the hand cursor; Hover: the fill one step darker). No broken place was seen in the source; whether each of the listed elements answers is session 4's state walk
- Against: `DESIGN.md` "States" (rule exists, was broken four times)
- Proposed change: a spec that hovers every hand-built pressable on `/ui` and the board and asserts the hand cursor and a changed computed style.
- Group: guard
- Confidence: medium, the history is clear, today's state is not measured here
- Effort: small
- Needs design round: no
- Already tracked: no

### feedback-12: the bright-ground check covers the welcome page and the recap, not the day close
- User task: 29 go through a key moment
- Where: `components/board/DayCloseStage.vue:47-50` (title and the date in `text-toned`, directly on the photo); checks exist in `tests/e2e/welcome-setup.spec.ts:361` and `tests/e2e/new-day-recap.spec.ts:631-638`, none in `tests/e2e/day-close.spec.ts`
- Evidence: #437 "the background image and its positioning must give a bright enough background for contrast"; `DESIGN.md` "The Bright Ground Rule" ("checked on the rendered page at 1280 and 390 px, not assumed")
- Against: `DESIGN.md` "The Bright Ground Rule" (rule exists; guard is partial)
- Proposed change: the same `expectContrast` lines for the day close's title and date at both widths.
- Group: guard
- Confidence: medium, the missing check is read from the specs; the contrast itself was not measured (session 4 can)
- Effort: small
- Needs design round: no
- Already tracked: no

### feedback-13: page-level lists outside the board still show the one-sentence empty note
- User task: 16 show an empty place
- Where: `components/statistics/TasksTable.vue:17`, `components/settings/DataBackupList.vue:60`; `EmptyState` (graphic and subline) is used in `pages/trash.vue:21` and `pages/settings/topics.vue:56` only
- Evidence: #68, the user's answer: "Agree for the task board but at other places a calm graph and a subline is desired"; `DESIGN.md` "Show an empty place" narrowed this to "a page or tab whose main content is a list"
- Against: the user's wording is wider than the rule written from it
- Proposed change: decide whether the statistics task list and the backup list count as such a place; if yes, they take `EmptyState`.
- Group: proposal
- Confidence: low, the narrowing may be what the user accepted in #106; a look at both empty places (session 4) would settle it
- Effort: small
- Needs design round: no
- Already tracked: no

### feedback-14: "Todoist (Bald verfübar)" in the first-run setup
- User task: 10 walk through a setup
- Where: `i18n/locales/de.json:1363` (`onboarding.flow.local.todoist`); English reads "Todoist (coming soon)"
- Evidence: a spelling slip ("verfübar") and a capital inside the bracket, on the second screen a new user sees; found while reading the step for feedback-9
- Against: `docs/copy/voice.md` (plain correct copy)
- Proposed change: "Todoist (bald verfügbar)".
- Group: obvious fix
- Confidence: high
- Effort: small
- Needs design round: no
- Already tracked: no

### feedback-15: equal gaps and shared edges were corrected nine times, each in its place
- User task: 23 read a card; 24 head a page or a section
- Where: A7 (#437, #297, #573, #293, #33, #469, #373, #242, #565). No further place was read from the source; alignment is a rendered property
- Evidence: the quotes in A7
- Against: fundamentals (alignment to a shared edge, spacing rhythm); no named rule
- Proposed change: two short rules to adopt or decline: "What belongs together shares an edge: a heading, a button or a note takes the content edge of the block it belongs to." and "Nothing is pressed to an edge: a control inside a strip keeps the strip's padding on every side." Session 4 step 1 checks the screens against them.
- Group: rule candidate
- Confidence: medium, many occurrences but a broad wording
- Effort: small
- Needs design round: no
- Already tracked: #573 for the capacity overlay

### feedback-16: "a flow is not a modal" was said three times; `DESIGN.md` words it the other way round
- User task: 13 ask in a dialog; 10 walk through a setup
- Where: A8 (#43, #468, #237 with #463). `DESIGN.md` "Ask in a dialog": "`AppDialog` … For flows that need the whole stage". Still a dialog today: the Notion setup in settings (feedback-7); the three-step feedback dialog (`components/feedback/FeedbackDialog.vue`) is a short flow the user leaves again, so it fits
- Evidence: the quotes in A8
- Against: `DESIGN.md` "Ask in a dialog" (wording)
- Proposed change: adopt a rule such as "A process the user stays in until it is done (a setup, a key moment) is a page or a stage. A dialog is for a question or a short task the user returns from, and carries no header or footer line without a purpose." and reword the `DESIGN.md` line.
- Group: rule candidate
- Confidence: medium, three decisions, but each was also about its own surface
- Effort: small
- Needs design round: no
- Already tracked: #562 for the one place

## Part C: what the next session must know

- Already tracked by the user's own open issues (fold into "Already tracked", do not propose again): #573, #575, #577, #579, #580, #581, #554, #562, #374.
- Rules that came from feedback and are in `DESIGN.md` or `PRODUCT.md` already: #235, #318, #352, #464, #472, #333 (one concern, one sheet), #424 (one height), #216 (two soft buttons), #236 (back button), #412 (no middle dots). #351 was decided as a one-off.
- The candidates "#473" and "#474" named in #441 and #434 are not in the tracker. "#473" is feedback-1. "#474" held two reasons from #434: a text label on an icon button "clutters and takes space from the step title", and Backspace as "back" "conflicts with active input fields"; each was said once, so neither is a rule candidate here.
- feedback-3 and feedback-4 are places where `DESIGN.md` and the app disagree and the app follows a user decision: the overview should offer them as rule candidates with the document correction, not as defects of the app.
- Sessions 4 and 5 can confirm: feedback-5 (does the focus pill cover a card at 390 px), feedback-11 (hover and cursor on the hand-built pressables), feedback-12 (contrast of the day close's title and date), feedback-2 (shift on the welcome to setup step and on column hover).
