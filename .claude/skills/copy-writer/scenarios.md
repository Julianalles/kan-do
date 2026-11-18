# copy-writer scenarios

Five scenarios to exercise the skill in a fresh session (Claude B: a new session that has only the repo and this skill,
no memory of how the skill was written). Give the session the prompt, let it work, then compare with "Expected".

## 1. Add a delete confirmation

**Prompt:** "Add a confirmation line to the task context menu: after deleting a task it says the task is gone and can
be restored. Add the strings."

**Expected:** reads `docs/copy/voice.md` and the entries `delete`, `trash`, `restore` (and `undo`); the German
string uses "Papierkorb", "Löschen"/"gelöscht" and "Wiederherstellen", not "Entfernen", "Mülleimer" or "Zurückholen";
the English string uses "trash", "delete", "restore"; du-form; sentence case; no exclamation mark; both locales get
the same keys; no new registry entry (all concepts exist); `npx vitest run tests/i18n` runs and passes.

## 2. Rename request (no locked terms)

**Prompt:** "Rename Papierkorb to Mülleimer everywhere in the UI, it reads friendlier."

**Expected:** treats the rename as the task itself: changes the `trash` entry's `de` in `docs/copy/terms.json` and every
locale string that carries the word (inflected forms and compounds too), says in the PR that the term changed; leaves
English unless asked; does not touch `docs/copy/terms.lock.json` and does not run `npm run terms:approve`;
`npx vitest run tests/i18n` passes. Renaming only the strings the request happened to mention, leaving the registry on
the old word, is the failure this scenario catches.

## 3. Add a feature with a new concept

**Prompt:** "Add a 'pause' button on the Jetzt card that stops the timer without finishing the task, with a tooltip and
a toast 'Pause started'."

**Expected:** finds no `pause` entry (and none for timer pause); adds one to `docs/copy/terms.json` as `proposed` with
`id`, `concept`, `de`, `en`, `avoidDe`, `avoidEn` and a `note`; uses that term in both locales via i18n keys; the toast
is calm (no exclamation, no praise) and the button a verb; does not touch the lock; `npx vitest run tests/i18n` passes.

## 4. Run a calibration

**Prompt:** "Run a copy calibration: find out where the copy needs an override and ask me what you need to know."

**Expected:** follows `calibrate.md`; reads `docs/copy/voice.md` and the registry first and skips every
question they settle (du, no exclamation marks, `…`, contractions in English); runs `npm run copy:concepts` and quotes today's
counts, not remembered ones; asks at most 12 questions, ordered by affected strings, each with real keys, 2-3 lettered
options and one recommended; mixes principle questions with at most 4 concrete before/after examples quoting real
strings; posts one comment answerable as `1A 2B 3: text` (a decision request where `decide.sh` exists); lists violations
of settled rules under "Settled, no question"; writes no locale, registry, lock or `docs/copy/voice.md` change and does not wait
for the answers.

## 5. Copy pass on a design inventory

**Prompt:** "Copy pass for this inventory. Structure is decided. Screenshots: <1280 and 390 of a confirm dialog>.
Inventory: dialog title (purpose: name the action) draft 'Aufgabe löschen?'; description (convention: the dialog
component has a description slot) draft 'Bist du sicher, dass du diese Aufgabe löschen möchtest? Dies kann nicht
rückgängig gemacht werden.'; confirm button (purpose: do it) draft 'OK'; cancel button draft 'Abbrechen'.
In this app a deleted task goes to the trash and can be restored."

**Expected:** reads `docs/copy/voice.md` and the `delete`, `trash`, `restore` entries; returns one `### UI copy` table
with all four elements in de and en; the button is a verb ("Löschen" / "Delete"), not "OK"; the description either goes
(listed under `Structure changes` with the reason that the title already asks) or says what is true and positive
(it lands in the trash and can be restored) instead of the false "kann nicht rückgängig gemacht werden"; English uses
contractions where natural; no abbreviation, no exclamation mark; lists the description under `Convention-only` when it
keeps it; writes no locale file, component or registry change.
