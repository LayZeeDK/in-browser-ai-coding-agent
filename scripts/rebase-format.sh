#!/bin/sh
#
# Rebase a commit range, formatting each commit's files and amending in place.
# Uses Prettier directly (not nx format) to avoid Nx plugin issues during rebase.
# Uses "theirs" conflict resolution: during rebase, "theirs" is the commit being
# replayed (with its content changes). The exec script then formats the result.
# Auto-resolves modify/delete conflicts by accepting the deletion (theirs).
#
# Usage: scripts/rebase-format.sh <range>
#
# Supports any git revision range or individual commit:
#   scripts/rebase-format.sh def456             # single commit
#   scripts/rebase-format.sh abc123..def456     # exclusive range
#   scripts/rebase-format.sh abc123^..HEAD~1    # inclusive range
#   scripts/rebase-format.sh HEAD~10..          # last 10 commits
#
# Creates a backup branch before rewriting history.

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <range>"
  echo ""
  echo "Examples:"
  echo "  $0 def456               # single commit"
  echo "  $0 abc123..def456       # exclusive range"
  echo "  $0 abc123^..HEAD~1      # inclusive range"
  echo "  $0 HEAD~10..            # last 10 commits"
  exit 1
fi

range="$1"

# Resolve the rebase base commit from the range
case "$range" in
  *..*)
    # Range: extract start (everything before ..)
    start_ref=$(echo "$range" | sed 's/\.\..*//')
    ;;
  *)
    # Single commit: rebase from its parent
    start_ref="${range}^"
    ;;
esac

# Resolve to a full SHA (may fail for root commit's parent)
root_commit=$(git rev-list --max-parents=0 HEAD)
start_sha=$(git rev-parse "$start_ref" 2>/dev/null) || {
  resolved_base=$(echo "$start_ref" | sed 's/\^$//')

  if [ "$(git rev-parse "$resolved_base" 2>/dev/null)" = "$root_commit" ]; then
    start_sha="$root_commit"
  else
    echo "[ERROR] Cannot resolve: $start_ref"
    exit 1
  fi
}

# Create backup branch
backup="backup/pre-format-rewrite-$(date +%Y%m%dT%H%M%S)"
git branch "$backup"
echo "[INFO] Backup branch: $backup"

# Write the format-and-amend exec script to a temp file
exec_script=$(mktemp)
cat > "$exec_script" << 'EXEC'
#!/bin/sh
# diff-tree returns nothing for root commits (no parent), so fall back to ls-tree
if git rev-parse HEAD^ > /dev/null 2>&1; then
  files=$(git diff-tree --no-commit-id --name-only -r HEAD)
else
  files=$(git ls-tree --name-only -r HEAD)
fi

if [ -z "$files" ]; then
  exit 0
fi

unformatted=$(echo "$files" | xargs npx prettier -l 2>/dev/null) || true

if [ -z "$unformatted" ]; then
  exit 0
fi

echo "$unformatted" | xargs npx prettier --write > /dev/null 2>&1
echo "$unformatted" | xargs git add
git commit --amend --no-edit
EXEC
chmod +x "$exec_script"

# Write the conflict resolution script to a temp file
resolve_script=$(mktemp)
cat > "$resolve_script" << 'RESOLVE'
#!/bin/sh
# Auto-resolve modify/delete conflicts by accepting deletions (theirs).
# These occur when formatting modified a file in an earlier commit,
# but the current commit deletes it.
conflicted=$(git diff --name-only --diff-filter=U)

if [ -z "$conflicted" ]; then
  exit 0
fi

for f in $conflicted; do
  # If theirs (the commit being replayed) deleted the file, accept the deletion
  if ! git show REBASE_HEAD:"$f" > /dev/null 2>&1; then
    git rm "$f" > /dev/null 2>&1
  else
    # Theirs modified it — take theirs version
    git checkout --theirs "$f"
    git add "$f"
  fi
done
RESOLVE
chmod +x "$resolve_script"

# Start the rebase
if [ "$start_sha" = "$root_commit" ]; then
  echo "[INFO] Rebasing from root..."
  rebase_cmd="GIT_SEQUENCE_EDITOR=true git rebase --root --exec \"sh $exec_script\" -X theirs --rerere-autoupdate"
else
  echo "[INFO] Rebasing from $start_sha..."
  rebase_cmd="GIT_SEQUENCE_EDITOR=true git rebase $start_sha --exec \"sh $exec_script\" -X theirs --rerere-autoupdate"
fi

# Run rebase with conflict resolution loop
eval "$rebase_cmd" 2>&1 || {
  while true; do
    # Resolve any conflicts
    sh "$resolve_script"

    # Continue the rebase
    if GIT_EDITOR=true git rebase --continue 2>&1; then
      break
    fi
  done
}

rm -f "$exec_script" "$resolve_script"

echo ""
echo "[OK] Rebase complete. Verify with: npm exec nx -- format:check --all"
echo "[OK] Restore with: git reset --hard $backup"
