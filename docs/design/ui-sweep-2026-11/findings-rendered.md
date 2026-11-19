# Findings: rendered walk

Session 4 of `plan.md`. Walked on the E2E production build served on port 3104, commit `7cb8024a`; `git diff e6786ddc --stat -- components pages layouts assets app.config.ts` is empty, so the audited code is `e6786ddc`. Sizes 1280 × 800 and 390 × 844 (touch), light, locale de.

Evidence files are in `.playwright-screenshots/ui-sweep/4/`: `<name>-d.png` is 1280, `<name>-m.png` is 390. Measurements come from the scripts in `work/` (`b1.mjs` to `b8.mjs`, logs beside them, per-screen JSON in `work/audit/`). A rendered walk sees screens, not files: where no file is named, the component was not looked up. `playwright-cli` found no Chrome, so the walk ran as node scripts on the repo's Playwright chromium.

Entries marked "confirms" or "extends" repeat a finding of sessions 1 to 3 with the rendered evidence; session 6 folds them.

This file was written by the parent session from the subagent's report, word for word (the harness refuses report files written by a subagent). The server on 3104 was restarted once during the walk; after the restart the `demo` and `notion` seeds opened the new-day recap first.

## Step 1: fundamentals

### rendered-1: the task title in its sheet is 24 px, the type table says 22 px
- User task: 4 edit a value in a label/value row
- Where: `/tasks/seed-open-1`, the title button, both sizes
- Evidence: computed `font-size: 24px`, height 44 px at 1280 and at 390 (`work/b3.log`, "Titel rest"); `4.7-metadata-d.png`
- Against: `DESIGN.md` "Type" (Headline, 22 px: "the title of a task in its sheet")
- Proposed change: give the title the Headline size token.
- Group: obvious fix
- Confidence: high, measured
- Effort: small
- Needs design round: no
- Already tracked: no (confirms the open measurement of source-23)

### rendered-2: the note text in the task sheet is 16 px at 1280
- User task: 4 edit a value in a label/value row
- Where: `/tasks/seed-open-1`, the "Notiz" value
- Evidence: computed `font-size: 16px` at both sizes (`work/b3.log`, "Notiz rest"); the value rows beside it are 14 px
- Against: `DESIGN.md` "Type" (Body: 14 px, 15 on a phone, for notes)
- Proposed change: the Body size token for the note, read and edit state.
- Group: obvious fix
- Confidence: high for the size; medium that it is not deliberate, a doc block was not read
- Effort: small
- Needs design round: no
- Already tracked: no (source-6 lists text sizes outside the table; check whether this place is in it)

### rendered-3: 23 controls are under the 44 px floor on a phone
- User task: 1 trigger an action; 2 pick one of a few; 5 type into a field
- Where, each at 390 with its measured box:
  - add sheet `/tasks/add`: timebox presets "15", "30", "60": 30 × 44, 33 × 44, 33 × 44, side by side; the title field 358 × 40
  - task sheet, title while edited: 350 × 40
  - in-card add flow, second step: "Zurück" and "Überspringen" 32 × 32, "Optionen anzeigen" 32 × 44
  - topic editor: ten colour swatches 40 × 40
  - welcome, local step: three checkboxes 16 × 16 in rows 32 px apart
  - Mehr panel group-by chip "Thema" 65 × 43; the switches 36 × 20 (Mehr, Notion "Weitere Eigenschaften")
  - app bar with four places (`/settings`, `/trash`): "Alle" 33 × 44
  - text links: "Notion › Einstellungen › …" 285 × 35 (welcome token step), "Token in Notion verwalten" 177 × 17 (`/settings/notion`)
- Evidence: `work/audit/*-m.json` field `small`; `4.13-add-error-m.png`, `2.11-add-step2-m.png`
- Against: `DESIGN.md` "Space, size and shape" ("44 px floor for every control on a phone"; fields from `--field-h`, 44 px on a phone)
- Proposed change: bring each to the floor (a hit area is enough for the swatches and the round buttons); for a switch or checkbox make the whole row the target and say so in the rule.
- Group: obvious fix (the checkbox and switch rows may already be tappable through their label: not tested)
- Confidence: high for the boxes; medium for the checkboxes and switches
- Effort: small each
- Needs design round: no
- Already tracked: no

### rendered-4: three places where content jumps without the user asking for motion
- User task: 9 group or filter the board; 4 edit a value in a label/value row
- Where:
  - Heute at 1280: opening the topic focus pushes the whole board down 52 px (column headings from y 84 to 136) and the page becomes scrollable (document height 800 to 852)
  - task sheet: a title validation error moves every row down 18 px (Status row from y 254 to 272)
  - task sheet at 1280: the "Metadaten" chevron sits beside the label when closed (x 113) and jumps to x 303 when open
- Evidence: `2.1-board-local-d.png` against `2.15-focus-open-d.png`; `4.7-metadata-d.png` against `4.5-title-error-d.png`; `work/audit/2.15-focus-open-d.json`
- Against: fundamental: layout stability; `DESIGN.md` "Motion" ("explains a state change")
- Proposed change: reserve the focus bar's row or overlay it; reserve the error line under the title; keep the chevron in one place.
- Group: obvious fix
- Confidence: high, measured
- Effort: small
- Needs design round: no
- Already tracked: no (three more places for the rule candidate feedback-2)

### rendered-5: on a fresh board the Jetzt slot and the Wartet heading are not painted
- User task: 20 add a task; 23 read a card's state
- Where: `newday-back`, "Tag neu planen", then Heute, both sizes
- Evidence: `2.5-empty-columns-d.png`, `2.5-fresh-board-hover-jetzt-d.png` (still blank with the pointer over Jetzt); opacity along the parent chain is 0 for the slot button (288 × 132 at 496,165) and for the heading, which reads "Wartet?"; both are in the accessibility tree
- Against: `DESIGN.md` "Layout" ("The Jetzt slot is always one card tall, filled or empty"); fundamental: a control in the accessibility tree that cannot be seen
- Proposed change: paint the slot on the fresh board, or take both out of the accessibility tree while hidden and record the state in `DESIGN.md`.
- Group: proposal
- Confidence: medium: measured, but it may be a deliberate empty-board state; the component's doc block would say
- Effort: small
- Needs design round: no
- Already tracked: no

### rendered-6: three duration formats and a percent without its space
- User task: 28 look through tasks of the past; 27 read a chart
- Where: Statistik table "Alle erledigten Aufgaben": "1h 10min", "45min", "117%", "89%"; Statistik outliers: "3 h geplant, 4 h 4 min gebraucht"; card chips and the Jetzt bar: "1:30 h"; Statistik ring "70:46 h" beside "70 h 46 min insgesamt"; everywhere else "47 %"
- Evidence: `6.3-row-hover-d.png`, `6.2-tile1-open-d.png`, `3.1-all-demo-d.png`
- Against: `docs/copy/voice.md` "Numbers" (German `2,1 %` with a space), "One term per concept"
- Proposed change: one duration formatter for prose ("1 h 10 min") and one compact form for chips, and the table through the same percent formatter as the tiles.
- Group: obvious fix
- Confidence: high
- Effort: small
- Needs design round: no (which compact form: one decision)
- Already tracked: no

### rendered-7: the trash page's main heading is smaller and plainer than the group heading under it
- User task: 24 head a page or a section
- Where: `/trash`, filled and empty
- Evidence: `h2` "Gelöschte Aufgaben" 16 px Figtree 400 at y 87, `h3` "Heute" 22 px Fraunces 500 at y 188 (`work/b5.log`, 7.2); `7.4-remove-confirm-d.png`
- Against: `DESIGN.md` "Head a section" (no hand-written heading classes); fundamental: hierarchy
- Proposed change: `SectionHeader` for both, the page-level one not below the group-level one.
- Group: obvious fix
- Confidence: high
- Effort: small
- Needs design round: no
- Already tracked: no (map user task 24 and source-4 name the raw `h2`; this is the rendered effect)

### rendered-8: left edges that miss each other by 8 to 40 px
- User task: 10 walk through a setup; 6 change a setting
- Where and measure:
  - welcome Notion flow at 1280: step content starts at x 536 on "Vorbereitung" and at x 552 on every later step
  - the same flow at 390: back button and progress at x 24, the field and its help text at x 40
  - Notion setup dialog (`/settings`, connect Notion): title and footer at x 280, body at x 320
  - `/settings/notion`: link "Token in Notion verwalten" at x 431, button "Datenbank ändern" icon at x 443
  - `/settings` tabs: first label at x 320, the lead text and the sheet at x 304
  - task sheet at 1280: label "Notiz" at y 261, the first row's label "Status" at y 271
- Evidence: `1.5-notion-intro-d.png`, `1.6-token-failed-d.png`, `1.6-token-empty-m.png`, `8.5-notion-dialog-1-d.png`, `8.7-notion-tab0-d.png`, `8.1-settings-board-d.png`, `4.7-metadata-d.png`
- Against: fundamental: alignment to a shared edge
- Proposed change: one content edge per shell; fix each place.
- Group: obvious fix
- Confidence: high for the numbers; medium for the tabs (a padded tab label is common)
- Effort: small
- Needs design round: no
- Already tracked: no (the Notion flow places sit beside #562; more places for feedback-15)

### rendered-9: the Notion settings tabs are cut off at 390
- User task: 31 switch a view in a page
- Where: `/settings/notion` at 390
- Evidence: `8.7-notion-configured-m.png`: the third tab reads "Weitere F" at the screen edge, the fourth is not visible; no sign that the row scrolls
- Against: fundamental: clipped content
- Proposed change: let the row scroll with a visible cue, or drop the icons at 390 so four labels fit.
- Group: obvious fix
- Confidence: medium: the clipping is seen, whether a swipe scrolls the row was not tried
- Effort: small
- Needs design round: no
- Already tracked: no

## Step 2: states in the running app

### rendered-10: five pressable elements do not answer hover
- User task: 1 trigger an action; 18 open and close a part
- Where (1280, computed style of the element and its first twelve descendants identical at rest and under the pointer, cursor is the hand):
  - task sheet: the title and the note (`InlineEditable`)
  - task sheet: the "Metadaten" toggle
  - Statistik: the `<summary>` line "Alle erledigten Aufgaben"
  - topic editor: the colour swatches (`SwatchRadioGroup`)
- Evidence: `work/b8.log` lines "HOVER … NO CHANGE"; for comparison the same check reports a change for the Offen add button, the ⋯ pill, the card, `ListRow`, the tile heading, the sheet's selects and the dotted values
- Against: `DESIGN.md` "States", Hover
- Proposed change: the dotted rule or the row tint for the two editable texts, the ghost fill for the two toggles, a ring step for the swatch.
- Group: obvious fix
- Confidence: high for the four listed; a pseudo-element answer would not show in this check and was looked for by eye only on the title and note
- Effort: small
- Needs design round: no
- Already tracked: no (the answer to feedback-11, whose guard would have caught these)

### rendered-11: a row of the statistics table shows no hover
- User task: 7 show a list row
- Where: `/statistics`, "Alle erledigten Aufgaben" open, pointer on the second row
- Evidence: `6.3-row-hover-d.png`: no tint on any row
- Against: `DESIGN.md` "Show a list row"
- Proposed change: as source-15.
- Group: obvious fix
- Confidence: high
- Effort: small
- Needs design round: no
- Already tracked: no (confirms source-15)

### rendered-12: a failing source is red on the app bar and orange in its row
- User task: 15 tell the user something
- Where: `notion` seed with every Notion route answering 401, after "Jetzt synchronisieren"
- Evidence: `8.3-source-attention-d.png`: the dot on ⋯ is raspberry, the row's "Verbindung prüfen" is orange
- Against: `DESIGN.md` "Colour" (orange: "a connection that needs a look"; raspberry: "destructive and failed, nothing else"), "The Status Is Not Decoration Rule"
- Proposed change: one colour for the state in both places.
- Group: obvious fix (which of the two: one decision)
- Confidence: high that they differ
- Effort: small
- Needs design round: no
- Already tracked: no

### rendered-13: two solid green controls show at once in three states
- User task: 1 trigger an action; 12 undo
- Where: the undo toast's "Rückgängig" is solid green and stays while the ad-hoc add sheet shows its solid "Starten"; with a topic focus on, the funnel is a solid green circle beside whatever main button the view has; in the Mehr panel the switch and the chosen group-by chip are solid green
- Evidence: `2.4-jetzt-empty-d.png`, `2.15-focus-picked-d.png`, `work/b6.log` ("solid: Rückgängig | Starten"), `work/b7.log` (2.14-mehr-stack-on)
- Against: `DESIGN.md` "The One Lamp Rule" ("selected options … are green without being a fill") against "States" ("Selected: a fill")
- Proposed change: decide what a selected control and a toast action may look like, then align the two sentences of `DESIGN.md`; the app follows whichever is chosen.
- Group: proposal
- Confidence: medium: the rule text disagrees with itself, so no side is the defect
- Effort: small (text) to medium
- Needs design round: no
- Already tracked: no

### rendered-14: the sort control of a column shows only while the pointer is in the column
- User task: 9 group, sort or filter the board
- Where: Heute at 1280; at 390 it is always shown (130 × 48 under the heading)
- Evidence: `2.1-board-local-d.png` (absent) against `2.6-card-context-d.png` (shown); it is in the Tab order while not painted (`work/b7.log`, "TAB ORDER board")
- Against: fundamental: a control the keyboard reaches should be visible at least on focus
- Proposed change: show it on focus-within as well, or always in the quiet tone.
- Group: proposal
- Confidence: medium: whether it appears on keyboard focus was not screenshotted
- Effort: small
- Needs design round: no
- Already tracked: no (#579 is about the shake this hover causes)

## Step 3: same user task, side by side

### rendered-15: the buttons at the foot of a dialog or flow have five layouts
- User task: 13 ask in a dialog; 10 walk through a setup
- Where (1280):
  - add sheet: "Abbrechen" at the left edge, the main button at the right edge
  - Notion setup dialog: "Abbrechen" left, "Zurück" and "Weiter" together on the right
  - topic editor, trash confirmations: both together, right or left of the text
  - disconnect dialog: three full-width buttons stacked, the main one on top, "Abbrechen" last
  - welcome local and samples steps: one full-width main button; welcome Notion steps: one 96 px button at the right
- Evidence: `4.13-add-filled-d.png`, `8.5-notion-dialog-1-d.png`, `8.9-topic-editor-d.png`, `8.4-disconnect-d.png`, `1.3-local-ticked-d.png`, `1.5-notion-intro-d.png`
- Against: `DESIGN.md` "Trigger an action" ("Dialog footers: neutral cancel first, main action last"); inconsistent with each other
- Proposed change: one footer per surface kind (dialog, side sheet, flow step) and a line for the stacked case.
- Group: proposal
- Confidence: high that they differ
- Effort: medium
- Needs design round: yes
- Already tracked: no

### rendered-16: day close and recap are siblings with different footers, and on a phone the button order is reversed
- User task: 29 go through a key moment
- Where: `dayclose` and `newday-back`, both sizes
- Evidence: `5.1-dayclose-d.png`, `5.7-recap-back-d.png`, `5.1-dayclose-m.png`, `5.7-recap-back-m.png`. Day close: the way out is a soft button, the main button has no icon, at 390 the way out is on top and the main button below. Recap: the way out is a ghost button, the main button carries an arrow and the focus ring at rest, at 390 the main button is on top. Title at y 97 against 201, content width 512 against 704.
- Against: inconsistent with each other; `DESIGN.md` has no line for a stage
- Proposed change: one stage shell: title position, width, footer sheet, the look of the way out and the stacking order at 390.
- Group: proposal
- Confidence: high
- Effort: medium
- Needs design round: yes
- Already tracked: no (#580 is the entry transition)

### rendered-17: the setup step has three progress forms, two heading forms and two button widths
- User task: 10 walk through a setup
- Where: welcome local and samples steps (Display heading 36 px, full-width main button, sheet 512 wide); welcome Notion flow (no painted step heading, the rail's label is the title and the step's explanation sits under the rail, sheet 768 wide, main button 96 px); the Reminders setup inside `/settings/reminders` (rail and a 36 px heading); the Notion setup dialog (horizontal stepper in green with numbers, five steps where the welcome flow has six); at 390 the welcome flow shows a bar with "2 / 6" and the dialog squeezes the stepper so labels break as "Daten-bank" and "Eigen-schaften"
- Evidence: `1.3-local-ticked-d.png`, `1.5-notion-intro-d.png`, `tauri/settings-reminders-desktop.png`, `8.5-notion-dialog-1-d.png`, `8.5-notion-dialog-1-m.png`, `1.6-token-empty-m.png`. The main button also moves between steps of the Notion flow (y 629, 515, 695) because the sheet takes its height from the content.
- Against: inconsistent with each other
- Proposed change: one step shell, as feedback-7 proposes; this entry is its rendered evidence.
- Group: proposal
- Confidence: high
- Effort: large
- Needs design round: yes
- Already tracked: partly #562, #577, #575 (extends feedback-7 and source-21)

### rendered-18: the back button says "Zurück" on five steps
- User task: 30 step back
- Where: welcome local step, and the Notion flow from the token step on (four steps); the samples step and the Notion intro say "Zurück zur Auswahl"
- Evidence: `1.3-local-ticked-d.png`, `1.6-token-failed-d.png`; `work/b4.log` (button widths 94 against 174)
- Against: `DESIGN.md` "Step back" (the label names where it leads)
- Proposed change: name the target on every step.
- Group: obvious fix
- Confidence: high
- Effort: small
- Needs design round: no
- Already tracked: no (extends feedback-9, which names the local step only)

### rendered-19: the unconnected Reminders settings page runs the setup under a settings title, with two back buttons
- User task: 10 walk through a setup; 30 step back
- Where: `/settings/reminders` under the Tauri stub, not connected
- Evidence: `tauri/settings-reminders-desktop.png`: "Zurück zu Einstellungen" above the title and "Zurück zur Auswahl" inside the sheet, where no choice precedes it; the subtitle says "Hier änderst du jederzeit, was du beim Einrichten gewählt hast." before anything was set up; the last paragraph is cut mid-line by the inner scroll area
- Against: `DESIGN.md` "Step back"; `docs/copy/voice.md` (say what the user can do)
- Proposed change: no inner back button on the first step here, and a subtitle for the unconnected state.
- Group: obvious fix
- Confidence: high for what is seen; only the first step was rendered
- Effort: small
- Needs design round: no
- Already tracked: the cut text and the space are #575; the two back buttons and the subtitle: no

### rendered-20: Einstellungen and its sub-pages differ in sheet headings, tab form and column width
- User task: 6 change a setting; 31 switch a view in a page
- Where: `/settings` tabs "Board" and "System": the sheet has no heading; tab "Aufgabenspeicher" and every sub-page: Fraunces headings. Tabs: `/settings` 16 px labels in 44 px, `/settings/topics` 14 px in 32 px, `/settings/notion` a vertical list with icons at 1280. Column: 672 px on topics, data, GitHub and Reminders, 992 px on Notion (back button at x 136 against 296). Rows of "Eine App verbinden": 56 px with a button, 44 px without.
- Evidence: `8.1-settings-board-d.png`, `8.1-settings-manage-d.png`, `8.1-settings-sources-d.png`, `8.9-topic-editor-d.png`, `8.7-notion-tab0-d.png`; `work/b5.log` (sub-page geometry)
- Against: `DESIGN.md` "Layout" ("a heading names each sheet"); inconsistent with each other
- Proposed change: a heading for the two bare sheets; one tab size for sibling pages or a recorded reason per page; decide whether Notion keeps its wide column.
- Group: proposal (the two missing headings alone are an obvious fix)
- Confidence: high
- Effort: medium
- Needs design round: no
- Already tracked: no (the `xl` tabs of `/settings` have a recorded reason, #333)

### rendered-21: saving a token looks different on its two pages
- User task: 25 enter a token; 26 save or discard a section
- Where: `/settings/github`: a soft "Speichern" beside the field, link "Token auf GitHub erstellen" underlined in ink with an icon. `/settings/notion`: a solid "Speichern" at the foot of the sheet, disabled at rest on every tab, link "Token in Notion verwalten →" in green with a typed arrow.
- Evidence: `tauri/settings-github-desktop.png`, `8.7-notion-tab0-d.png`
- Against: inconsistent with each other (map user tasks 25 and 26 have no Pattern)
- Proposed change: one token row and one external-link look.
- Group: proposal
- Confidence: high that they differ
- Effort: medium
- Needs design round: no
- Already tracked: no (the link looks are source-9)

### rendered-22: day close and Statistik show the same two facts in different words, ink and legend
- User task: 27 read a chart
- Where: day close "Timebox": "deutlich unter / etwa in / deutlich über der Timebox", dots grey, green, black. Statistik "Wo schätze ich falsch?": "Länger als geplant / Wie geplant / Kürzer als geplant", black, grey, light grey, the reverse order. Day close "Themen": a bar with ink dots, counted in tasks. Statistik "Wofür nehme ich mir Zeit?": a ring with ink dot plus topic mark, counted in time.
- Evidence: `5.1-dayclose-d.png`, `6.1-stats-demo-d.png`
- Against: `DESIGN.md` "Charts" (no status colour) for the green dot; `docs/copy/voice.md` "One term per concept" for the wording
- Proposed change: the same three terms in the same order and ink in both places; the topic mark in both legends or in neither.
- Group: proposal (the green dot alone is the obvious fix source-19)
- Confidence: high
- Effort: small
- Needs design round: no
- Already tracked: no

### rendered-23: on a board with one source the cards under "Meine Aufgaben" show a source icon, the cards under "Heute" do not
- User task: 23 read a card's state
- Where: `/all`, seed `demo&backlog=1`, both sizes
- Evidence: `3.1-all-demo-d.png`: a monitor icon leads the footer of every card in the left column, none in the right
- Against: `DESIGN.md` "The task card" (the source icon "when the card names its source"); inconsistent within one screen
- Proposed change: one rule for when a card names its source, applied to both columns.
- Group: proposal
- Confidence: medium: the reason may be recorded for the not-planned item
- Effort: small
- Needs design round: no
- Already tracked: no

### rendered-24: "Alle" scrolls two ways and its phone heading drops out of the type table
- User task: 28 look through tasks; 24 head a page or a section
- Where: `/all` at 1280: "Meine Aufgaben" is its own scroll area (639 px high, content 744) while the "Heute" column grows the page (document 1285 px). At 390 the heading "Meine Aufgaben" is 27 px, every other column heading 36 px.
- Evidence: `3.1-all-demo-d.png`, `3.1-all-demo-m.png`; `work/b6.log` ("all scrollers")
- Against: `DESIGN.md` "Type" (Display 36 px; no 27 px step); fundamental: one scroll model per page
- Proposed change: one scroll model for both columns; a shorter heading or a recorded fit rule at 390.
- Group: proposal
- Confidence: high for the numbers
- Effort: medium
- Needs design round: yes
- Already tracked: #573 touches the same page's bottom space; these two points: no

### rendered-25: the fixed "Fokus" pill lies over the list on a phone
- User task: 9 group or filter the board
- Where: Heute at 390 with a topic picked
- Evidence: `2.15-focus-picked-m.png`; `position: fixed` at 0,720, 390 × 48, above the app bar
- Against: as feedback-5
- Proposed change: as feedback-5.
- Group: proposal
- Confidence: high that it is fixed over the list; with two cards in the list nothing was covered in the shot
- Effort: medium
- Needs design round: yes
- Already tracked: no (confirms feedback-5)

## Step 4: emphasis against context

### rendered-26: the first-run step offers its apps as small round checkboxes that read as radio buttons
- User task: 2 pick one of a few; 3 switch something on or off
- Where: welcome, local step
- Evidence: `1.3-local-ticked-d.png`: 16 px circles (`border-radius: 8px`) under "Du kannst eine oder mehrere verbinden", two of three disabled, in the app's most spacious step; the same apps are a list with icons and buttons in Einstellungen, in another order (Notion, Todoist, Erinnerungen against Erinnerungen, Notion, Todoist)
- Against: emphasis; inconsistent with `/settings?tab=sources`
- Proposed change: the choice card or the settings rows for this step, the available app first.
- Group: proposal
- Confidence: medium
- Effort: medium
- Needs design round: yes
- Already tracked: no (map user task 2 names the missing choice card)

### rendered-27: the setup's fact chips look pressable
- User task: 34 show a status, a count or a small fact
- Where: welcome Notion intro and database step, the Notion dialog ("Notion-Konto", "Titel", "Fälligkeit" …)
- Evidence: `1.5-notion-intro-d.png`, `8.5-notion-dialog-1-d.png`: outlined pills with an icon, the shape of a chip one can pick; they do nothing
- Against: `DESIGN.md` "Show a status or count" (a neutral badge); "Pick one of a few" owns the chip shape
- Proposed change: the neutral badge, or a plain list with icons.
- Group: proposal
- Confidence: medium
- Effort: small
- Needs design round: no
- Already tracked: no (map user task 34; source-17 lists pill shapes)

### rendered-28: the card's context menu draws seven hairlines for eleven entries
- User task: 17 open a menu of actions
- Where: Heute, right-click a card in Offen
- Evidence: `2.6-card-context-d.png`: "Details öffnen", "Als ungeplant markieren", "Status ändern", "Priorität ändern" and "Timebox setzen" are each a group of one. "Nicht heute" and "Als ungeplant markieren" sit two lines apart and read alike.
- Against: emphasis: a divider per entry groups nothing; `docs/copy/voice.md` "One term per concept" for the pair
- Proposed change: three groups (act now, change a value, copy and delete); reword one of the pair so the difference is in the label.
- Group: proposal
- Confidence: medium
- Effort: small
- Needs design round: no
- Already tracked: no (#374 is the concept behind the pair)

### rendered-29: Statistik: an empty tile, a misplaced expand button and a hole when a tile opens
- User task: 27 read a chart; 18 open and close a part
- Where: `/statistics`, seed `demo`, 1280
- Evidence: `6.1-stats-demo-d.png`: "Wie entwickle ich mich?" is 390 px high with content to about 200 px; in "Wann arbeite ich?" the expand button's centre is 10 px below the heading's (741 against 731), in the three tiles above they share a line. `6.2-tile1-open-d.png`: the opened tile moves to the top at full width and the two left behind leave the third cell empty. With the table open the page is 11 289 px long (144 rows).
- Against: fundamentals: alignment, spacing rhythm
- Proposed change: align the button; let the remaining tiles fill the row; page or cap the table.
- Group: proposal (the 10 px are an obvious fix)
- Confidence: high for the measures
- Effort: small to medium
- Needs design round: no
- Already tracked: no

### rendered-30: the add sheet shows three field looks in one form
- User task: 5 type into a field; 21 set a timebox
- Where: `/tasks/add`, both sizes
- Evidence: `4.13-add-filled-d.png`: filled selects without a border, a number on a dotted rule with three dotted numbers under it, an outlined textarea; the title has no field look and starts 12 px right of the labels. The offered timeboxes are 15, 30, 60 here and 15, 30, "eigene Dauer" in the nudge on the Jetzt card (`2.8-nudge-d.png`).
- Against: `DESIGN.md` "Edit a value in a label/value row" names two looks; the textarea is a third
- Proposed change: the note in the sheet's own language; one list of offered timeboxes.
- Group: proposal
- Confidence: medium
- Effort: medium
- Needs design round: yes
- Already tracked: no (map user task 21)

### rendered-31: the funnel stays in the app bar on the two stages, and "Fokus" names two features
- User task: 9 group or filter the board; 33 move between places
- Where: day close and recap, both sizes; the funnel's accessible name is "Fokus", the setting on `/settings` is "Jetzt-Karte im Fokus"
- Evidence: `5.1-dayclose-d.png`, `5.7-recap-back-d.png`; `work/b2.log`
- Against: emphasis (a board filter on a screen with no board); `docs/copy/voice.md` "One term per concept"
- Proposed change: hide the funnel while a stage is open; a second word for one of the two features.
- Group: proposal
- Confidence: medium
- Effort: small
- Needs design round: no
- Already tracked: no (#478 is the term registry)

## Step 5: copy

### rendered-32: spelling and name forms on the welcome page
- User task: 10 walk through a setup
- Where: "Todoist (Bald verfübar)" (typo, and a capital the neighbour "(nur in der Mac-App)" does not have; Einstellungen writes "bald verfügbar"); "Das Kanban Board mit dem du deine Aufgaben …" (hyphen and comma missing); the product name in running text as "kan-do" (local and samples steps), "Kan-do" (Notion intro) and "Kan-Do" (database step)
- Evidence: `1.3-local-ticked-d.png`, `1.5-notion-intro-d.png`, `1.6-token-failed-d.png`; `work/b4.log`
- Against: `docs/copy/voice.md` "Names and full stops" ("Kan-Do" in running text; compounds take a hyphen)
- Proposed change: fix the four strings.
- Group: obvious fix
- Confidence: high
- Effort: small
- Needs design round: no
- Already tracked: no (the typo is feedback-14)

### rendered-33: text that repeats its neighbour, and one page with three names
- User task: 15 tell the user something; 24 head a page or a section
- Where:
  - `/settings?tab=sources`: the tab's lead and the sheet's first paragraph both say where new tasks are saved by default
  - `/settings/data` (Tauri stub): "Noch keine Sicherung" and, 40 px below, "Noch keine Sicherungen. Die erste entsteht vor der nächsten Änderung."
  - `/settings/notion`: tab "Datenbank", heading "Datenbank", line "Token und Datenbank-Auswahl", field "Datenbank"; the subtitle "Einstellungen für deine Notion-Integration" under the title "Notion-Einstellungen"
  - `/settings?tab=manage`: row "Import/Export und App-Reset" with the line "Export und Import"; the page it opens is titled "Daten & Speicher" and its sheet "Daten exportieren / importieren"
- Evidence: `8.1-settings-sources-d.png`, `tauri/settings-data-desktop.png`, `8.7-notion-tab0-d.png`, `8.1-settings-manage-d.png`
- Against: `docs/copy/voice.md` "One term per concept"; the rule candidate feedback-1
- Proposed change: drop the second statement in each place; one name for the data page, used by its link.
- Group: obvious fix
- Confidence: high
- Effort: small
- Needs design round: no
- Already tracked: no (four more places for feedback-1)

### rendered-34: the metadata line separates facts with bullets and shows the task's id
- User task: 4 edit a value in a label/value row
- Where: task sheet, "Metadaten" open: "Lokal • Erstellt: 19.11.2026, 16:26 • seed-open-1"
- Evidence: `4.7-metadata-d.png`, `4.7-metadata-m.png`
- Against: `docs/copy/voice.md` "No middle dots" ("not as a decorative separator element … give each fact its own element"); the guard looks for `·` only
- Proposed change: one element per fact; decide whether the id belongs there.
- Group: obvious fix
- Confidence: medium: the character is a bullet, not the middle dot the rule names
- Effort: small
- Needs design round: no
- Already tracked: no

## Guards

### rendered-35: a phone hit-area check over the walked screens
- User task: none (guard)
- Where: the 23 controls of rendered-3 passed every existing check
- Evidence: `tests/config/button-ladder.test.ts` reads classes; nothing measures a rendered box at 390
- Against: `DESIGN.md` "Guards" (the phone floor is listed as guaranteed)
- Proposed change: one spec that walks the seeded screens at 390 and asserts 44 × 44 for every visible control or its pseudo-element hit area, with a named exception list; the measuring code is `audit()` in `work/lib.mjs`.
- Group: guard
- Confidence: high
- Effort: small
- Needs design round: no
- Already tracked: no

### rendered-36: a formatter guard for durations and percent, and the contrast check for the day close
- User task: none (guard)
- Where: rendered-6; feedback-12
- Evidence: the day-close title measures 10.9:1 and the date 6.8:1 at 1280 (11.0 and 7.2 at 390), the recap 10.2 and 6.7 (`work/b7.log`, "CONTRAST"): the contrast holds, only the check is missing
- Against: `DESIGN.md` "The Bright Ground Rule" (checked, not assumed)
- Proposed change: the two `expectContrast` lines of feedback-12; a unit test that no component formats minutes or percent outside the shared formatter.
- Group: guard
- Confidence: high
- Effort: small
- Needs design round: no
- Already tracked: no

## Waiting checks of sessions 2 and 3

| Finding | Result |
|---|---|
| source-15 | confirmed: rendered-11 |
| source-18 | not compared: only the welcome checkbox rendered (neutral, round, `border-radius: 8px` at 16 px). The add form showed no checkbox on a local, mixed or Notion board, and the Notion stub task had no custom checkbox field |
| source-23 | confirmed: rendered-1 (24 px at both sizes) |
| feedback-2 | three new places: rendered-4 |
| feedback-5 | confirmed: rendered-25 |
| feedback-11 | answered: rendered-10 |
| feedback-12 | contrast measured and fine: rendered-36 |

## Observations not raised to findings

- A wrong token in the welcome Notion flow showed "Die Notion-Einrichtung ist nicht mehr gültig. Richte sie neu ein." on a first setup. The 401 was mocked in the browser, so the real server's answer may map to another text; a run against the stub token `fail=401` would confirm it.
- `/settings/notion` shows "db-123" in the field "Datenbank": the id, not the name. The stub may have no name.
- At 390 the day-close footer sheet's lower edge runs under the app bar at rest (the stage scrolls 26 px); the main button itself ends 10 px above the bar.
- The undo region's toast and the board's Tab order were checked and are in order: the bar comes first, then the columns left to right.

## Not reachable

| # | Reason |
|---|---|
| 1.10, 1.12 | Tauri stub with clicks; only the first Reminders step was rendered, through `/settings/reminders` |
| 2.7 | drag and swap: not walked (session 5 records drags) |
| 2.17 | no capacity divider on the `demo` board on the walk's day (`capacity-divider` count 0) |
| 2.22 | the state of `BoardColumnNotice` was not found |
| 2.25, 2.29 | the stub options for an empty sync and a failing write were not set up; the failing sync (2.24) was reached by answering 401 in the browser |
| 2.27 | no Feedback row in the Mehr panel on the web: Tauri only |
| 3.4 | capacity echo: not walked, #573 is open on it |
| 4.4 | no date row in the sheet of a local or Notion stub task |
| 4.9 | the Notion stub task showed no custom fields |
| 4.10 | seen on the `local` seed's stale card instead of `dayclose` |
| 6.5 | loading state: not throttled |
| 8.10, 8.11 | `/settings/updates` redirects to `/tasks` on the web; not in `desktop-pages-shots.spec.ts` |
| 8.12 to 8.16 | rendered at rest only (`tauri/*.png`); the states behind a click need a spec with `installTauriStub` |
| 9.5 | `/overlay` redirects to `/tasks` in a browser |
| 9.7 | tooltips: only the Offen add button was hovered; the plan arrows did not render on the walk's second day because the `demo` seed opened the recap |

## Corrections for `routes.md`

- 5.7 and 2.21: the recap's buttons are "Tag neu planen" and "Überspringen und Board anzeigen", not "Direkt zum Board".
- 5.1: the stage is reached at 390 through Mehr, "Tag abschließen"; the stage shows the summary and the two charts, no not-done cards with triage.
- 8.6 (web): `/settings/github` and `/settings/updates` redirect to `/tasks`, `/settings/reminders` to `/settings?tab=sources`.
- 8.1: the tabs are `?tab=board|sources|manage`, named "Board", "Aufgabenspeicher", "System".
- 2.14: on the `local` seed the Mehr panel has no group-by chips until "Karten stapeln" is on.
- 2.28: the phone pages move by a real touch swipe only (`showColumnPage`); setting a scroll position does nothing.
- Seeds `demo` and `notion` open the new-day recap first when the seeded day is not today; skip it before walking the board.
