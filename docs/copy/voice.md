# Voice and wording

The wording rules of the Kan-Do UI. The registry `docs/copy/terms.json` is the vocabulary (one preferred German and English form per concept); the `copy-writer` skill applies both, and the live copy editor hands the list under "Rules" (only that list) to its translation agent (`server/copy-editor/translate.ts`). No term is locked right now (owner decision 2026-11-18, fast-changing phase): the registry has no avoid forms and no `decided` entries until a later issue locks the few terms that must not change without approval.

Voice: relatable, encouraging and inclusive, said calmly. Write for one person, in short plain sentences, and tell them what they can do.

## Rules

- **One term per concept.** Same thing, same word: every concept has one term in `docs/copy/terms.json` (German and English). Reuse it; a concept that is not there is added in the same change.
- **Address.** Speak to the user directly: German "du" / "dein", never "Sie"; English "you" / "your".
- **Short sentences.** One thought per sentence, at most 15 to 20 words.
- **Active and positive.** Prefer the active voice and the user as subject when the sentence is about them ("Du erhältst eine Benachrichtigung, sobald …", not "Du wirst benachrichtigt, sobald …"). Look for "nicht", "kein", "can't", "don't", "not" and flip them where the meaning holds.
- **Plain words.** No abbreviations ("evtl.", "ggf.", "z. B.", "bzw.", "usw.", "e.g.", "etc."): write "etwa" / "such as" or rephrase. No technical compounds ("Bevorzugter Speicherort", not "Speicherortpräferenz"). A technical word only where the user handles exactly that thing: a Notion setup step is titled "Notion verbinden", its input may say "Gib hier dein Notion-Token ein"; a short info hint can explain the term.
- **Löschen, Entfernen, Trennen.** "Löschen" when data goes away (a task, a stored token, a draft), "Entfernen" when a value or an element is taken away without deleting data (a timebox, a screenshot), "Trennen" for ending an integration connection.
- **Tone.** Calm, like a well-made notebook (PRODUCT.md personality: natural, helpful, assistive). Quiet confirmation (principle 4): state what happened ("Im Papierkorb"), no exclamation marks, no praise. Warmth goes into guidance: hints, empty states and errors encourage the next step, they never celebrate. The one exception (owner, #295): the faster-than-planned line on the done confirmation, "Sehr gut! Schneller als geplant.".
- **No emoji** in UI chrome: buttons, labels, alerts, badges, toasts.
- **Case.** Sentence case for labels, titles and buttons ("Tag abschließen", "Close the day"); proper names and the four column names keep their capital letters. No ALL CAPS.
- **Buttons are verbs.** The label names what happens: "Speichern", "Löschen", "Trennen", not "OK" or "Ja". A dismiss is "Abbrechen" or "Schließen".
- **Errors say what happened and what to do next.** "Notion ist gerade nicht erreichbar. Versuche es später erneut." A validation message says what to enter, not what is wrong ("Gib eine Zahl zwischen 0 und 50 ein", not "Ungültige Eingabe"). Never a raw technical detail, status code or exception text (PRODUCT.md principle 5: if a user sees one, the design has failed).
- **Failure sentences.** A full sentence about something that was tried reads "… konnte nicht … werden" / "… couldn't be …"; a short status label next to a source or row keeps "fehlgeschlagen" / "failed"; "kann nicht" / "can't" only states a rule ("can't be negative").
- **No "Bitte".** Errors and hints use a plain imperative ("Versuche es erneut.", "Try again."), no "Bitte" / "Please".
- **Technical detail.** Only the Data settings page shows a detail, in one form: "<What happened>. Details: {error}" (the folder or file system is what the user must fix there). This is the single exception to the raw-detail rule above.
- **Empty states.** "Noch keine X." (plus how it fills, where there is something to do) when the thing appears with use; "Keine X gefunden." only for a search or filter result; never "… verfügbar".
- **Progress.** German is passive with the object first ("Datenbanken werden geladen…", "Wird geprüft…"), English the present participle ("Loading databases…"); no space before `…`.
- **Numbers.** German `1.000`, `2,1 %` (no-break space before `%`); English `1,000`, `2.1%`, `€7,000` (currency sign before the number, no space).
- **Durations.** Prose and tables: `1 h 10 min` (`formatDuration(…, 'spaced')`); chips, the Jetzt bar and rings: `1:30 h` (`clockShort`). Percent in component source only through `formatPercent` (a percent inside a locale string is written by hand as `{share} %`, not scanned); a component never builds either by hand (`tests/config/duration-percent-format.test.ts`).
- **Task state.** A task is "erledigt" / "done"; "Fertig" / "Done" only labels a button that closes a dialog; "abschließen" only for the day or a setup.
- **Settings, token, time.** "Einstellungen" for the place and what can be changed, "einrichten" for the first guided setup, no "Konfiguration"; "Token" is the secret and "Zugriff" what it permits; "Aufgewendete Zeit" / "Time spent" (the running timer on a card keeps "Bisher gearbeitet").
- **English.** American spelling (color, canceled, gray, realize); contractions by default (you'll, it's, don't).
- **Voice.** The app has no speaker: no "wir" / "we"; passive, or "the app" as subject.
- **Names and full stops.** "Kan-Do" in running text (the lowercase `kan-do` is only the wordmark in the app bar, `nav.brand`); German compounds with a brand name take a hyphen ("Notion-Datenbank"). A description or hint that is a sentence ends with a full stop; a noun phrase or list does not.
- **Characters.** One ellipsis character `…` (not three dots) for loading and truncated actions. Quotes are „…“ in de and “…” in en. `{named}` placeholders only, never string concatenation of translated fragments.
- **No middle dots.** The middle dot `·` is never used in UI copy: not as a separator between facts ("Synchronisiert · vor 2 Min."), not in a caption, tooltip or aria text, not as a decorative separator element in a template, and not in images made for users (README screenshots and their captions). Write a sentence, use a comma, or give each fact its own element (owner rule, 2026-11-16).
- **Plurals.** vue-i18n pipe syntax, one branch per form (`{n} Aufgabe | {n} Aufgaben`); a literal pipe is written `{'|'}`. Never "(s)" or "Aufgabe(n)".
- **Statistik verdicts.** A verdict is a plain sentence relative to the user's own last 4 weeks ("Es läuft besser als sonst"), never an absolute target, never red, never praise; a harder week is stated plainly (#469).

## Guards

What a check guarantees. The rules above say when a term or form is right; these checks only catch the mechanical part.

| Guaranteed | By |
|---|---|
| The registry is valid; once terms are locked again, no form to avoid appears in a locale and a `decided` term is unchanged since the user approved it (no avoid forms and an empty lock right now) | `docs/copy/terms.json` and its lock, checked by `tests/i18n/terminology.test.ts` (`npm run i18n:check`) |
| No abbreviation from "Plain words" and no emoji in a locale value; `%` has a space in German and none in English | `tests/i18n/copy-mechanics.test.ts` |
| No uppercase class in components or pages | `tests/config/design-patterns.test.ts` |
| Every key is in `de.json` and `en.json` with the same placeholders and the same number of plural branches | `npm run i18n:check` |
| No hardcoded string in a template | ESLint `no-raw-text` |
| No middle dot `·` in a locale value or in the literals and template text of components, pages, layouts, composables, lib and `app.vue` (comments and doc blocks excluded) | `tests/config/no-middle-dots.test.ts` |
