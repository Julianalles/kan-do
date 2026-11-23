# Feedback retention and deletion (#744)

Feedback sent through the relay (`POST /api/feedback`, [ADR 010](adr/010-in-app-feedback.md) "Amendment: relay") lands
in the private repository `jaylouiz/kan-do-feedback`. GDPR Arts. 5(1)(e), 13 and 17 ask for a retention period, a notice
before sending, and a way to delete. This page is the procedure.

## Retention period

`FEEDBACK_RETENTION_DAYS` in `lib/feedback/retention.ts`: an issue and its screenshot are deleted **30 days after the
issue is closed** (the maintainer's decision, 2026-11-23). An open issue is kept while it is being worked on. Change the
period only there; the privacy notice on the homepage must say the same. The feedback form shows it in the review step, above the send button,
with a link to the kan-do privacy notice and the Impressum (`lib/legalLinks.ts`).

## Where the data sits

- **Issue**: title and body exactly as the review step showed (description, chosen context rows, log tail when ticked,
  task title only when ticked; default off). Label `inbox`.
- **Screenshot**: the only file of its own parentless branch `screenshot/<uuid>` (path `feedback/<yyyy>/<mm>/<uuid>.png`
  inside it). Nothing is committed to the default branch. Deleting the branch leaves the image in no reachable history.
  (GitHub may keep unreachable objects until its own garbage collection; they are not reachable through the repository.
  A full purge of those goes through GitHub Support.)

## Routine cleanup

A GitHub Action runs it every Monday (`.github/workflows/feedback-cleanup.yml`, #787) and on demand (Actions → "Feedback cleanup" → Run workflow; the manual run is a dry run unless "apply" is ticked). It lives in kan-do because the script does; `kan-do-feedback` needs no workflow and no secret. A weekly run keeps closed feedback at most about 37 days (a monthly one would keep it up to about 60).

The same by hand, from a kan-do checkout with the maintainer's `gh` login:

```bash
npm run feedback:cleanup              # dry run: lists what is due
npm run feedback:cleanup -- --apply   # deletes it
```

The script (`scripts/feedback-cleanup.mts`) deletes every issue closed more than 30 days ago (GraphQL `deleteIssue`) and
the screenshot branch its body names, branches first. A `screenshot/*` branch that no issue names (a report whose issue
was never created) goes once its commit is older than the period. A branch an open or recently closed issue names stays.
It touches no other branch and never a pull request.

### The token (maintainer sets it up once)

The Action authenticates with the repository secret **`FEEDBACK_CLEANUP_TOKEN`** (kan-do → Settings → Secrets and variables → Actions). A missing or empty secret fails the run with a red error, nothing is deleted.

Create a **fine-grained personal access token** (Settings → Developer settings), owner `jaylouiz`, with:

- Repository access: **Only select repositories** → `jaylouiz/kan-do-feedback`
- Repository permissions: **Issues: Read and write** (lists issues, `deleteIssue`), **Contents: Read and write** (lists `screenshot/*` refs and their commits, deletes the branches); Metadata: Read (set automatically). Nothing else.
- An expiry (e.g. 1 year); when it lapses the weekly run goes red, which is the reminder to renew it.

`deleteIssue` needs admin rights on the repository: the token acts as its owner, who is the admin. If the first manual run with "apply" ticked answers `FORBIDDEN` on `deleteIssue`, add **Administration: Read and write** to the token; the other permissions stay.

## A deletion request (Art. 17)

A user writes to the e-mail address in the Impressum. Find their issue (search the text they quote, or the date), then:

```bash
gh issue view <n> -R jaylouiz/kan-do-feedback              # the body names the screenshot branch, if any
gh api -X DELETE repos/jaylouiz/kan-do-feedback/git/refs/heads/screenshot/<uuid>
gh issue delete <n> -R jaylouiz/kan-do-feedback --yes
```

Delete the branch first: the issue body is where its name is written.

## Images from before #744

Before #744 the relay committed images to the default branch. When #744 shipped (2026-11-23) the repository's history
held none (checked: no commit touches `feedback/`), so no history rewrite was needed. Should one ever be found, removing
it needs `git filter-repo --path feedback/ --invert-paths` on a mirror clone and a force push.

## Reports from older apps

Desktop apps up to v0.21 write `blob/main/<path>` and "on `main`" into the issue body. The relay rewrites those references to the image's `screenshot/<uuid>` branch before it files the issue (`bodyNamingBranch` in `server/utils/feedbackRelay.ts`), and adds a line naming the branch when the body has none. The cleanup finds an image through that branch name in the issue body, so an open issue keeps its image.
