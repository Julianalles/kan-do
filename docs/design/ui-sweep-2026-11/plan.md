# UI consistency sweep 2026-11: plan and progress

A read-only sweep of the built UI after the redesign lock-in (2026-11-12). It ends in one overview of proposed changes that the user ticks. Nothing in the app changes and no issue is filed before that.

This file is the single source for every session that works on the sweep. A session starts with a fresh context, reads this file, does the next open session of the tracker, writes its output files, updates the tracker and the handover notes, commits and pushes to `main` (docs only).

## Goal

A more polished, consistent and coherent UI, with as little input from the user as possible before the overview exists.

**Result:** `overview.md` in this folder, with every item in one of these groups:

1. **Obvious fixes**: a named rule of `DESIGN.md` is broken or a defect is measured (a layout shift, a missing state, a contrast value). No design choice is open. Grouped by class with a count and the places.
2. **Proposals**: a change that involves a choice. Each has a confidence (high, medium, low), an effort (small, medium, large) and says whether it needs a design round first.
3. **Rule candidates**: corrections the user gave more than once, worded as a rule to adopt or decline. Never written into `DESIGN.md` by the sweep.
4. **Guards**: a lint rule or ratchet test per class of obvious fix, so it cannot come back.
5. **Already tracked**: findings an open issue already covers, with the issue number.

**Not part of the sweep:** fixing anything, filing issues, a new visual direction, dark mode, `pages/ui.vue`, `pages/error-test.vue`, `components/prototype/`.

## Terms

- **Job** (job to be done): one of the six solution-free jobs in `PRODUCT.md` "Jobs to be done" (Plan the day … Learn from previous work). Only the user changes that list.
- **User task**: one concrete thing the user does in the app on the way to a job, in story-mapping terms (pick one of a few options, confirm a destructive action, walk through a setup). Always written "user task", never "task" alone: a Task is the app's domain object.
- **Pattern** (`GLOSSARY.md`): the recurring UI solution to one user task.
- **User-task map**: Job or supporting activity → user task → Pattern → the elements that do it today (app components, Nuxt UI components used directly, raw markup in pages).

Setup, settings, data safety and feedback serve no job directly (`PRODUCT.md`: infrastructure is no job). The map lists them under "Supporting activities".

`GLOSSARY.md` and `.claude/rules/ui-patterns.md` still say "user job" for what is a user task here. Session 1 aligns the wording (user decision 2026-11-19).

## What already exists (do not redo)

Three audits ran in the two weeks before this sweep. The sweep is a delta to them.

| Document | Covers | Leaves open |
|---|---|---|
| `docs/design/audit-2026-11.md` (2026-11-06) | inventory, code solidity, rendered review of the main screens | written before the redesign |
| `docs/design/ui-kit-audit.md` (2026-11-09) | every component, raw buttons, "One job, several implementations", hard-coded values, dead code | components only, no screens or flows |
| `docs/design/redesign-gap-audit.md` (2026-11-13) | foundations as used, variants, a hover/active/focus matrix on `/ui` | states set by script or by a parent, anything that moves, flows |

Also in place: the Pattern check, the manifest (`npm run ui:manifest`, `npm run ui:find`), `/ui`, the Impeccable source and rendered scans, axe, the ratchets in `tests/config/`.

New in this sweep: the user's own feedback as a source, screens and flows compared with each other, motion, emphasis against context, states in the running app, and a status check of the earlier findings after the redesign.

## Decisions

User, 2026-11-19:

- The result is one overview, split into obvious fixes and proposals with a confidence.
- User tasks are named as such and kept apart from the six jobs.
- Work runs in sessions with a fresh context each; subagents are allowed.

Agent calls (the user can overrule any of them):

- The whole app in one run, not area by area, so findings that span areas show up.
- A blind test checks the method: `blind-test.md` holds findings the user already knows. No pass reads it. Session 6 checks whether the passes found them unprompted.
- Scope: every route except the excluded ones, light only, 1280 × 800 and 390 × 844.
- `DESIGN.md` is the law. Where the app and `DESIGN.md` disagree, that is a proposal, not an obvious fix in either direction.
- A rule "pages hold no raw elements or own styling" is proposed as two ratchets (raw elements per page, and `<style>` blocks plus inline styles per component, counts may only fall), not as a ban. The sweep delivers the counts and the proposal; the user decides.
- Screenshots and recordings are never committed. They go to `.playwright-screenshots/ui-sweep/<session>/` in the main checkout (ignored by git); findings name the file.

## Finding format

One file per pass, `findings-<pass>.md`. One entry per finding; the same defect in many places is one entry with a list of places.

```
### <pass>-<n>: <one-line statement of what is wrong>
- User task: <from map.md>
- Where: <route and state>, <file:line> (every place)
- Evidence: <screenshot or recording file, measurement, or the quoted rule / user comment with its link>
- Against: <DESIGN.md heading, a fundamental (name it), or "inconsistent with <other place>">
- Proposed change: <one or two sentences, no spec>
- Group: obvious fix | proposal | rule candidate | guard
- Confidence: high | medium | low, with one clause why
- Effort: small | medium | large
- Needs design round: yes | no
- Already tracked: #<issue> | no
```

Rules for every pass:

- Only what was seen or measured. A guess is marked low confidence and says what would confirm it.
- Check each finding against the open issues (`gh issue list --state open --search "<keywords>"`) and against the three earlier audits before writing it.
- No fixes, no issue filing, no edits outside this folder (session 1's wording change is the one exception).

## Sessions

Sessions 2 to 5 are independent of each other and may run in parallel as subagents of one session. Each subagent gets the path of this file and its session number, nothing else, and returns a summary of at most ten lines; the detail is in its findings file. A session that runs out of room stops, records where it is in the handover notes and leaves the rest to the next one.

**When you run as a subagent** (sessions 2 to 5 in parallel): write only your own findings file in this folder and nothing else in the repository; do not edit this file, do not commit, do not push, do not spawn further agents. The parent session updates the tracker and commits. Your summary (at most ten lines) says: done or where you stopped, the number of findings per group, the three most valuable ones in a line each, and anything the next session must know. Rendered sessions use their own port: session 4 serves on `3104`, session 5 on `3105`; stop only your own server by its port's PID. Screenshots and scripts go under `.playwright-screenshots/ui-sweep/<session>/`.

### Session 1: baseline and user-task map

1. Record the audited commit (`git rev-parse --short HEAD`) in the tracker. Later sessions audit that commit or note the difference.
2. Align the wording: "user job" → "user task" in `GLOSSARY.md` ("Pattern") and `.claude/rules/ui-patterns.md`; add the entries "Job" and "User task" to `GLOSSARY.md` as in "Terms".
3. `baseline.md`: every finding of the three earlier audits with its status on the audited commit (done, open with issue, open without issue, no longer applies). Open ones without an issue go into `findings-baseline.md`.
4. `map.md`: the user-task map. Start from `npm run -s ui:manifest 2>/dev/null` (description, usage, avoid, usedBy per component) and `ui-kit-audit.md` "One job, several implementations". Add what the manifest cannot see: raw markup in `pages/**`, Nuxt UI components used directly in pages and feature components, elements mounted by `<component :is>`. Per user task: the Pattern `DESIGN.md` names (or "none named"), every element that does it, where each is used, and one of: settled, convergence candidate (say why), gap (no shared element).
5. `routes.md`: every route and every state worth a screenshot (empty, filled, loading, error, each overlay, each step of a flow), with the seed and the clicks that reach it. Sessions 4 and 5 walk this list. Seeds: `.claude/rules/e2e.md` "Seed modes"; desktop-only pages: skill `desktop-verify`.

Done when: the three files exist, the wording is aligned, `npx vitest run tests/config` passes.

### Session 2: the user's feedback

Source: the user's own words in issues and PRs. Read every issue (open and closed) with the label `polish`, `consistency`, `ux-impact`, `needs-design`, `rule-candidate` or `agent-decided`, and the user's comments on prototype and design rounds (`gh issue list --state all --limit 400 --json number,title,labels,author`, then `gh issue view <n> --comments`; PR review comments likewise). The user is the repo owner; agent-written text is not a source.

1. Extract every correction: what the user wanted different and the reason given, with the link.
2. Group them. A correction given twice or more in different places is a **rule candidate**: word it as a rule, list the occurrences, and check whether `DESIGN.md` already has it (then the finding is "rule exists, was broken n times": a guard candidate).
3. For each correction, check in the code whether the app as a whole now follows it or only the place the issue named. Places that do not are findings.

Output: `findings-feedback.md`. Done when: every listed label is read through and each rule candidate has its occurrences.

### Session 3: source scan

A delta to `ui-kit-audit.md`, on the audited commit.

1. Every `<style>` block in `components/`, `pages/`, `layouts/`: what it does and whether a rule of `.claude/rules/` or `DESIGN.md` justifies it (drag and drop, teleported content, keyframes) or a token, an `app.config.ts` variant or a kit component would do.
2. Every inline `style` and `:style`, every arbitrary Tailwind value, every call-site `:ui` or `class` override that changes the look of a kit or Nuxt UI component.
3. Raw elements per page and per feature component that do a user task a kit component exists for (use `map.md`).
4. Each named rule of `DESIGN.md` ("Foundations", "Components", "Behaviour", "Guards"): one grep or read per rule for places that break it.
5. The counts for the two proposed ratchets (raw elements per page; `<style>` blocks and inline styles per component), and for each class of obvious fix the cheapest guard (an existing ESLint rule's option, a `tests/config` ratchet).

Output: `findings-source.md`. Done when: all five steps have a section, even if it says "none found".

### Session 4: rendered walk

Serve the app on a free port (never `:3000`; `.claude/rules/e2e.md` "E2E server"), drive it with the `playwright-cli` skill, walk `routes.md` at both sizes.

1. **Fundamentals** per screen: alignment to a shared edge, spacing rhythm, type ramp and hierarchy, one primary action, line length, hit areas at 390, content that jumps or clips, truncation.
2. **States in the running app**: for every kind of interactive element, hover, focus-visible, active, disabled, selected and loading, including states set by script or by a parent (the gap audit left those out). A missing or inconsistent state is a finding.
3. **Same user task, side by side**: for every convergence candidate and gap of `map.md`, screenshot each element that does the user task and compare structure, size, spacing and copy form. Compare whole screens too: every flow of the same kind (setups, settings sub-pages, stages, dialogs) against its siblings for shell, header, step navigation and button placement.
4. **Emphasis against context**: where an element is correct by the rules but too heavy or too light for its place (a dense list control on a spacious first-run step, a loud element in a quiet list). These are proposals, never obvious fixes, and need a design round.
5. **Copy**: text that repeats what a neighbour already says, against `docs/copy/voice.md`. Light pass.

Output: `findings-rendered.md`. Done when: every row of `routes.md` is walked at both sizes or listed as not reachable with the reason.

### Session 5: motion

Against a production build (`.claude/rules/e2e.md` "E2E server"), since the dev server adds its own jank.

1. List every transition: route changes, each step change of a flow, overlays opening and closing, cards entering, leaving and moving, expanding and collapsing.
2. Record each one (Playwright video or trace) and measure layout shift while it runs (a `PerformanceObserver` for `layout-shift`, and the bounding boxes of the main blocks sampled per frame). A block that changes size or position outside the intended motion is a finding.
3. Check each against `DESIGN.md` "Motion": duration, easing, what is allowed to move.
4. Repeat the route and step changes with reduced motion.

Output: `findings-motion.md`. Done when: every transition of step 1 has a verdict.

### Session 6: blind test and overview

1. Read `blind-test.md` now, not before. For each entry: was it found by a pass, without help? Record the result in the tracker. A miss means the method has a hole: name the pass and what it should have looked at, rerun that part once, and note the change here under "Handover notes".
2. Merge the findings files: one item per defect, places merged, duplicates and already-tracked ones folded.
3. Write `overview.md` with the five groups of "Goal". Items are numbered 1, 2, 3 … across the file and worded for the user in plain language (no finding ids in the text; the id is a trailing reference). Proposals are ordered by confidence, then by how visible the place is in the daily flow. Each item: what and where, why, the proposed change, effort, and a checkbox.
4. Open with a summary of at most ten lines: counts per group, the three most valuable items, the blind-test result.
5. Stop. The user ticks items or answers in chat.

### Session 7: after the user's answer (not before)

Screen the ticked items together, batch them by surface (items on the same surface share an issue and a PR), file the issues into the right lane and add the guards. Adopted rule candidates go through skill `design-rule`.

## Tracker

| # | Session | Status | Date | Output | Notes |
|---|---|---|---|---|---|
| 1 | Baseline and user-task map | done | 2026-11-19 | `baseline.md`, `map.md`, `routes.md`, `findings-baseline.md` | audited commit: `e6786ddc`; 8 findings (baseline-1 to baseline-8) |
| 2 | The user's feedback | running | 2026-11-19 | `findings-feedback.md` | subagent of the session that did session 1 |
| 3 | Source scan | running | 2026-11-19 | `findings-source.md` | subagent of the session that did session 1 |
| 4 | Rendered walk | running | 2026-11-19 | `findings-rendered.md` | subagent of the session that did session 1 |
| 5 | Motion | running | 2026-11-19 | `findings-motion.md` | subagent of the session that did session 1 |
| 6 | Blind test and overview | open | | `overview.md` | blind test: |
| 7 | Issues and guards | waits for the user | | | |

Status values: open, running, done, blocked (say on what).

## Handover notes

Newest first. At most five lines per session: what the next session must know that the output files do not say.

- 2026-11-19, session 1 done. Audit `e6786ddc`: later commits of this sweep are docs only, so `git diff e6786ddc --stat -- components pages layouts assets app.config.ts` must stay empty; if it is not, note the difference in your findings file.
- Issue numbers: the tracker restarted when the repo moved. Older documents write `kd#n` for today's tracker and plain `#n` for the old one, and code comments mix both, so check a number with `gh issue view <n>` before you call something tracked. Open on 2026-11-19: #588, #587, #581, #580, #579, #577, #575, #573, #562, #554, #478, #374.
- `map.md` part B numbers the user tasks 1 to 34; part C lists the convergence candidates and the two gaps that session 4 step 3 compares. `routes.md` was derived from the source, not walked: correct a row whose clicks do not lead there and fill its "Not reachable" table.
- The seed plugin runs in dev and in the E2E production build only (`scripts/e2e-server.mjs`); sessions 4 and 5 run on different free ports, never `:3000`, and stop only their own server by its port's PID.
- "user job" is still written in `DESIGN.md`, `CLAUDE.md`, `CONTRIBUTING.md` and `.claude/issue-workflow.md` (finding baseline-8); the plan allowed session 1 to change `GLOSSARY.md` and `.claude/rules/ui-patterns.md` only.
- 2026-11-19: plan written. A first draft of the user-task map (from the doc blocks only, 141 app components) was shown to the user in chat and accepted as a start; session 1 rebuilds it in full.
