# UI sweep 2026-11: adopted design rules (items 81 to 89)

The user ticked items 81 to 89 of `overview.md` ("Rule candidates") on 2026-11-19. Each tick is the explicit "adopt" that the skill `design-rule` asks for. Each item went through the three-test challenge (convention, `PRODUCT.md`, existing `DESIGN.md`) and was then written to `DESIGN.md`. The sources with the quotes are in `findings-feedback.md` (feedback-1 to -6, -15, -16) and `findings-motion.md` (motion-12, motion-13).

Size of `DESIGN.md`: 23729 bytes before, 26654 bytes after.

Two of the nine rules are written in the `**The … Rule.**` form (Motion). That form is mirrored word for word in `.impeccable/design.json` (`tests/config/design-sidecar.test.ts`), so the sidecar got the two rules, the changed body of The Bright Ground Rule, the three new motion tokens and the corrected overview sentence. The other seven are named bullets in "Layout" and "Behaviour", the form "One heading level in a menu" already has; the sidecar does not list those.

## Open decisions for the user

1. `PRODUCT.md` principle 6 still ends with "Dialogs are for flows that need the whole stage", the sentence item 89 turned round in `DESIGN.md`. `PRODUCT.md` was not touched. Suggested wording: "A dialog is for a question or a short task the user returns from."
2. Item 83, token values: 400, 700 and 1300 ms were chosen. Folding moves 420 to 400, and 1100, 1200 and 1400 to 1300, so the claim "no visible change" holds only roughly (at most 200 ms on a move longer than a second). If the exact values matter, the alternative is four tokens.
3. Item 83, the focus overlay (`--focus-in-duration: 1100ms`, `assets/css/board-focus-overlay.css:48`, "the lamp warming up") is among the eight values of feedback-3, but it is not a once-a-day moment. Either it folds into `--duration-stage` or it stays a component choreography recorded in its doc block.
4. Item 85: one sentence was added to the rule ("A drawer or a toast is an overlay, not a fixed bar"), because both are fixed over a list on a phone and are not meant.
5. Item 87: the sharpening added the centre line and the gap ("the gap inside a group is smaller than the gap around it"). Both come from the same nine corrections (#242, #565, #469, #373), but they are more than the ticked sentence said.

## 81. Say it once

```
Rule proposal: A heading, description or control that only repeats what its neighbour already says (a stepper label, the page subline, a field label, a labelled button) is left out.
Your reason: "The stepper already says 'Vorbereitung'" and "redundant to the stepper label and even to selection fields" (#441); "redundant to page subline" (#480); "Removing non-essential descriptions for sake of less UI elements, quicker understanding" (#568); also #431, #575, #581, #434, #237, #238, #367 (issue comments).
Challenge: matches convention: (a) Nielsen's heuristic 8 (aesthetic and minimalist design: every extra unit of information competes with the relevant ones); (b) PRODUCT.md principle 1 "Remove chrome before adding it"; (c) DESIGN.md "One heading level in a menu" says the same for menus, nothing contradicts. One limit from WCAG 2.2 (4.1.2 Name, Role, Value; 2.5.3 Label in Name): a control whose visible label goes (the forward button of #434) keeps an accessible name. The rule says so.
Where it goes: DESIGN.md named rule "Say it once" in "Behaviour"
Adopt? yes (user, 2026-11-19, tick on item 81)
```

Written: DESIGN.md "Say it once" in "Behaviour", directly above "One heading level in a menu".

Code follow-up: the Reminders step headline (`components/setup/RemindersSetupFlow.vue:39-48`, #575), the heading "Notion-Einrichtung" under the dialog title (`components/notion/setup/wizard/steps/TokenStep.vue:16`, #562), the drop note (`components/board/BoardNotPlanned.vue:52`, #581), and overview item 30.

## 82. The One Piece Rule

```
Rule proposal: A view arrives as one piece: incoming content does not rearrange after it is visible, a surface changes size only as a guided motion, and hover never moves a neighbour.
Your reason: "a smooth transition for the full content at once" (#43); "Appears flaky, unsolid" (#225); "so that there's no layout shift or anything after" (#294); "No shaky elements movement on just mouse hover" (#579); also #577, #427, #490, #436, #376, #581 (issue comments).
Challenge: matches convention: (a) layout stability is a named quality measure (Cumulative Layout Shift, Core Web Vitals), and Material's motion guidance moves a container as one unit; (b) PRODUCT.md "Emotional goal: calm, focused, satisfied. Never urgent, cluttered, or overwhelming"; (c) DESIGN.md "States" already says a card "never moves" on hover, and "Motion" says motion explains a state change. The rule widens both, nothing contradicts.
Where it goes: DESIGN.md Named Rule "The One Piece Rule" in "Motion"
Adopt? yes (user, 2026-11-19, tick on item 82)
```

Written: DESIGN.md "The One Piece Rule" in "Foundations", "Motion" (and in `.impeccable/design.json`).

Code follow-up: #577 (welcome to setup), #579 (hover shake in Offen), #581 (add button appears and vanishes), the measured places of overview items 19, 21 to 24, 41, 43, 46, 69 and 73, and the guard of item 101 (layout-shift measurement as a spec).

## 83. The Key Moment Rule

```
Rule proposal: A once-a-day key moment (welcome to board, recap, planning to "Heute", day close) is a full-size stage and moves slower than a mechanical change; the key moments share the curtain.
Your reason: "a one-time-per-day key transition helping to tell the story. Hence the greater emphasize over other micro animations of pur mechanical actions" (#433); "A curtain that reveals the board" (#463); "they start fresh" (#245); "a full size experience like the other key moments" (#463, #480); "so that the user has a moment to really notice the appreciation" (#295, #400) (issue comments).
Challenge: conflicts: (a) Material 3's duration scale ends at 1000 ms and platform guidance keeps interface motion brief; the app runs these moments at 1100 to 1400 ms and plays the recap on app start, without a user action; (c) DESIGN.md "Motion" said motion "is short" and "never runs on page load". (b) PRODUCT.md is split: principle 4 "positive reinforcement is a whisper, not a fanfare" speaks against, the day rhythm ("Tag abschließen", "Kurzer Rückblick") and the emotional goal "satisfied" speak for. Counter-argument: a long move delays the user every day, and a new exception class invites more slow motion. What limits it: four named moments, once a day, instant under `prefers-reduced-motion`.
Where it goes: DESIGN.md Named Rule "The Key Moment Rule" in "Motion"
Adopt? yes (user, 2026-11-19, tick on item 83), written as a deliberate exception
```

Written: DESIGN.md "The Key Moment Rule" in "Foundations", "Motion", in the form "Deliberate exception (user, 2026-11-19): … Challenge was: conflicts: …" (and in `.impeccable/design.json`). Also in "Motion":

- three tokens in the table: `--duration-place` 400 ms (a place change of the board and the app bar's indicator), `--duration-curtain` 700 ms (a key moment's curtain), `--duration-stage` 1300 ms (a key moment's stage arriving or leaving, and the place change inside it);
- the sentence "It is short, never decorative or looping, never runs on page load" now reads: a mechanical change is short, and on page load nothing moves except a key moment that opens the session (the new-day recap, the welcome photo).

Code follow-up: the three tokens do not exist in `assets/css/main.css` yet. Add them and fold the local values: `--nav-move` 420, 1200 and 1400 ms (`assets/css/app-nav.css:65,308,313`), `--place-move` 420 and 1200 ms (`assets/css/board.css:102,119`), `--recap-curtain-duration` 700 and 1400 ms and `--recap-enter-duration` 1400 ms (`assets/css/recap-stage.css:15-16,27`), `--welcome-curtain-duration` 1300 ms (`assets/css/transitions.css:33`), `--focus-in-duration` 1100 ms (`assets/css/board-focus-overlay.css:48`, see open decision 3). The two deep links that animate on load (`/tasks/:id`, `/tasks/add`, motion-12, overview item 26) are not key moments and should open at rest. #580 (the day close's opening curtain) falls under the rule.

## 84. Flat intro, lifted work

```
Rule proposal: A sheet holds what is operated and the hard data; a page's intro (headline, lead sentence) and a side note lie flat on the canvas.
Your reason: "a bit calmer page headline / intro element while the parts below stick out on sheets, containing the 'real' hard data" (#238); "looks a bit lost. It is a secondary aspect. let's reduce elevation" (#217); "Put only the controls in a sheet" (#428); brand and subline out of the welcome sheet (#437) (issue comments).
Challenge: matches convention: (a) Material and Apple's grouped layouts put the page title on the background and reserve the lifted surface for grouped content and controls; elevation marks what matters; (b) PRODUCT.md principle 2 "Space is content" ("calm comes from restraint; avoid nesting"); principle 3 "content sits on a sheet" stays true for the content below the intro; (c) DESIGN.md said the opposite in three lines (Direction, The Bright Ground Rule, "Hold content as a surface"), which the app no longer followed. Those lines are corrected, so no exception form is needed.
Where it goes: DESIGN.md named rule "Flat intro, lifted work" in "Layout"
Adopt? yes (user, 2026-11-19, tick on item 84)
```

Written: DESIGN.md "Flat intro, lifted work" in "Layout", below "Sheets on a desk". The three lines:

- "Direction": "Everything you read, enter or edit lies on a sheet" now reads "Everything you enter, edit or operate, and the hard data, lies on a sheet; a page's intro and a side note lie flat on the desk".
- The Bright Ground Rule: no longer "the one exception"; flat text on the plain canvas follows the new rule, on a photo The Bright Ground Rule decides.
- "Hold content as a surface": the trash header is no longer listed as a `PageSheet`; the line names the trash note as flat.

Code follow-up: none (the app already follows it: statistics verdict, trash note, recap headline and summary, day close title and date).

## 85. Only the app bar is fixed

```
Rule proposal: On a phone only the app bar is fixed over a list; an action or a note sits in the header or at the end of the list.
Your reason: "taking a lot space and covering tasks" (#248); "instead of heaving it sticky above the app nav" (#297); "so that no tasks are hidden by n multiple navigation elements, especially on mobile" (#373); "too much noise" (#566) (issue comments).
Challenge: matches convention: (a) WCAG 2.2 SC 2.4.11 Focus Not Obscured names sticky bars as the cause of covered content. The rule is stricter than Material, which allows a floating action button and a bottom bar; the stricter line is the product's own: (b) PRODUCT.md principle 1 "Remove chrome before adding it" with its example "one bar came"; (c) DESIGN.md "Chrome": "one global app bar on every page. The board has no toolbar of its own". Nothing contradicts.
Where it goes: DESIGN.md named rule "Only the app bar is fixed" in "Layout"
Adopt? yes (user, 2026-11-19, tick on item 85)
```

Written: DESIGN.md "Only the app bar is fixed" in "Layout", below "Board (phone)". One sentence added: a drawer or a toast is an overlay, not a fixed bar (open decision 4).

Code follow-up: the topic focus pill (`components/board/BoardFocusBar.vue:148-155`, fixed above the app bar on a phone; overview item 42, needs a design round for its new place) and the capacity overlay on "Alle" (#573).

## 86. One scroll per page

```
Rule proposal: No scroll area inside a page that scrolls, except a list inside a sheet.
Your reason: "Double scroll bars … user has to scroll in a quite small area, considering otherwise plenty App space … the looks is untidy" (#575); the recap has no scroll bar (#44) (issue comments).
Challenge: matches convention: (a) nested scroll areas in the same direction are a known usability problem (Nielsen Norman Group on scrolling within a page; Material advises against nested scrolling in one direction); (b) PRODUCT.md principle 2 "avoid nesting and dense rows"; (c) DESIGN.md had no rule. Two occurrences are few for a rule; the convention carries it.
Where it goes: DESIGN.md named rule "One scroll per page" in "Layout"
Adopt? yes (user, 2026-11-19, tick on item 86)
```

Written: DESIGN.md "One scroll per page" in "Layout".

Code follow-up: the scroll wrapper `max-h-[60dvh] overflow-y-auto md:max-h-(--modal-height-wizard)` in `components/setup/RemindersSetupFlow.vue:50` (#575), `components/setup/NotionSetupFlow.vue:53,57` and `components/notion/setup/NotionSetupModal.vue:59` (not in an issue). Fix both flows in one change.

## 87. Shared edges

```
Rule proposal: What belongs together shares an edge: a heading, a button or a note takes the content edge of the block it belongs to (its centre line where the block is centred), and the gap inside a group is smaller than the gap around it.
Your reason: title "left-aligned with the left edge of the sheet content below (same padding)" (#437); the day-close button takes the cards' width (#297); headlines centred above their stacks (#242); the same space above the Wartet headline as below it (#33); a smaller gap shows what belongs together (#469, #373) (issue comments).
Challenge: matches convention: (a) the Gestalt principles of proximity and continuity (alignment to a shared edge) and the layout margins of Material and Apple's guidelines; (b) PRODUCT.md principle 3: "inside a sheet headings, type scale and space structure it before lines, boxes and fills do"; (c) DESIGN.md "Sheets on a desk": "type, space and hairlines group content". Nothing contradicts. The ticked wording was broad: "edge" did not cover the centred headlines of #242 and #565, and the gap corrections had no sentence. The sharpened wording names both and keeps the meaning.
Where it goes: DESIGN.md named rule "Shared edges" in "Layout"
Adopt? yes (user, 2026-11-19, tick on item 87)
```

Written: DESIGN.md "Shared edges" in "Layout".

Code follow-up: overview item 10.

## 88. Nothing pressed to an edge

```
Rule proposal: A control inside a strip keeps the strip's padding on every side.
Your reason: "Leave some spacing around the button. today it looks pressed" (#293); the capacity overlay's text is "too pressed to a visual edge" (#573) (issue comments).
Challenge: matches convention: (a) consistent inner padding of a container (Material and Apple layout margins) and WCAG 2.2 SC 2.5.8 Target Size, which asks for space around a small target; (b) PRODUCT.md principle 2 "Space is content"; (c) DESIGN.md "Space, size and shape" names the 4 px grid but no padding rule. Nothing contradicts.
Where it goes: DESIGN.md named rule "Nothing pressed to an edge" in "Layout"
Adopt? yes (user, 2026-11-19, tick on item 88)
```

Written: DESIGN.md "Nothing pressed to an edge" in "Layout".

Code follow-up: the capacity overlay on "Alle" (#573).

## 89. A process is a page

```
Rule proposal: A process the user stays in until it is done (a setup, a key moment) is a page or a stage; a dialog is for a question or a short task the user returns from, and carries no header or footer line without a purpose.
Your reason: "the model pattern does not fit so well as it's a process the user should stay in and there's nothing to switch back to" (#43); "It's okay to have them with a certain purpose but not only because the typical modal … looks like this" (#468); "bringing the modal pattern to a limit" and "This does not fit the modal pattern" (#237, #463) (issue comments).
Challenge: matches convention: (a) Apple's guidelines on modality (a modal is for a short, narrowly scoped task and keeps the way back visible) and Material (a dialog for a decision or a brief task, a full-screen surface for a longer one); (b) PRODUCT.md principle 6 "Ask in place" agrees in its first sentence, but its last sentence ("Dialogs are for flows that need the whole stage") says the opposite and is still there (open decision 1); (c) DESIGN.md "Ask in a dialog" had the same sentence and is reworded; "No modal on modal" and "Quiet notices over interruptions" agree. A dialog still needs an accessible name (WCAG 4.1.2); a title that names the dialog has a purpose.
Where it goes: DESIGN.md named rule "A process is a page" in "Behaviour"
Adopt? yes (user, 2026-11-19, tick on item 89)
```

Written: DESIGN.md "A process is a page" in "Behaviour"; the "Ask in a dialog" line in "Components" now reads "For a question or a short task the user returns from, never for a process".

Code follow-up: the Notion setup dialog in settings (#562, overview item 54). The three-step feedback dialog fits the rule.


Note (session 7 parent, 2026-11-19): the clause "the gap inside a group is smaller than the gap around it" was taken out of "Shared edges" again before the commit. It goes beyond the sentence the user ticked; it stays a possible later rule candidate (sources #242, #469, #373).
