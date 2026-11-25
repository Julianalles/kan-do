#!/usr/bin/env bash
# UserPromptSubmit hook: snapshot the state of every checkout the Stop hooks check (the session's own checkout and the
# worktrees it edited, edit-root.sh), so verify.sh and impeccable-worktree.sh skip a checkout this turn did not change
# (a chat-only reply in a dirty tree). Prints nothing: a UserPromptSubmit hook's stdout becomes model context.

project_dir="${CLAUDE_PROJECT_DIR:-.}"
cd "$project_dir" || exit 0
. "$(dirname "$0")/edit-root.sh"

input=$(cat)
session_id=$(hook_get "$input" session_id)
: "${session_id:=unknown}"
main=$(kando_toplevel "$project_dir")
[ -n "$main" ] || exit 0

roots=("$main")
while IFS= read -r root; do
  [ -n "$root" ] && [ "$root" != "$main" ] && [ -d "$root" ] && roots+=("$root")
done < <(kando_recorded_roots "$session_id")

kando_snapshot_turn "$session_id" "${roots[@]}" >/dev/null 2>&1
exit 0
