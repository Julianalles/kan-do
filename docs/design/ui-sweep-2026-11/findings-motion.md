# Findings: motion (session 5)

Session 5 of `plan.md`, audited commit `e6786ddc` (`git diff e6786ddc --stat -- components pages layouts assets app.config.ts` was empty at `7cb8024a`).

This file was written by the parent session from the subagent's report, word for word (the harness refuses report files written by a subagent).

## Method

- Production build (`PORT=3105 node scripts/e2e-server.mjs`), the repo's Playwright Chromium, headless, locale `de-DE`, 1280 × 800 and 390 × 844, light.
- 217 recordings. Each has a video and a raw file with: every `layout-shift` entry (value, `hadRecentInput`, sources), the box of up to 400 elements sampled every frame (main blocks, everything with a test id, cards, columns, dialogs, menus), opacity and transform of the page roots and dialogs, and every animation `document.getAnimations()` reported (kind, property or name, duration, delay, easing, target).
- Reduced motion (`reducedMotion: 'reduce'`) for every route change, every welcome step and 30 other transitions.
- Page loads were recorded from the first frame (the recorder starts itself after a reload).
- Evidence folder: `.playwright-screenshots/ui-sweep/5/` in the main checkout. A finding names the recording id; the files are `video/<id>.webm` and `raw/<id>.json`. `@d` is 1280, `@m` is 390, `@d-reduced` is 1280 with reduced motion. Times are milliseconds after the recording started; the click lands at about 40 to 60 ms. Scripts in the same folder: `lib.mjs`, `a-routes-welcome.mjs`, `b-board.mjs`, `d-rest.mjs`, `e-load.mjs`, `c-matrix.mjs`, `agg.mjs`.
- Limits: Chromium only; frames are what a headless 60 Hz run delivered (largest gap 67 ms); a layout shift within 500 ms of a click carries `hadRecentInput`, so "without input" only shows on async changes and page loads. That is why the per-frame boxes are the main measure, not the layout-shift score.

## Step 1 and verdicts: every transition

Verdict: **ok** (matches `DESIGN.md` "Motion" or a choreography the component records), **off ramp** (works, values outside the tokens, see motion-13), **finding** (number), **not recorded**.

| Transition | Measured | Verdict |
|---|---|---|
| Heute ↔ Alle (9.3) | board slides 853 px (780 px on a phone) in 420 ms `cubic-bezier(0.2,0.7,0.2,1)`, headers cross-fade, page dots 320 ms; instant under reduced motion | ok, off ramp (recorded in `AppNav` and `board.css`); motion-15 for the progress chip |
| Heute ↔ Statistik, Heute → Einstellungen, Heute → Papierkorb, Einstellungen → Heute | no page motion at all: the new page's elements appear in one frame; only the app bar moves (indicator springs, third segment 420 ms) | finding motion-2 |
| Einstellungen ↔ Themen, and between Statistik, Einstellungen, Papierkorb | `.page-*` runs: 200 ms `ease`, 10 px rise; new page stacked below the old one, then a jump | finding motion-1, motion-3 |
| Mehr panel open / close | Nuxt UI `scale-in` / `scale-out` 100 ms | off ramp (motion-14); finding motion-6 on close |
| Settings tabs, Themen tabs | indicator 200 ms `cubic-bezier(0,0,0.2,1)`; content swaps in one frame | ok, off ramp (motion-14) |
| Welcome: start ↔ local / samples / Notion (1.2 to 1.5, 1.11) | leave 140 ms `ease-in`, height 300 ms, enter 260 ms `cubic-bezier(0.3,0.8,0.3,1)`, 32 px sideways; nothing jumps; instant under reduced motion | ok, off ramp |
| Welcome: local → Notion and back (sheet widens) | column `max-width` 300 ms starts with the leave, the leaving block reflows while it fades | already tracked #577 (motion-5) |
| Welcome Notion: intro → token → database → properties (1.6 to 1.8) | pane slides 14 px in 240 ms; sheet height changes in one frame | finding motion-4 |
| Welcome → board, the curtain (1.9, samples and local) | 1300 ms rise and fade, brand flight 420 ms, board enters beneath in 200 ms; no layout shift; instant under reduced motion except the board's own 200 ms rise | ok (recorded in `welcome.vue`), off ramp; motion-3 |
| Card → task sheet, and back (4.1) | morph 280 ms emphasized open, 200 ms standard close; 1 ms under reduced motion | ok, off ramp (280 ms); motion-3 for the content's rise |
| Task sheet on a phone, add form on a phone, topic editor on a phone | drawer 500 ms `cubic-bezier(0.32,0.72,0,1)` | off ramp (motion-14) |
| Add form on desktop (4.13) | side sheet slides about 200 ms, the app bar group re-centres 288 px in step, draft card grows in 200 ms | ok |
| Sheet: status select, topic picker, Metadaten | select `scale-in` 100 ms; Metadaten `collapsible-down` 200 ms `ease-out` | ok, off ramp; motion-3 (Metadaten under reduced motion) |
| Sheet: status changed while open | sheet height 519.5 → 424 px in one frame | finding motion-9 |
| Sheet: delete (4.8) | sheet folds back into the card (12 frames), then the gap | ok |
| Card context menu, sort menu, tooltip | `scale-in` 100 ms | off ramp (motion-14) |
| Delete from the board: gap, undo, gap closing (2.10) | gap 220 ms `cubic-bezier(0,0,0.2,1)`, neighbours glide 84 px in 200 ms; closing 280 ms; undo: neighbours jump | off ramp; finding motion-10; motion-3 |
| Drag: pick up, neighbours, drop, set down, cancel (2.7) | pick-up 150 ms, neighbours `translate` 200 ms, set-down 200 ms, all emphasized | ok |
| Drag over an empty column (2.4) | the origin column closes 144 px in one frame | finding motion-11 |
| Drag into a full Jetzt, swap and toast (2.7) | swap glides; toast `toast-slide-in-from-bottom` 200 ms | ok, off ramp (toast easing) |
| Completion: burst, confirmation layer, check (2.9) | burst 1200 ms, confirmation 3380 ms, check pop 480 ms spring; none under reduced motion | ok (recorded exception "Earned celebration"), off ramp |
| Timebox nudge (2.8) | 180 ms in, chip pop 240 ms after a 240 ms delay, 8 s countdown bar | ok, off ramp (180, 240 ms) |
| New card flow: open, title → timebox, cancel (2.11) | slot opens in 200 ms, neighbours glide 144 px; the timebox step grows the card 22 px in one frame | ok; finding motion-9 |
| Stacks: switch on, expand, collapse (2.13) | expand and collapse 200 ms standard, nothing jumps on the board; switching grouping on is one frame | ok; finding motion-7 |
| Topic focus: funnel, pick a topic (2.15) | chip row pushes the board 52 px in one frame; picking a topic re-lays the board in one frame | finding motion-8 |
| "Gestern erledigt" note (2.18) | opens 42 px in one frame, caret turns in 180 ms | finding motion-9 |
| Command palette open, close, typing (2.26) | `scale-in` / `fade-in` 200 ms; list collapses 576 → 235.5 px in two frames on "no result" | off ramp; finding motion-16 |
| Feedback dialog, disconnect dialog, Notion setup dialog and its steps | `scale-in` 200 ms; the dialog keeps its size between steps | ok, off ramp (motion-14) |
| Day close: open, cancel, done (5.1 to 5.3) | `recap-stage-in` 1400 ms; leave: photo 700 ms, content 200 ms | already tracked #580 (entry); off ramp |
| Recap: opens on load, next card, both leave buttons (5.4 to 5.7) | 1400 ms on load; card 130 ms then 300 ms with overshoot; leave 700 ms; none under reduced motion | finding motion-12; off ramp |
| Statistik: tile open and close, the table fold (6.2, 6.3) | no motion: the tile goes 314.5 → 992 px wide and the neighbours move 551.5 px in one frame | finding motion-9 |
| Topic editor at 1280 (8.9) | inline panel appears, the page grows 330.5 px in one frame | finding motion-9 |
| Alle: plan a card (3.6) | card flies in 360 ms, the list closes in 200 ms; the capacity dock footer appears (0 → 56.5 px) in one frame | ok, off ramp (360 ms) |
| Page loads (welcome, board, Alle, Statistik, Einstellungen, Themen, Papierkorb) | no animation, no layout shift | ok |
| Page loads of `/tasks/:id`, `/tasks/add`, a new day | the sheet morph, the draft slot and the recap stage play on load | finding motion-12 |

## Findings

### motion-1: where the page transition runs, the new page sits below the old one and jumps up by a screen
- User task: 33 move between places (map.md); a settings sub-page and back
- Where: Einstellungen → Themen and back, and every change between Statistik, Einstellungen, Papierkorb and Themen; `components/AppShell.vue:33-41` (`name: 'page'`, `mode: 'default'`), `assets/css/transitions.css:7-26`
- Evidence: `route-settings-topics@d`: the new page's header starts at y 834 and ends at y 80, in a last step of 744 px at 321 ms (the old page is 754 px tall and still in the flow while both fade). `route-settings-topics@m`: 844 px. `route-topics-back@d` 744 px, `@m` 884 px. So the "enter" half fades in below the fold and is seen only as a pop.
- Against: `DESIGN.md` "Motion" ("Motion explains a state change"); fundamental: layout stability
- Proposed change: take the leaving page out of the flow while it fades (or switch the transition to `out-in`), so the entering page fades in at its final place.
- Group: obvious fix
- Confidence: high, measured at both sizes and in both directions
- Effort: small
- Needs design round: no
- Already tracked: no

### motion-2: only 15 of 42 route pairs run the page transition; every change to or from the board is a hard cut
- User task: 33 move between places
- Where: all pairs of `/tasks`, `/all`, `/statistics`, `/settings`, `/trash`, `/settings/topics`, `/settings/updates`; `components/AppShell.vue:33-41`, `assets/css/transitions.css:7-26`
- Evidence: `c-matrix.mjs` (router pushes, watching for `.page-enter-active` / `.page-leave-active`): the transition runs between Statistik, Einstellungen, Papierkorb and Themen only. Never from or to `/tasks` and `/all`, never from or to `/settings/updates`. `route-heute-statistik@d`: 47 elements first seen in one frame at about 100 ms, the page root's opacity has one value. Heute ↔ Alle has its own 420 ms slide, so three behaviours exist for "change the place": slide, fade with a rise, cut.
- Against: inconsistent with itself; `DESIGN.md` "Motion" names no route change
- Proposed change: decide one answer for a place change that is not Heute ↔ Alle (a short fade everywhere, or none anywhere) and make the code do it on every pair. The cause of the missing pairs was not looked for.
- Group: proposal
- Confidence: high for the measurement; medium for which answer is right
- Effort: small to medium
- Needs design round: no (one decision)
- Already tracked: no

### motion-3: reduced motion is not instant in seven places
- User task: none (foundation, motion)
- Where and evidence (all `@d-reduced` recordings):
  - page transition: 200 ms opacity and a 10 px rise still run (`route-settings-topics`, `route-topics-back`, `welcome-curtain-samples`, `welcome-curtain-local`); `assets/css/transitions.css:7-26` has no reduced-motion rule (the welcome curtain at `:52-55` has one)
  - task sheet content: `task-detail-fade-in` 200 ms, the content rises 8 px in 10 steps (`card-open-sheet`); `assets/css/task-detail.css:14-26`
  - delete gap: `task-gap-picture-out` and `task-gap-answer-in` 220 ms, the card picture shrinks from 288 × 132 to 265 × 121.5 px (`card-delete-gap`); `components/task/TaskDeletedGap.vue:154-175`
  - Metadaten: `collapsible-down` 200 ms (190.5 px in 12 steps) and the caret's `rotate` 200 ms (`sheet-metadata-open`)
  - setup rail connector: `background-color` 300 ms `ease` (`welcome-notion-intro-to-token`); `components/setup/SetupRail.vue`
  - column headers: `opacity` 500 ms during a drag (`drag-open-to-waiting`, `drag-jetzt-to-done`); `components/board/BoardColumnHeader.vue:232`
  - dialog and palette scrim: `fade-in` 200 ms (`palette-open`, `disconnect-dialog-open`), add-form scrim `fade-out` 200 ms (`add-form-open`)
- Against: `DESIGN.md` "Motion": "`prefers-reduced-motion` makes it instant"
- Proposed change: one global reduced-motion rule that zeroes transition and animation durations, with the few progress indicators (spinner, the gap's 5 s drain, the nudge's countdown) named as exceptions; then delete the per-component rules it replaces.
- Group: obvious fix
- Confidence: high, each is a recorded animation under `reducedMotion: 'reduce'`. The first four move something; the last three only fade or change colour.
- Effort: small
- Needs design round: no
- Already tracked: no

### motion-4: the Notion setup on the welcome page changes the sheet's height in one frame at every step
- User task: 10 walk through a setup
- Where: welcome, Notion flow, each "Weiter"; `components/setup/NotionSetupFlow.vue:159` (the pane animation), the same code in `components/setup/RemindersSetupFlow.vue:179` (desktop only, not recorded)
- Evidence: the pane slides 14 px in 240 ms while the footer button jumps: `welcome-notion-intro-to-token@d` 114 px, `welcome-notion-token-to-db@d` 179.5 px (layout shift without input 0.0045, it follows the token check), `welcome-notion-db-to-props@d` 187.5 px and the page becomes 982.5 px tall. On a phone the sheet is bottom-anchored, so the whole sheet with the wordmark jumps: 124 px (`…intro-to-token@m`, layout shift 0.115), then 180 px (`…token-to-db@m`, 0.180 without input), then 35 px with the page growing to 957 px. The start ↔ flow change one level up eases the height in 300 ms, and the same wizard in the settings dialog keeps its size (`notion-dialog-step@d`).
- Against: `DESIGN.md` "Motion" (300 ms for "a surface changing size or position"); the user's words in #577 ("not include sudden sheet size changes")
- Proposed change: give the setup pane the same guided height change the welcome sheet already uses between start and flow, or a fixed pane height per flow.
- Group: obvious fix
- Confidence: high, measured at both sizes
- Effort: medium
- Needs design round: no
- Already tracked: #577 names the entry into the setup, not the steps inside it; best done together (feedback finding on the shared setup shell)

### motion-5: entering the Notion setup from the welcome sheet reflows the leaving block while the sheet widens
- User task: 10 walk through a setup
- Where: welcome, local flow with Notion ticked, "Weiter"; `pages/welcome.vue:46` (`transition-[max-width]`)
- Evidence: `welcome-local-to-notion@d`: the column's `max-width` runs 300 ms from 38 ms, the leave slide 140 ms from 71 ms, so the old block stretches from 448 toward 704 px while it fades; 12 layout-shift entries, sum 0.049. Under reduced motion the same change is one jump of 256 px.
- Against: the user's words in #577
- Proposed change: none beyond #577; this is its measurement.
- Group: proposal
- Confidence: high
- Effort: small
- Needs design round: no
- Already tracked: #577

### motion-6: the Mehr panel changes its content while it fades out
- User task: 33 move between places (Einstellungen, Papierkorb behind ⋯)
- Where: Mehr → Einstellungen and Mehr → Papierkorb from the board; `components/nav/MorePanel.vue` (rows that depend on the route)
- Evidence: `route-heute-settings@m`: at 230 ms the panel is at opacity 0.56 and goes from 288 × 368.5 px to 281.5 × 145.5 px, 223 px lower (it is bottom-anchored on a phone); it stays visible for three more frames (0.31, 0.16, 0.07). `route-heute-settings@d`: 350 → 170.5 px high in the same fade. `route-heute-trash@d` and `@m` the same.
- Against: fundamental: a leaving surface keeps its shape; `DESIGN.md` "Motion"
- Proposed change: freeze the panel's rows while it closes (render from the route the panel was opened on until it is gone).
- Group: obvious fix
- Confidence: high for the measurement; medium for how visible 50 ms at half opacity is
- Effort: small
- Needs design round: no
- Already tracked: no

### motion-7: "Karten stapeln" moves away from the finger on a phone, and grouping re-lays the board in one frame
- User task: 9 group or filter the board
- Where: Mehr panel, the "Karten stapeln" switch; `components/nav/MorePanel.vue:44-56`
- Evidence: `more-stack-toggle@m`: the panel grows from 368.5 to 424.5 px and, being bottom-anchored, the switch moves from y 446.5 to y 390.5 (56 px) at 66 ms, one frame after the tap. `more-stack-toggle@d`: the panel grows 48 px downward (the switch stays). Behind it the board regroups in one frame: cards move up to 864 px (912 px on a phone), while expanding and collapsing a stack is a 200 ms motion with no jump (`stack-expand@d`, `stack-collapse@d`).
- Against: fundamental: a control does not move when it is pressed; inconsistent with the stack's own motion
- Proposed change: reserve the room of the group-by chips (or grow the phone panel upward only above the switch), and decide whether turning grouping on deserves the stack motion.
- Group: proposal
- Confidence: high for the switch on a phone; medium for the regrouping (it happens behind the open panel)
- Effort: small (panel), medium (regrouping motion)
- Needs design round: no for the panel, yes for the regrouping
- Already tracked: no

### motion-8: the topic funnel pushes the whole board down 52 px in one frame
- User task: 9 group or filter the board
- Where: Heute, the funnel beside ⋯; `components/board/BoardFocusBar.vue`
- Evidence: `focus-funnel-open@d`: `.board` and 66 more elements go from y 56 to y 108 at 45 ms in one step, layout shift 0.038. `focus-pick-topic@d`: picking a topic re-lays the columns in one frame (cards move 288 px, the page shrinks 453.5 px).
- Against: `DESIGN.md` "Motion" (200 ms for "neighbours making room"); feedback-2
- Proposed change: let the chip row open as a guided height change, or place it where it pushes nothing (over the board's top margin).
- Group: proposal
- Confidence: high for the measurement
- Effort: small
- Needs design round: no
- Already tracked: no

### motion-9: five disclosures open in one frame, four others are animated
- User task: expand and collapse (the disclosure pattern of findings-baseline)
- Where and evidence:
  - no motion: "Gestern erledigt" note, 42 px, cards below jump 42 px while its caret turns in 180 ms (`yesterday-note-toggle@d`, `components/board/BoardColumnYesterdayNote.vue`); Statistik tiles, the tile goes 314.5 → 992 px wide and 391 → 629.5 px high, the next tiles move 551.5 px, layout shift 0.30 (`stats-tile-open@d`, `stats-tile-close@d`, `@m` 387.5 px); the topic editor's inline panel at 1280, the page grows 330.5 px (`topic-editor-open@d`); the new-card flow's timebox step, the card grows 132 → 154 px and the cards below jump 22 px (`newcard-title-to-timebox@d`, against "Cards are fixed-size sheets" in `DESIGN.md` "Layout"); the open task sheet when its status changes, 519.5 → 424 px (`sheet-status-change-to-waiting@d`, cause not looked for)
  - with motion: stacks (200 ms standard), Metadaten (`collapsible-down` 200 ms), the delete gap (220 ms, closing 280 ms), the add slot (200 ms emphasized)
- Against: inconsistent with each other; `DESIGN.md` "Motion" (300 ms for "a surface changing size or position"); feedback-2
- Proposed change: one motion for "a block opens in place" (duration, easing, what the neighbours do) recorded in `DESIGN.md`, applied to the five; the Statistik tile needs its own answer because it changes its column span.
- Group: proposal
- Confidence: high for the measurements; medium for the Statistik tile
- Effort: medium
- Needs design round: yes for the Statistik tile, no for the rest
- Already tracked: no (findings-baseline has the caret and affordance half of it)

### motion-10: undoing a delete snaps the cards below by 84 px; the delete itself glides them
- User task: 7 delete and undo
- Where: board, "Rückgängig" in the gap; `components/task/TaskDeletedGap.vue`, `components/task/TaskCard.vue:572` (`task--returning`, 180 ms)
- Evidence: `card-delete-gap@d`: the next card moves 84 px in 13 steps over 200 ms. `card-delete-undo@d`: it moves the 84 px back in one step at 38 ms, while the returning card fades in over 180 ms.
- Against: `DESIGN.md` "Motion" (200 ms: "neighbours making room")
- Proposed change: open the slot with the same 200 ms the gap closes with.
- Group: obvious fix
- Confidence: high
- Effort: small
- Needs design round: no
- Already tracked: no

### motion-11: dragging a card over an empty column closes its old place in one frame
- User task: 5 move a card
- Where: board, a card of Offen held over the empty Jetzt slot; `assets/css/dnd.css` (the placeholder taken out of the layout, `.claude/rules/drag-and-drop.md` "No gap behind a dragged card (#393)")
- Evidence: `drag-into-empty-jetzt-nudge@d`: at 535 ms the placeholder goes to width 0 and the card below moves 144 px in one step. In `drag-open-to-waiting@d` and `drag-reorder-open@d` the neighbours move with `translate` 200 ms emphasized.
- Against: `DESIGN.md` "States", Drag: "neighbours make room in 200 ms"
- Proposed change: keep #393's result but reach it as the usual 200 ms move.
- Group: proposal
- Confidence: medium: one recording, and only the empty-column case
- Effort: medium (dnd-kit owns the placeholder)
- Needs design round: no
- Already tracked: no

### motion-12: three things animate on page load, `DESIGN.md` says motion never does
- User task: 29 go through a key moment; 4 open a task
- Where and evidence:
  - a new day: `recap-stage-in` 1400 ms on load (`load-recap@d`, `@m`); `assets/css/recap-stage.css:16` says "also on an app start", so it is meant
  - `/tasks/:id` loaded directly: the sheet plays its 280 ms morph, layout shift 0.035 without input (`load-sheet@d`); on a phone the drawer slides up in 500 ms (`load-sheet@m`)
  - `/tasks/add` loaded directly: the draft slot opens and pushes the cards 144 px, layout shift 0.036 without input (`load-add@d`)
  - also by source only: the welcome photo fades in over 700 ms once loaded (`pages/welcome.vue:34`)
- Against: `DESIGN.md` "Motion": "never runs on page load"
- Proposed change: the recap is a decision the app already follows (feedback-3): correct the sentence in `DESIGN.md` to name the key moments. The two deep links should open at rest when the route is the first one of the session.
- Group: rule candidate (the sentence), with a small fix for the two deep links
- Confidence: high for the measurements; low for how often a deep link is loaded in the desktop app
- Effort: small
- Needs design round: no
- Already tracked: no (feedback-3 covers the durations)

### motion-13: measured motion values outside the three durations and two easings
- User task: none (foundation, motion)
- Where: the running app, by recording. Durations off 150 / 200 / 300 ms: 100 (Nuxt UI menus, see motion-14), 130 and 240 (`RecapDeck.vue:218-225`), 140 and 260 (`pages/welcome.vue:304-305`), 180 (`TaskCard.vue:572`, `TaskTimeboxNudge.vue:380-405`, the yesterday note's caret), 220 (`TaskDeletedGap.vue:144-217`), 240 (`NotionSetupFlow.vue:159`, `RemindersSetupFlow.vue:179`, the chip pop), 260 (`NewCardFlow.vue:883,912`), 280 (the sheet morph, the gap closing), 320 (page dots, the phone board), 360 (`usePlanMoves.ts:77`), 420 (app bar, place change, brand flight), 480 (done check), 500 (`BoardColumnHeader.vue:232`, the drawer), 600 and 700 (progress chip), 700, 1100, 1200, 1300, 1400 (recap, focus overlay, completion burst, welcome curtain, stage). Easings off the two tokens: `ease` (page transition, app bar colours, setup rail), `ease-in`, `ease-out`, `ease-in-out`, `linear`, `cubic-bezier(0.3,0.8,0.3,1)` (welcome, setup pane, brand flight), `cubic-bezier(0.2,0.7,0.2,1)` (app bar, place change, plan move), `cubic-bezier(0.16,1,0.3,1)` (column headers), `cubic-bezier(0.34,1.32,0.64,1)` and `cubic-bezier(0.33,1,0.68,1)` (recap deck), `cubic-bezier(0.15,0.7,0.3,1)` (burst), `cubic-bezier(0.3,0,0,1)` (focus overlay), two `linear()` springs (progress chip, done check).
- Evidence: `node agg.mjs anims` over the 217 raw files (one line per kind with the recordings it ran in). The ratchet (`scripts/lint/literal-baseline.json`) holds 51 literals in 15 files, and by its own test (`tests/config/token-literals.test.ts:207-218`) it does not count a duration or curve stored in a custom property (20 such definitions, e.g. `--nav-move: 420ms` in `app-nav.css:65`, `--place-move` in `board.css:102`, `--recap-enter-duration` in `recap-stage.css:16`, `--welcome-curtain-duration` in `transitions.css:33`, `--focus-in-duration` in `board-focus-overlay.css:48`, `--chip-duration` in `TaskProgressChip.vue:212`) nor one passed to `element.animate()` (`pages/welcome.vue:172`, `NotionSetupFlow.vue:159`, `RemindersSetupFlow.vue:179`, `usePlanMoves.ts:47,77`, `utils/brandFlight.ts:104`).
- Against: `DESIGN.md` "Motion" (the token table; "A component with its own choreography … records it in its doc block") and "Guards" ("no … stray … duration or easing")
- Proposed change: three piles. Fold the near-token values into the tokens (140 → 150, 180 and 220 → 200, 240 and 260 and 280 → 300, `ease` and `cubic-bezier(0,0,0.2,1)` → a token) where no doc block asks for the number. Name the key-moment and choreography values in `DESIGN.md` as a second, slower tier (feedback-3). Extend the ratchet to custom properties that hold a time or a curve and to `animate()` options.
- Group: guard (the ratchet's two holes), with the folding as an obvious fix
- Confidence: high for the list; which doc blocks record their values was read only for `AppNav`, `welcome.vue`, `TaskProgressChip` and `recap-stage.css` (all four do)
- Effort: medium
- Needs design round: no
- Already tracked: no (source-14 counts the keyword easings and 180 / 220 ms from the source; feedback-3 the key moments)

### motion-14: overlays from Nuxt UI move on the library's clock, not the app's
- User task: 25 ask in a dialog; menus and popovers; drawers on a phone
- Where: every menu, popover, select list and tooltip (`scale-in` / `scale-out` 100 ms `cubic-bezier(0,0,0.2,1)`: `more-open`, `card-menu-open`, `tooltip`, `sheet-status-select`); dialogs and the palette (`scale-in`, `fade-in` 200 ms, same curve: `palette-open`, `disconnect-dialog-open`); `UTabs` indicator and `USwitch` thumb (200 ms, same curve: `settings-tab-switch`, `more-stack-toggle`); toasts (`toast-slide-in-from-bottom` 200 ms); drawers (`slideFromBottom` 500 ms `cubic-bezier(0.32,0.72,0,1)`: `load-sheet@m`, `add-form-open@m`, `topic-editor-open@m`)
- Evidence: the recordings named above
- Against: `DESIGN.md` "Motion" (150 / 200 / 300 ms, two easings)
- Proposed change: either theme the overlay animations in `app.config.ts` onto the tokens (menus 150 ms, dialogs 200 ms emphasized, drawer 300 ms) or record them in `DESIGN.md` as the library's motion that the app keeps.
- Group: proposal
- Confidence: medium: the values are measured; whether the drawer should be shorter is taste, 500 ms is the library's default feel
- Effort: small to medium
- Needs design round: no
- Already tracked: no

### motion-15: the Jetzt card's progress chip replays its entrance every time Heute is reached from Alle
- User task: 33 move between places; 6 work on the Jetzt task
- Where: Alle → Heute; `components/task/TaskProgressChip.vue:205-214`
- Evidence: `route-alle-heute@d`: the chip's width runs from 24 to 264 px over 600 ms with a 240 ms delay on the spring curve (42 steps, until 900 ms), after the board has finished its 420 ms slide. Under reduced motion it is one step of 240 px.
- Against: `DESIGN.md` "Motion" ("Motion explains a state change"): nothing about the task changed
- Proposed change: play the chip's morph only when the card enters Jetzt or its time changes, not when the board page comes back into view.
- Group: proposal
- Confidence: medium: measured once at 1280; the cause (the chip arming again when the column is shown) was not looked for
- Effort: small
- Needs design round: no
- Already tracked: no

### motion-16: the command palette changes height in two frames while typing
- User task: 32 run a command
- Where: palette, typing a query with no result; `components/CommandPalette` (Nuxt UI command palette in a dialog)
- Evidence: `palette-type@d`: the panel goes from 576 × 576 px to 576 × 235.5 px in two steps at the first key.
- Against: fundamental: layout stability; feedback-2
- Proposed change: keep the palette at one height (the list area scrolls or shows its empty line inside it).
- Group: proposal
- Confidence: medium: common behaviour for palettes, measured once
- Effort: small
- Needs design round: no
- Already tracked: no

### motion-17: a guard for "nothing jumps": the per-frame box measure as a spec
- User task: none (guard for feedback-2)
- Where: `tests/e2e/helpers/layoutShift.ts` already tags elements and compares boxes before and after; it has no per-frame sampler
- Evidence: this session's recorder (`lib.mjs`) separated every finding above with two numbers per recording: the largest single-frame step of any tracked box, and the layout-shift sum without recent input. A guided motion never exceeded 131 px per frame at 1280 and came in 9 or more steps; every defect was one or two steps of 22 to 912 px. Layout shift without input was 0 everywhere except the async and load cases (0.0045 to 0.18).
- Against: `DESIGN.md` "Guards" has no entry for layout stability during a transition
- Proposed change: one helper ("no tracked box moves more than n px in a single frame unless it is on the allow-list of that step") used in the specs that already walk the flows: the welcome and setup steps, the Mehr panel, the disclosures of motion-9, undo of a delete. Run it with reduced motion off; reduced motion gets its own assertion (no animation longer than 1 ms except the named indicators), which guards motion-3.
- Group: guard
- Confidence: medium: the measure worked here; frame timing on CI (Linux, one CPU) needs a trial before it gates
- Effort: medium
- Needs design round: no
- Already tracked: no

## Reduced motion: route and step changes (step 4)

| Change | Result with reduced motion |
|---|---|
| Heute ↔ Alle | instant, 0 animations |
| Heute ↔ Statistik, → Einstellungen, → Papierkorb | instant, 0 animations (the app bar's third segment and indicator jump in one frame) |
| Einstellungen ↔ Themen (and the other pairs of motion-1) | not instant: 200 ms fade and 10 px rise, and the 744 px jump (motion-3, motion-1) |
| Welcome start ↔ local / samples / Notion | instant |
| Welcome Notion steps | pane instant; the height jump of motion-4 stays; the rail's connector fades 300 ms |
| Welcome → board | curtain instant; the board still rises 10 px in 200 ms (motion-3) |
| Recap on load, recap leave, day close | instant |
| Task sheet open and close | 1 ms; content still rises 8 px in 200 ms (motion-3) |
| Stack expand, sort, new card flow, completion | instant; no burst |

## Not recorded

| What | Reason |
|---|---|
| Papierkorb: restore, empty and its question, delete for good (7.2 to 7.4) | the setup (two deletes on the board, then the page) did not produce entries in time; not retried |
| Desktop-only pages and dialogs (1.10, 1.12, 8.10 to 8.16), the floating Now window (9.5) | need the Tauri stub or a sandboxed `tauri dev`; dialogs there use `AppDialog`, measured through the disconnect dialog |
| Phone: swipe between column pages, drag with edge hold, stacks, the task sheet opened from a card | needs real touch events through CDP; the phone drawer itself is measured through `load-sheet@m`, the phone board's 320 ms slide only read in `assets/css/board.css:170` |
| Capacity popover (2.17), date picker (4.4), Notion settings save bar (8.7) | the selectors derived from the source did not match; all three are Nuxt UI popovers or an in-place bar |
| Focus overlay dimming (2.3) | did not start within 6 s without input at 1280; on a phone a 1100 ms `background-color` transition on `html` ran on load (`load-board-focus@m`), not looked into |
| Toast leaving, error toast (2.29, 9.6) | entry recorded (200 ms); the leave was not read |
| Recap: kind switch and deck on a phone (5.4) | the next-card button is not shown at 390; the deck is measured at 1280 |

## For the merge (session 6)

- feedback-2 (unintended movement) now has measurements: motion-1, 4, 6, 7, 8, 9, 10, 11, 16, and a guard in motion-17.
- motion-13 is the rendered side of source-14 and feedback-3; motion-12 belongs with feedback-3's document correction.
- motion-4 and motion-5 belong to #577 and to the shared setup shell of findings-feedback; #580 covers the day close's entry.
- source-15, source-18, source-23, feedback-5, feedback-11 and feedback-12 are not motion and were not checked here.
