---
paths:
  - ".claude/hooks/**"
  - ".claude/settings.json"
  - ".githooks/**"
---
# Hooks: how they work and what they skip

The short form (what blocks, the guard list) is in root `CLAUDE.md` "Hooks".

## Stop and per-edit hooks

`.claude/settings.json` registers a `Stop` hook (`.claude/hooks/verify.sh`) that runs `lint:ci`, `typecheck`, `design:detect`, `vitest run` and, when a design-path file changed since its last pass, the rendered Impeccable scan (`scripts/design-scan.mjs`, ~30 s) before Claude may finish; failures are fed back and Claude keeps working (max 3 consecutive blocks). It skips the checks when the branch's last run passed on the same tree fingerprint (commit, uncommitted diff, untracked files, testing mode; owner decision 2026-11-19) and logs a `skip` row in `checks.tsv`. The rest of E2E runs in the pre-merge hook. A `PostToolUse` hook (`.claude/hooks/eslint-file.sh`, matcher `Edit|Write|Bash`) runs `eslint --fix --quiet` and the `var()` token check (`scripts/lint/design-tokens.mjs`) on each edited file and feeds remaining errors back. Both skip `proto/*` branches (throwaway prototypes). The Impeccable plugin adds its own design hooks. All of them work in the edited file's own checkout (`.claude/hooks/edit-root.sh`): a session started here that edits a worktree gets lint, token checks, Impeccable (`impeccable-worktree.sh`) and Stop verification there too. Files a Bash command changed (sed, heredocs; `bashEditDiff` or an mtime scan, `edit-root.sh`, #650) get the same per-edit checks; none after `git checkout|pull|stash…` or for more than 40 files, where only the Stop checks see them. Worktrees symlink `node_modules` via `worktree.symlinkDirectories`.

## Cleanup after a merge

After merge: GitHub deletes the remote head branch (repo setting "Automatically delete head branches"); the `SessionStart` hook `.claude/hooks/cleanup-merged.sh` removes local worktrees and branches of merged PRs, Orca-managed ones via `orca worktree rm` (skips dirty worktrees, worktrees a running session works in and branches with commits after the merge; a lone modified `package-lock.json` counts as clean and is discarded, because Orca's repo setup script `npm install` rewrites it with local npm 11.6). After merging a PR yourself, run it right away; `--dry-run` previews.

## Guard hook

A `PreToolUse` Bash hook (`.claude/hooks/guard-commands.sh`) blocks `pkill` of nuxt, `tauri dev` with the real app identity, a real release unless it is `--dry-run` or an explicit `--stage alpha|beta` (a stable release, or none named, and `gh workflow run release` stay the user's), `npm install|i|ci`, an `rm` chained with a git command (kd#203), and an `orca computer --app` that names the desktop app or a PID that is not a sandbox run (verification never uses the production install or the user's own `tauri dev`); its message names the allowed command. Do not work around it.
