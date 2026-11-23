# Command analysis of guard-commands.sh (#387, #654): read from stdin as one string (`perl -0777 -n`), prints the reason a command is
# blocked, nothing when it is fine. Lives in its own file so an apostrophe (in a message, a regex, a comment) cannot end a
# surrounding shell string and break the hook for every Bash call (the failure class #640 removed from e2e-before-merge.sh).
  my $c = $_;
  my $neutral = sub { my $t = shift; $t =~ tr/;&|\n/    /; $t };
  $c =~ s/\\\n/ /g;
  $c =~ s/(<<-?[ \t]*(['"]?)(\w+)\2)(.*?\n[ \t]*\3[ \t]*)(?=\n|$)/$1 . $neutral->($4)/gse;
  $c =~ s/^[ \t]*#.*$//gm;
  $c =~ s/('[^']*'|"(?:\\.|[^"\\])*")/$neutral->($1)/ge;
  my $sandbox = qr/\\?"identifier\\?"\s*:\s*\\?"(?:io\.github\.jaylouiz|com\.julius)\.kan-do\.sandbox(?:-[\w\$\{\}]+)?\\?"/;
  my @segs = map {
    my $s = $_;
    $s =~ s/^\s*(?:(?:\$\(|[({!])\s*)*//;
    $s =~ s/^(?:(?:then|do|else|time|sudo|exec|command|nohup|env)\s+|[A-Za-z_]\w*=\S*\s+)*//;
    $s;
  } split /&&|\|\||[;&|\n]/, $c;
  # kd#203: `rm` and a git command in one call stop an unattended worker at a permission dialog (a written rule broken twice).
  if ((grep { /^(?:\S*\/)?rm\s/ } @segs) && (grep { /^(?:\S*\/)?git\s/ } @segs)) {
    print "never chain `rm` with a git command (the pair stops an unattended worker at a permission dialog): run `rm <one path>` as its own call, then the git command as a second call";
    next;
  }
  for my $s (@segs) {
    # A no-code lead started in the main checkout renamed `main` to its feature branch and broke the next `git pull`
    # (retro 2026-11-23): renaming the current branch is for a worktree, never the main checkout on `main`.
    if ($s =~ /^(?:\S*\/)?git\s+branch\s+-[mM]\b/) {
      my $b = `git symbolic-ref --short HEAD 2>/dev/null`; $b =~ s{\s+\z}{};
      my $gd = `git rev-parse --absolute-git-dir 2>/dev/null`; $gd =~ s{\s+\z}{};
      my $cd = `git rev-parse --path-format=absolute --git-common-dir 2>/dev/null`; $cd =~ s{\s+\z}{};
      if (($b eq 'main' || $b eq 'master') && $gd ne '' && $gd eq $cd) {
        print "never rename the branch of the main checkout (it must stay `$b`, the next pull fails otherwise): do the work in a worktree (`git worktree add` or a new Orca workspace), and rename the branch there"; last;
      }
    }
    if ($s =~ /^(?:\S*\/)?pkill\b.*nuxt/) {
      print "never pkill nuxt (it kills the user's :3000 server too): stop your own server by its port's PID, `lsof -ti tcp:<port> -sTCP:LISTEN | xargs kill`"; last;
    }
    if ($s =~ /^(?:npm\s+run\s+tauri:dev\b|npm\s+run\s+tauri\s+(?:--\s+)?dev\b|(?:"?\S*cargo"?\s+|npx\s+(?:\@tauri-apps\/cli\s+)?)?tauri\s+dev\b)/ && $s !~ $sandbox) {
      print "agents never run tauri dev with the real identity (user data folder and Keychain): follow docs/testing/tauri-dev-sandbox.md (skill desktop-verify)"; last;
    }
    if ($s =~ /^(?:npm\s+run\s+release(?![\w:-])|node\s+(?:\.\/)?scripts\/release\.mjs\b)/ && $s !~ /(?:^|\s)--dry-run\b/ && !($s =~ /(?:^|\s)--stage(?:=|\s+)(?:alpha|beta)(?=\s|$)/ && $s !~ /stable/i && $s !~ /[\$`"'\\]/ && $s !~ /--skip-/)) {
      print "agents run the release script with --dry-run, or for an alpha or beta release with an explicit, literal `--stage alpha|beta` (no quotes, `$` or backslash, no `--skip-*`; npm run release <version> -- --stage alpha); a stable release (or none named) is the user's: /prepare-release hands them the command"; last;
    }
    if ($s =~ /^(?:\S*\/)?gh\s+workflow\s+run\s+["']?(?:\S*\/)?release(?:\.ya?ml)?["']?(?:\s|$)/i) {
      print "agents never trigger the release workflow: /prepare-release hands the user the release command"; last;
    }
    if ($s =~ /^(?:\S*\/)?npm\s+(?:install|i|ci)(?![\w:-])/ || $s =~ /^npx\s+(?:-y\s+|--yes\s+)?npm@(?!11\.19\.0(?:\s|$))\S*\s+(?:install|i|ci)(?![\w:-])/) {
      print "use `npx npm\@11.19.0 install ...` (local npm 11.6 drops \@emnapi lockfile entries)"; last;
    }
    if ($s =~ /^(?:\S*\/)?npm\s+(?:-{1,2}[\w-]+(?:=\S+)?\s+)*run(?:-script)?\s+(?:-{1,2}[\w-]+(?:=\S+)?\s+)*terms:approve(?![\w:-])/ || $s =~ /^(?:\S*\/)?node\s+(?:\S+\s+)*?(?:\.\/)?scripts\/copy-terms\.mjs\s+approve\b/) {
      print "only the user approves decided UI terms (docs/copy/terms.lock.json): they run `npm run terms:approve` in their own terminal. Keep the term as it is and write a \"Term question\" line in the PR body"; last;
    }
    if ($s =~ /^(?:\S*\/)?(?:pkill|killall)\b.*(?:\bapp\b|kan-?do|tauri)/) {
      print "never kill the desktop app by name (the user's production app and other workers' windows are named the same): kill the PID of your own `tauri dev` process after `lsof -a -p <pid> -d cwd` shows your worktree (docs/testing/tauri-dev-sandbox.md)"; last;
    }
    if ($s =~ /^(?:\S*\/)?kill\b.*(?:\$\(|\x60)\s*(?:\S*\/)?pgrep\b/) {
      print "never kill what a pgrep pattern matches (it hits other workers' windows and the user's app too): pick the PID of your own `tauri dev` process after `lsof -a -p <pid> -d cwd` shows your worktree, then `kill <pid>` (docs/testing/tauri-dev-sandbox.md)"; last;
    }
    if ($s =~ /^(?:\S*\/)?osascript\b/ && $s =~ /\bfrontmost\b|\bactivate\b|\bkeystroke\b|\bkey\s+code\b/) {
      print "agents never steal focus or send keystrokes (osascript with frontmost, activate, keystroke or key code): run the sandbox window in the background and capture only your own window, `screencapture -x -l <window id>`; skip checks that need the frontmost app and say so in the PR (docs/testing/tauri-dev-sandbox.md, skill desktop-verify)"; last;
    }
    if ($s =~ /^(?:\S*\/)?osascript\b/ && $s =~ /\bSystem Events\b/i && $s =~ /\bprocess(?:es)?\b/i && $s !~ /\bunix\s*id\b/i) {
      print "never select a System Events process by name (several processes are named `app`, one may be the user's production app): select it by `unix id` of a PID whose cwd you verified with `lsof -a -p <pid> -d cwd` (docs/testing/tauri-dev-sandbox.md)"; last;
    }
    if ($s =~ /^(?:\S*\/)?screencapture\b/ && $s !~ /(?:^|\s)-[A-Za-z]*[lR]/) {
      print "no full-screen screencapture (it shows the user's private windows): capture only your own window, `screencapture -x -l <window id>` of a PID-verified process (docs/testing/tauri-dev-sandbox.md)"; last;
    }
    # Verification only ever drives a separate test instance, never the user's production install or their own
    # `tauri:dev` window: `orca computer` may target a kan-do process only by the PID of a sandbox run (throwaway HOME,
    # KANDO_SANDBOX_BACKGROUND=1, docs/testing/tauri-dev-sandbox.md). Other apps (a browser) pass untouched.
    if ($s =~ /^(?:\S*\/)?orca(?:-dev|-ide)?\s+computer\b/ && $s =~ /--app(?:=|\s+)["']?([^\s"']+)/) {
      my $app = $1;
      my $sandboxOnly = "desktop verification drives only a sandboxed test instance, never the production install (/Applications/kan-do.app) or the user's own tauri dev window: start one with docs/testing/tauri-dev-sandbox.md (skill desktop-verify) and target it as `--app pid:<its PID>`";
      if ($app =~ /^pid:(\d+)$/) {
        my $pid = $1;
        my $ps = `ps eww -o command= -p $pid 2>/dev/null`;
        my $kando = $ps =~ m{kan-?do\.app/|(?:^|/)target/(?:debug|release)/app(?:\s|$)}i;
        my ($home) = $ps =~ /(?:^|\s)HOME=(\S+)/;
        if ($kando && !($ps =~ /(?:^|\s)KANDO_SANDBOX_BACKGROUND=1(?:\s|$)/ && defined $home && $home ne $ENV{HOME})) {
          print "pid:$pid is not a sandbox run (production app or a tauri dev with the real HOME): $sandboxOnly"; last;
        }
      } elsif ($app =~ /kan-?do|jaylouiz|^app$|tauri/i) {
        print "never target the desktop app by name or bundle ID (it resolves to the production app or another worker's window): $sandboxOnly"; last;
      }
    }
  }
