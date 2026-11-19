# Baseline: the three earlier audits on the audited commit

Session 1 of `plan.md`. Audited commit: `e6786ddc` (`main`, 2026-11-19). Each finding of the three earlier audits with its status on that commit. Status values: **done**, **open with issue**, **open without issue** (carried into `findings-baseline.md` when it is a UI finding), **no longer applies** (a later decision replaced the rule or the element is gone).

How it was checked: `rg` over `components pages layouts app.vue assets app.config.ts` without `pages/ui.vue`, `pages/error-test.vue` and `components/prototype/`; the guard tests under `tests/config/`; `docs/design/backlog.md` (closed as a work list on 2026-11-12) and `docs/design/redesign-plan.md`. Nothing was rendered in this session: a status that rests on a guard or on the code alone says so, and the rendered check is session 4's.

Issue numbers: this repository's tracker restarted when the repo moved, so the older documents write `kd#n` for the current tracker and plain `#n` for the old one. In this folder `#n` without a prefix is quoted as the source wrote it.

Open issues on the audited day (for "already tracked"): #588, #587 (inbox), #581, #580, #579, #577, #575, #573, #562, #554, #478 (on hold), #374 (on hold).

## 1. `docs/design/audit-2026-11.md` (U1 to U20)

| ID | Finding | Status | Evidence on `e6786ddc` |
|---|---|---|---|
| U1 | sticky page header translucent | done | no `backdrop-blur` or `bg-page/80` in components, pages, layouts |
| U2 | app bar row transparent | no longer applies | decided 2026-11-11: flat white pills, no glass (kd#176) |
| U3 | day-close hierarchy and footer | no longer applies | the dialog is replaced by `DayCloseStage`; open issue #580 covers its entry transition only |
| U4 | no button size ladder | done, then superseded | The One Height Rule (#424), `button-ladder.test.ts` |
| U5 | unused components and CSS | done | files gone; `.inline-editable-trigger` and `.task-context-bar` no longer in `assets/css` |
| U6 | legacy statistics modal | done | file gone |
| U7 | statistics opens a modal, the board a sheet | done | `TaskDetailModal.vue` gone, `/statistics/:id` uses `TaskSheetDetail` |
| U8 | section-heading string copied | done | `SectionHeader`; `display-layout.test.ts` allows `font-display` in five files only (one of them is finding baseline-3) |
| U9 | three tab looks | done | `UTabs` only, `design-patterns.test.ts` |
| U10 | hand-rolled warning boxes, plain coloured lines | done, one new place | `UAlert` in 22 files; one plain `role="alert"` line is new since: baseline-2 |
| U11 | orange icon as empty state, eyebrow, wording | done | `EmptyState` / `EmptyNote` |
| U12 | modal/drawer split copied | done | `ResponsiveOverlay`, `useIsDesktop` |
| U13 | `defineOptions`, doc blocks | done | `component-conventions.test.ts` |
| U14 | focus ring hand-written | done | `focus-ring` utility; the ring itself changed to the halo (2026-11-11) |
| U15 | `.touch-target` by hand | done | theme floor, `button-ladder.test.ts` |
| U16 | large components mixing jobs | no longer applies | dropped 2026-11-12 (kd#182): split when a change needs it |
| U17 | test ids no test names | done | kd#218 |
| U18 | page title scale | done | `PageHeader` h1 is the display role (kd#179) |
| U19 | one-word last line on card titles | done | `text-wrap: pretty` in `TaskCard.vue:788` |
| U20 | "Statistiken" vs "Statistik" | done | #680 |

Part 1 of that audit (inventory by job) is superseded by `map.md` of this sweep.

## 2. `docs/design/ui-kit-audit.md`

| Finding | Status | Evidence on `e6786ddc` |
|---|---|---|
| 32 raw `<button>` in 18 files | done | 9 left, each listed with its reason in `tests/config/raw-button.baseline.json`; `ratchets.test.ts` stops a new one |
| 4 dead components, `/styleguide` | done | files gone; `/ui` replaces the styleguide |
| Back and forward: 5 implementations | done | `BackButton` (5 users), `icon-map.test.ts` |
| Open external vs open details: two icons mixed | done | `lib/icons.ts` (`external`, `arrowTool`), `ExternalLink` |
| Icon notation `i-ph-*` vs `ph:*` | done | 302 `i-ph-*`, 0 `ph:*` in templates |
| Tabs and segmented controls | done, one new element | `UTabs` in 5 files; `SegmentedChoice` is new since the audit (map.md, "Pick one of a few") |
| Notices: 28 plain coloured lines | done, one new place | see U10 |
| Empty states: 7 hand-written sentences | done | `EmptyNote` (7 users), `EmptyState` (2) |
| List rows: about 10 hand-built | done in part | `ListRow` (6 users), one density (kd#180). Rows still outside it are in map.md, "Show a list row" |
| Choice chips: 4 hand-built looks | done | `ChoiceChip`, `ChoiceCard`, `PropertyValueTrigger`, `SwatchRadioGroup` |
| Button sizes, `outline` | done, then superseded | see U4 |
| Direct `matchMedia` for the phone breakpoint | open without issue, code only | `AppNav.vue:192`, `MorePanel.vue:222`, `BoardColumnHeader.vue:108` call `useMediaQuery(BREAKPOINT_QUERIES.phone)` instead of `useIsPhone`. No visible effect, so not carried into the findings |
| `:ui` overrides with identity strings (29 files) | open without issue | 29 entries in 24 files in `tests/config/ui-prop.baseline.json`, 28 of them with the reason "moves into the app.config.ts theme"; the ratchet only stops growth: baseline-1 |
| Hard-coded values: colour, radius, shadow | done | `design-tokens.test.ts`, `token-literals.test.ts` |
| Hard-coded values: type, spacing, z-index, motion, breakpoint, icon size | done by guard | same guards plus `design-lock-in.test.ts`; 66 motion literals stay in `scripts/lint/literal-baseline.json` as component choreography (session 5 measures them) |
| Unused CSS classes | done | see U5 |
| Dead ESLint config, unused and undeclared dependencies | done | `.eslintrc.cjs` gone, `@nuxt/test-utils` gone, `prettier`, `vue-i18n`, `@vueuse/core`, `vue-router`, `@internationalized/date`, `yaml`, `playwright`, `@typescript-eslint/parser` declared |
| Guard gaps (raw button, literals, one notation, plain notice lines) | done in part | raw button, literals, notation: guarded. A plain coloured `role="alert"` line is still allowed by the guards: baseline-2 |

## 3. `docs/design/redesign-gap-audit.md`

The redesign (kd#175 to kd#182, locked in 2026-11-12) answered this audit as a whole. "Done by rule" means `DESIGN.md` now has the closed scale or the one answer and a guard holds the source; whether every screen renders it is what sessions 3 and 4 measure.

| Finding | Status | Evidence on `e6786ddc` |
|---|---|---|
| Type: 12 sizes, 13 line heights | done by rule | eight roles in `DESIGN.md`; line heights come from the size tokens, `design-lock-in.test.ts` (no `leading-*`) |
| Spacing: every half step from 2 to 14 px in use | open without issue | `DESIGN.md`: "2 and 6 px are the only half steps"; six `*-2.5` / `*-3.5` classes remain in five files and no guard checks it: baseline-4 |
| Control height: five heights in the sheet, three button sizes | done by rule | `--field-h`, The One Height Rule, `field-size.test.ts`, `button-ladder.test.ts` |
| Radius: 6, 15, 24, 32, 48 px one-offs | done by rule, one contradiction | closed scale 8 / 12 / 16, `display-layout.test.ts`; `DESIGN.md` itself gives the task sheet 32 px corners in one place and 16 px in another: baseline-5 |
| Elevation: Tailwind shadows on controls, two shadow colours | done | no `shadow-xs/sm/md/lg` class left; The Sheets Cast Shadows Rule, `design-lock-in.test.ts` |
| Motion: ten durations, eight curves | done by rule in part | tokens used; 66 literals stay as recorded choreography. Session 5 |
| Icon sizes 13 and 17 px in `em` | done by guard | `design-lock-in.test.ts` (icon size scale); not re-measured |
| Three focus rings, five controls without one | done | one halo (owner, 2026-11-11); `ExternalLink` and `NewCardOptionList` carry `focus-ring`, the collapsed `TaskStack` control has its own `:focus-visible` rule |
| Pressed equals hover; cursor split | done | base layer in `assets/css/main.css:332-350` (hand cursor, `scale: 0.97`) |
| Disabled has five looks; `PropertyValueTrigger` and `DatePickerField` look enabled | done in the source | base layer: 50 %, `not-allowed`. Whether hover still answers on a disabled value trigger is a rendered check (session 4, step 2) |
| Hover snaps on 23 components | done in the source | base layer sets the fast transition on every button, role button, tab and link |
| Loading locks some controls and not others | not re-checked | `DESIGN.md` "States" has the one answer; session 4, step 2 |
| Part 2, trigger an action | done | one height, no `subtle` or `outline` |
| Part 2, show a list row | done in part | one density; `SettingsSubpageLink` is gone. See map.md for the rows still outside `ListRow` |
| Part 2, pick one of a few | done in part | one chip, one choice card; `SegmentedChoice`, `URadioGroup` (one use) and `UTabs` pill remain beside them: map.md |
| Part 2, edit a value in a label/value row | done by rule | two looks, one height (owner, 2026-11-11) |
| Part 2, type into a field | done by rule | 36 px, `field-size.test.ts` |
| Part 2, small status or count | done | one badge size, `TaskPriorityBadge` one size |
| Part 2, head a section | done | `SectionHeader` with five roles, `PageHeader`; see baseline-3 for one hand-written string |
| Part 2, open and close a part: one disclosure affordance | open without issue | never decided in step 4; six implementations today: baseline-6 |
| Part 2, hold content as a surface | done | `PageSheet`, 16 px |
| Rules stated but checked by nothing (five) | done | line heights and icon scale: `design-lock-in.test.ts`; one solid green per view: `design-detect.spec.ts`; `aria-current`: `app-nav.spec.ts`; "one `lg` per surface" is superseded |
| `DESIGN.md` frontmatter drifted from the tokens | done | frontmatter rewritten: `rounded` 8 / 12 / 16 / pill |
| `main.css:131` comment says 0.75rem | not re-checked | the file was rewritten; no stale radius comment found near the token |
| Pill written as `9999px` and `rounded-full` | no longer applies | both are the pill of the scale |

## 4. Found while checking, not in any of the three audits

- The `/ui` catalog text of `UButton` still describes two heights (baseline-7).
- `DESIGN.md` "Components", `CLAUDE.md`, `CONTRIBUTING.md` and `.claude/issue-workflow.md` still say "user job" for what `GLOSSARY.md` now calls a user task. The plan limits session 1's wording change to `GLOSSARY.md` and `.claude/rules/ui-patterns.md`; the rest is listed as baseline-8.
