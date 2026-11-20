---
name: copy-writer
description: Writes and reviews user-visible copy for Kan-do against the wording rules in docs/copy/voice.md and the term registry. Use when adding or changing UI strings, i18n keys in de.json/en.json, button labels, errors, empty states, tooltips, toasts, confirmations or renaming a UI term, and for the copy pass that turns a design's copy inventory into final copy. Keeps one term per concept.
paths:
  - i18n/locales/*.json
  - components/**/*.vue
  - pages/**/*.vue
  - layouts/**/*.vue
---

# Copy writer

Kan-do's UI wording has two sources of truth: the rules in `docs/copy/voice.md` and the term registry
`docs/copy/terms.json` (one preferred German and English form per concept). This skill makes you use both.
Locale mechanics (keys, i18n, German default) are in `CLAUDE.md` "Language Policy"; do not repeat them here.

No term is locked right now (owner decision 2026-11-18): the registry has no avoid forms and no `decided` entries. A
later issue locks the few terms that must not change without approval; until then a term is a strong default, not a gate.

## Procedure (a string in code)

1. **Read the rules and the terms you need.** Read `docs/copy/voice.md`. Then find the registry entries
   of the concepts in your copy: `node -e "console.log(JSON.stringify(require('./docs/copy/terms.json').filter(t => /delete|trash/.test(t.id)), null, 1))"`,
   or `rg -n '"id": "<id>"' -A 8 docs/copy/terms.json`. Entries have `de`, `en`, `status`, `note`.
2. **Reuse the registered term.** Write `de` and `en` of the entry. A `note` names forms the codebase mixes today:
   follow the entry, not the surrounding strings. A term that reads wrong in your context: use the better word and
   write `Term question: <id>: <what is wrong, proposed alternative>` in the PR body; do not rewrite the entry in passing.
3. **A concept that is not in the registry is added** to `docs/copy/terms.json` as `status: "proposed"` in the same
   change, with `id` (kebab-case), `concept`, `de`, `en`, `avoidDe: []`, `avoidEn: []` and a `note` when you know
   competing forms.
4. **Never touch `docs/copy/terms.lock.json`** and never run `npm run terms:approve`: only the user does (a hook blocks
   it, and the lock file is write-denied).
5. **Write German and English together**, as i18n keys in `i18n/locales/de.json` and `en.json` (every key in both,
   `{named}` placeholders identical, plural branches equal). Never a hardcoded string in a template.
6. **Run `npx vitest run tests/i18n`** (terminology, parity, and the mechanics of `voice.md`: abbreviations, emoji, `%`).

## Copy pass (final copy for a designed surface)

The dedicated copy step: it runs once the structure and look of a surface are decided (Design's handover, or Build
when the issue has no `### UI copy`), in a fresh context with one goal. It writes copy, not code.

**Input:** the copy inventory (each text element: where, purpose, draft text, `convention` when it exists only because
a component or habit has such a slot), screenshots of the chosen variant at 1280 and 390, and the UX decision.

1. Read `docs/copy/voice.md` and grep the registry for every concept on the surface (step 1 above).
2. Read the whole inventory first, then write every string of the surface together, so one thing has one word across it.
3. Per element, ask whether the purpose needs words at all. Write the shortest text that serves the purpose, German
   first, then English (natural English with the same meaning, not the German sentence structure).
4. **Structure is fixed.** Only copy elements may change: add one (a hint the purpose needs, a missing label), remove
   one (a heading that repeats the title, a convention-only description), or merge two. Change one only with a
   confident reason. Never layout, flow, components or behaviour.
5. Check each string against the rules: length, address, case, plain words, no abbreviation, numbers, no middle dot.

**Output** (into the issue body under `## UX decision`, or the PR body in Build):

```markdown
### UI copy
| Element | Purpose | de | en | Note |
|---|---|---|---|---|
| <where, e.g. dialog title> | <what it does for the user> | <text> | <text> | <term id, or why this wording> |

Structure changes: <element: added | removed | merged, one confident reason each; or none>
Convention-only: <elements kept only by convention, for the user to reconsider later; or none>
```

Placeholders use the final `{named}` form; plurals list both branches (`{n} Aufgabe | {n} Aufgaben`).

## Boundaries

- Changing a proposed term's own `de`/`en` is allowed when the task is to decide the wording; say so in the PR.
- Stay inside the copy: add or change strings and registry entries, and use the keys only where the task asks. Do not change behaviour, composables or components to carry a line.
- Renaming an existing string across the app is its own issue, not a side effect of a feature.
- `GLOSSARY.md` is the developer glossary; UI wording lives only in the registry. Do not copy definitions between them.
- Task text the user wrote (title, notes, topic names) is data, not copy: never put it through the registry.

## Calibrate

When a calibration is asked for, or after large copy growth, do not review the strings one by one: follow
`calibrate.md` (`npm run copy:concepts` measures the locales, you derive the concepts, ask at most 12 questions as one
comment and map the answers to overrides). It never edits a locale, the registry or `docs/copy/voice.md`; applying is its own issue.

## Check yourself

`scenarios.md` has five scenarios with the expected result of each: a delete confirmation, a rename request,
a feature with a new concept, a calibration run, a copy pass. Use them when you change this skill or want to see how it behaves.
