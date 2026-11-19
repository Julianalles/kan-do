# Routes and states to walk

Session 1 of `plan.md`, audited commit `e6786ddc`. Every route in scope and every state worth a screenshot, with the seed and the clicks that reach it. Sessions 4 and 5 walk this list at 1280 × 800 and 390 × 844, light only.

How to read it:

- **Seed**: open `<base>/tasks?seed=<mode>` first (the plugin writes the state, drops the query and reloads), then go to the route. A detail URL without the seed step loses the seed. Modes and options: `.claude/rules/e2e.md` "Seed modes", `plugins/e2e-seed.client.ts`. Every seed turns the Fokus overlay off; `&focus=1` keeps it on.
- The seed plugin runs in dev and in the E2E production build (`npm run test:e2e` / `scripts/e2e-server.mjs`), not in a plain production build. `notion` and `mixed` need the Notion stub (`npm run dev:e2e`, or the E2E server, which has it on).
- **Clicks** were derived from the source, not walked. A row whose clicks do not lead there is corrected in this file by the session that finds it, or listed at the end as not reachable with the reason.
- Desktop-only pages render through the Tauri stub: `DESKTOP_SHOTS_DIR=<dir> PORT=<free port> npm run test:e2e -- tests/e2e/desktop-pages-shots.spec.ts` (skill `desktop-verify`, step 1). States behind a click on those pages need a spec with `installTauriStub` (`.claude/rules/desktop.md`).
- Screenshots go to `.playwright-screenshots/ui-sweep/<session>/` in the main checkout, never into git.

Excluded by the plan: `/ui`, `/error-test`, `components/prototype/`.

## 1. Welcome and setup (`/welcome`)

| # | State | Seed | Clicks |
|---|---|---|---|
| 1.1 | Welcome, first choice | `clear` | `/tasks` redirects to `/welcome` |
| 1.2 | Local flow, step 2 (services offered, nothing ticked) | `clear` | the local choice |
| 1.3 | Local flow, Notion and Reminders ticked | `clear` | 1.2, tick both |
| 1.4 | Samples flow | `clear` | the "Mit Beispielaufgaben" choice |
| 1.5 | Notion flow: intro pane | `clear` (stub server) | 1.3, connect Notion |
| 1.6 | Notion flow: token step (empty, checking, failed, accepted) | `clear` (stub) | 1.5, next; token `notion_test_stub` |
| 1.7 | Notion flow: database step (loading, list, empty) | `clear` (stub) | 1.6, next |
| 1.8 | Notion flow: mapping steps (properties, status, priority, custom properties) | `clear` (stub) | 1.7, next through each |
| 1.9 | Notion flow: done | `clear` (stub) | 1.8, finish |
| 1.10 | Reminders flow: access step, list choices, today rules, connect failed | `clear`, Tauri stub | desktop only; the local flow's Reminders choice |
| 1.11 | Each flow: the step back (`BackButton`) and the sideways slide | | from any step (session 5 records it) |
| 1.12 | Data notice on welcome (`DataStorageNotice`) | Tauri stub | desktop only |

## 2. Heute (`/tasks`)

| # | State | Seed | Clicks |
|---|---|---|---|
| 2.1 | Board, filled, four columns | `local` | none |
| 2.2 | Board, realistic content, stacks, topics with marks | `demo` | none |
| 2.3 | Board with the Fokus overlay on | `local&focus=1` | none |
| 2.4 | Jetzt empty (the slot) and Jetzt filled (timer running) | `local` | drag the Jetzt card out, then one in |
| 2.5 | A column with no card | `newday-back` | recap: "Tag neu planen", then Heute (the seed notes say Offen shows a sentence) |
| 2.6 | Card: hover, focus-visible, pressed, context menu open | `local` | hover, Tab, right-click (long-press at 390) |
| 2.7 | Card being dragged; a drop on a full Jetzt (swap) with its undo toast | `local` | drag with `page.mouse` (an external script, `.claude/rules/e2e.md` "Drag simulation") |
| 2.8 | Timebox nudge on the Jetzt card (chips, custom value) | `local` | move a card without a timebox into Jetzt |
| 2.9 | Completion: burst, confirmation layer, undo toast | `local` | drag the Jetzt card to Erledigt |
| 2.10 | Delete from the board: the gap with its undo | `local` | context menu, Löschen |
| 2.11 | In-card add (the new-card flow): title, timebox step, the option list behind the dots, more options, saving | `local` | the add button in the Offen header |
| 2.12 | Ad-hoc add in Jetzt | `local` with Jetzt empty | the Jetzt slot |
| 2.13 | Stack: collapsed, hover, expanded with its header, closing | `demo` | Mehr, a group-by chip, then click a stack |
| 2.14 | Mehr panel (popover at 1280, its phone form at 390): chips, switches, rows, shortcut hints | `local` | the ⋯ pill |
| 2.15 | Topic focus: the funnel, the chip row, a topic picked | `demo` | the funnel beside ⋯ |
| 2.16 | Column sort menu | `local` | the sort control in a column header |
| 2.17 | Capacity divider in Offen and its popover | `demo` | scroll Offen; click the label |
| 2.18 | "Gestern erledigt" note: collapsed, open, acknowledged | `demo` | the note in Erledigt |
| 2.19 | Carry-over: dots on a card, the triage block on the card | `dayclose` | the stale Offen cards |
| 2.20 | New-day notice on the board | `newday-notice` | none |
| 2.21 | Notice for a timer that ran overnight (`NewDayTimeNote`) | `newday-back` | recap: "Direkt zum Board" (to confirm; else via its spec's seed) |
| 2.22 | Column notice strip (`BoardColumnNotice`) | to find | its spec under `tests/e2e/` names the state |
| 2.23 | Mixed board: source icons on cards | `mixed` (stub) | none |
| 2.24 | Notion board, a source that needs attention: the problem dot on ⋯, the repair entry | `notion` (stub) | make the stub fail (see `.claude/rules/e2e.md` "Notion stub") |
| 2.25 | Sync warning dialog (choice cards, the folded causes) | `notion` (stub) | a sync that returns nothing (stub option) |
| 2.26 | Command palette: open, typed, no result | `local` | Cmd/Ctrl+K |
| 2.27 | Feedback dialog: form, annotate, sent; the element picker bar | `local` | Mehr, Feedback |
| 2.28 | Phone: each column page, the page dots, the bar at the bottom, the swipe | `local` at 390 | swipe or the dots |
| 2.29 | Error toast | `notion` (stub) | a failing write |

## 3. Alle (`/all`)

| # | State | Seed | Clicks |
|---|---|---|---|
| 3.1 | "Meine Aufgaben" filled, groups, the plan arrows | `demo&backlog=1` | the place Alle |
| 3.2 | Nothing unplanned (empty note; open issue #581) | `local` | Alle |
| 3.3 | "Gestern auf dem Board" panel after a fresh start | `newday-back` | recap: "Tag neu planen", Alle |
| 3.4 | Capacity echo and its dock (open issue #573) | `demo&backlog=1` | Alle, scroll |
| 3.5 | In-card add under "Meine Aufgaben" | `demo&backlog=1` | the add button |
| 3.6 | A card planned for today (the arrow, the move, the toast) | `demo&backlog=1` | a plan arrow |

## 4. Task sheet (`/tasks/:id`, `/tasks/add`, `/statistics/:id`)

| # | State | Seed | Clicks |
|---|---|---|---|
| 4.1 | Detail, desktop morph sheet; phone drawer | `local` | click a card, or `goto /tasks/seed-open-1` after seeding |
| 4.2 | Each value row at rest, hover, focus, editing: status, priority, topic, activity, timebox, time spent, dates | `local` | click each value |
| 4.3 | Topic picker: list, search, create, edit mode in its footer, the topic editor | `demo` | the Thema value |
| 4.4 | Date picker popover | `local` | a date value |
| 4.5 | Title editing, required error | `local` | clear the title |
| 4.6 | Notes: read, edit, with Markdown and a link | `demo` | the notes |
| 4.7 | Metadaten open | `local` | the Metadaten trigger |
| 4.8 | Actions: open in source, move to source, delete and its confirm | `mixed` (stub) | the last line of the sheet |
| 4.9 | Custom fields (Notion properties), read-only and editable | `notion` (stub) | a Notion card |
| 4.10 | Carry-over triage inside the sheet | `dayclose` | a stale card |
| 4.11 | A done task's sheet (done day row) | `local` | a card in Erledigt |
| 4.12 | Task not found | `local` | `goto /tasks/does-not-exist` |
| 4.13 | Add form: side sheet at 1280, drawer at 390; the draft card filling; "Speichern in" on a mixed board; a field error | `local`, `mixed` | `/tasks/add` or the add entry of the palette |
| 4.14 | The same sheet from Statistik | `demo` | `/statistics`, a row of the table or an outlier |

## 5. Day close and new-day recap (stages on `/tasks`)

| # | State | Seed | Clicks |
|---|---|---|---|
| 5.1 | Day close: summary, Timebox chart, Themen chart, the not-done cards with triage | `dayclose` | "Tag abschließen" (app bar or under Erledigt) |
| 5.2 | Day close, everything done (the trophy headline) | `dayclose&alldone=1` | the same |
| 5.3 | Day close: copy the summary, leave | `dayclose` | the footer |
| 5.4 | Recap: both decks, the kind switch, a card swiped | `newday` | opens by itself |
| 5.5 | Recap, nothing open | `newday-all` | opens by itself |
| 5.6 | Recap, several days ago ("am Montag" copy) | `newday&daysago=3` | opens by itself |
| 5.7 | Recap: "Tag neu planen" and "Direkt zum Board"; the third bar segment "Rückblick" | `newday-back` | each button |

## 6. Statistik (`/statistics`)

| # | State | Seed | Clicks |
|---|---|---|---|
| 6.1 | Filled: verdict, three tiles closed, the table fold | `demo` | the place Statistik |
| 6.2 | Each tile open; the topic / activity option in the time tile | `demo` | each tile's heading |
| 6.3 | "Alle erledigten Aufgaben" open: the table, sorted, a row hovered | `demo` | the `<details>` line |
| 6.4 | Little or no data (verdict, tiles, empty notes) | `local`, and `newday-notice` (no done tasks) | none |
| 6.5 | Loading (the verdict's spinner) | `demo` | throttle, reload |
| 6.6 | Phone: tiles in one column, the table scrolling | `demo` at 390 | none |

## 7. Papierkorb (`/trash`)

| # | State | Seed | Clicks |
|---|---|---|---|
| 7.1 | Empty | `local` | Mehr, Papierkorb |
| 7.2 | Filled: entries as cards with their side column | `local` | delete two cards on the board first |
| 7.3 | "Papierkorb leeren": the question in the note, confirm, cancel (Esc) | `local` | the button in the note |
| 7.4 | One entry: restore, delete for good and its confirm | `local` | the entry's actions |

## 8. Einstellungen (`/settings` and sub-pages)

| # | State | Seed | Clicks |
|---|---|---|---|
| 8.1 | `/settings`: each tab of the page, the switches, the working-day select | `local` | Mehr, Einstellungen |
| 8.2 | Verbindungen: a connected source row, its menu, "Standard" badge, further sources offered | `mixed` (stub) | the sources tab (`/settings/sources` leads to the same page) |
| 8.3 | A source that needs attention | `notion` (stub, failing) | the same |
| 8.4 | Disconnect dialog | `mixed` (stub) | the row menu, Trennen |
| 8.5 | Notion setup dialog (the wizard in `AppDialog`): each step | `local` (stub) | connect Notion from the sources list |
| 8.6 | `/settings/notion`, not set up | `local` | direct |
| 8.7 | `/settings/notion`, configured: each tab, a section changed (save / cancel shown), saving, failed | `notion` (stub) | edit a field |
| 8.8 | `/settings/topics`: Themen and Aktivitäten, filled, empty | `demo`, `local` | each tab |
| 8.9 | Topic editor: inline panel at 1280, drawer at 390; swatches, the symbol grid, the merge note, the gate hint | `demo` | a topic row |
| 8.10 | `/settings/updates` on the web and with the Tauri stub: checking, up to date, update found, failed | `local`; Tauri stub | the check button |
| 8.11 | Update dialog; "What's new" dialog (with and without highlights) | Tauri stub | their specs name the trigger (`updates.spec.ts`) |
| 8.12 | `/settings/data`: storage notice, backups (none, some, "show all"), conflict copies, export / import, reset and its in-place question | Tauri stub | `desktop-pages-shots.spec.ts`; clicks through `data-settings.spec.ts` |
| 8.13 | Restore dialog (with preview), conflict dialog, folder change dialog | Tauri stub | `data-settings.spec.ts` |
| 8.14 | `/settings/github`: token row empty, checking, saved, failed | Tauri stub | `github-settings.spec.ts` |
| 8.15 | `/settings/reminders`: connected, list choices, today rules, disconnect | Tauri stub | its spec |
| 8.16 | Local storage details in Verbindungen | Tauri stub | the Lokal row |
| 8.17 | Every sub-page: the back button, the page head, the column width against the app bar | any | each sub-page |

## 9. Chrome and the rest

| # | State | Seed | Clicks |
|---|---|---|---|
| 9.1 | App bar: each place selected, the third segment on a page behind ⋯, the wordmark | `local` | each place and `/trash`, `/settings` |
| 9.2 | App bar on a phone | `local` at 390 | the same |
| 9.3 | Route change between places (session 5) | `demo` | Alle, Heute, Statistik |
| 9.4 | `/` (redirect only) | `local`, `clear` | direct |
| 9.5 | Floating Now window (`/overlay`): running, paused, over time | Tauri (sandboxed `tauri dev`) | desktop only; in a browser the route may render without its window chrome: try direct after `local`, else list as not reachable |
| 9.6 | Toasts: undo, news, error, with an action | `local` | 2.7, 2.9, 2.29 |
| 9.7 | Tooltips on icon-only buttons | `local` | hover the card menu, the column header buttons, the plan arrows |
| 9.8 | Reduced motion for 9.3 and every step change of section 1 (session 5) | | `reducedMotion: 'reduce'` in the context |

## Not reachable (filled in by sessions 4 and 5)

| # | Reason |
|---|---|
| | |
