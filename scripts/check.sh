#!/usr/bin/env bash
# The repository gate: the one command a repo names as `test:` in .claude/ai-skills.md.
# Copied from the repo-baseline kit in ai-skills (templates/repo-baseline/).
#
#   scripts/check.sh            every check, then this repo's own tests (hook point at the end)
#   scripts/check.sh --fast     every check except this repo's own tests (the pre-push hook)
#   scripts/check.sh --staged   em dash, tracked-path and public-safety scans of staged
#                               changes only (the pre-commit hook)
#   scripts/check.sh --history  public-safety scan of every commit on every branch; run it
#                               before a repository goes public (needs a full clone)
#
# Every check runs and prints PASS or FAIL; the script exits 1 if any check failed.
# Findings name the file, the line and the rule, never the matched text.
#
# Public-safety words: scripts/blocklist.txt (tracked) and scripts/blocklist.local.txt
# (untracked, for words you would rather not publish even in a list). One word or phrase
# per line, matched case-insensitively as a whole word; lines starting with # are comments.
# A line containing the marker "safety-scan: allow" is exempt from the safety rules.
set -u
cd "$(dirname "$0")/.." || exit 1

EM_DASH=$'\xe2\x80\x94'
ALLOW_MARKER='safety-scan: allow'
BLOCKLIST=scripts/blocklist.txt
LOCAL_BLOCKLIST=scripts/blocklist.local.txt

# Lines a README must not carry: they belong in docs/INTERNAL.md (status, MVP, untested
# notes, how the images are made). Matched case-insensitively.
README_INTERNAL_RE='not yet (tested|verified)|untested|(^|[^a-z])mvp([^a-z]|$)|^[[:space:]>*_-]*status[*_]*[[:space:]]*:|internal\.md|work in progress|(^|[^a-z])wip([^a-z]|$)|how (the|these) (images|screenshots) (are|were) (made|generated)|regenerat(e|ing) (the )?(images|screenshots)'

# Paths that are per-machine or agent state and must never be tracked.
FORBIDDEN_TRACKED=(.planning .gsd .claude/settings.local.json .claude/CLAUDE.md .claude/worktrees)

# Public-safety rules: "name|extended regex". Never put a literal example of a match in
# this file; the scan reads it too.
SAFETY_RULES=(
  'private IPv4 address|(^|[^0-9.])(10(\.[0-9]{1,3}){3}|172\.(1[6-9]|2[0-9]|3[01])(\.[0-9]{1,3}){2}|192\.168(\.[0-9]{1,3}){2})([^0-9.]|\.([^0-9]|$)|$)'
  'MAC address|(^|[^0-9A-Fa-f:])([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}([^0-9A-Fa-f:]|$)'
  'home directory path|/home/[A-Za-z][A-Za-z0-9_.-]*/'
  'macOS user path|/Users/[A-Za-z][A-Za-z0-9_.-]*/'
  'Windows user path|[A-Za-z]:[\/]+Users[\/]+[A-Za-z]'
  'private key header|-{5}BEGIN ([A-Z0-9]+ )*PRIVATE KEY'
  'GitHub token|gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}'
  'AWS access key id|AKIA[0-9A-Z]{16}'
  'Anthropic API key|sk-ant-[A-Za-z0-9_-]{20,}'
  'Slack token|xox[baprs]-[A-Za-z0-9-]{10,}'
)
# Documentation placeholders and hosted CI homes that look like machine paths but are not.
PLACEHOLDER_PATHS='/(home|Users)/(runner|user|username|you|yourname|your-name|me|example|USER|USERNAME)/'

TMP="$(mktemp -d)" || exit 1
trap 'rm -rf "$TMP"' EXIT

MODE=full
case "${1:-}" in
  '') ;;
  --fast) MODE=fast ;;
  --staged) MODE=staged ;;
  --history) MODE=history ;;
  -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
  *) echo "usage: scripts/check.sh [--fast|--staged|--history]" >&2; exit 2 ;;
esac
[ $# -le 1 ] || { echo "usage: scripts/check.sh [--fast|--staged|--history]" >&2; exit 2; }

declare -a NAMES=() RESULTS=()
check() {
  local name=$1; shift
  if "$@"; then
    echo "PASS $name"; RESULTS+=(PASS)
  else
    echo "FAIL $name"; RESULTS+=(FAIL)
  fi
  NAMES+=("$name")
}

# ---- Scan helpers ---------------------------------------------------------------------

# Rule table plus one rule per blocklist entry. The entry itself is never printed.
RULE_NAMES=() RULE_RES=() RULE_ICASE=()
load_rules() {
  local entry list word n escaped
  for entry in "${SAFETY_RULES[@]}"; do
    RULE_NAMES+=("${entry%%|*}"); RULE_RES+=("${entry#*|}"); RULE_ICASE+=(0)
  done
  for list in "$BLOCKLIST" "$LOCAL_BLOCKLIST"; do
    [ -f "$list" ] || continue
    n=0
    while IFS= read -r word || [ -n "$word" ]; do
      n=$((n + 1))
      word="${word#"${word%%[![:space:]]*}"}"; word="${word%"${word##*[![:space:]]}"}"
      case "$word" in ''|'#'*) continue ;; esac
      escaped="$(printf '%s' "$word" | sed 's/[][\.*^$+?(){}|/]/\\&/g')"
      RULE_NAMES+=("blocklist entry $list:$n")
      RULE_RES+=("(^|[^A-Za-z0-9_])$escaped([^A-Za-z0-9_]|$)")
      RULE_ICASE+=(1)
    done < "$list"
  done
}

# keep_hit <regex> <icase> <line>: false when the line is exempt (allow marker) or only
# matched because of a documentation placeholder path.
keep_hit() {
  local re=$1 icase=$2 line=$3 rc
  case "$line" in *"$ALLOW_MARKER"*) return 1 ;; esac
  [[ $line =~ $PLACEHOLDER_PATHS ]] || return 0
  while [[ $line =~ $PLACEHOLDER_PATHS ]]; do line=${line/"${BASH_REMATCH[0]}"/ }; done
  [ "$icase" = 1 ] && shopt -s nocasematch
  [[ $line =~ $re ]]; rc=$?
  shopt -u nocasematch
  return $rc
}

# grep_hits <label> <-E|-F> <icase> <pattern>: searches SCAN_PATHS (index when MODE is
# staged, else the working tree of tracked files). Prints file:line: label per hit.
# Returns 0 clean, 1 hits, 2 when git itself failed (never read as clean).
grep_hits() {
  local label=$1 kind=$2 icase=$3 pat=$4 rc f n c found=0
  local -a args=(grep -n -I -z "$kind")
  [ "$icase" = 1 ] && args+=(-i)
  [ "$MODE" = staged ] && args+=(--cached)
  git "${args[@]}" -e "$pat" -- "${SCAN_PATHS[@]}" > "$TMP/hits"; rc=$?
  if [ "$rc" -gt 1 ]; then
    echo "  git grep failed (exit $rc) for $label; the scan did not run"
    return 2
  fi
  [ "$rc" -eq 1 ] && return 0
  while IFS= read -r -d '' f && IFS= read -r -d '' n && IFS= read -r c; do
    if [ "$kind" = -E ]; then keep_hit "$pat" "$icase" "$c" || continue; fi
    echo "  $f:$n: $label"
    found=1
  done < "$TMP/hits"
  return "$found"
}

private_file_name() {
  case "${1##*/}" in
    .env.example|.env.sample|.env.template|*.pub) return 1 ;;
    .env|.env.*|*.pem|*.key|*.p12|*.pfx|*.jks|*.keystore|id_rsa*|id_ed25519*|id_ecdsa*|id_dsa*|credentials*.json) return 0 ;;
  esac
  return 1
}

# SCAN_PATHS and SCAN_FILES: every tracked file, or only the staged additions and edits.
set_scope() {
  local f
  SCAN_FILES=()
  if [ "$MODE" = staged ]; then
    while IFS= read -r -d '' f; do SCAN_FILES+=("$f"); done \
      < <(git diff --cached --name-only --diff-filter=ACMR -z)
    SCAN_PATHS=()
    for f in ${SCAN_FILES[@]+"${SCAN_FILES[@]}"}; do SCAN_PATHS+=(":(literal)$f"); done
  else
    while IFS= read -r -d '' f; do SCAN_FILES+=("$f"); done < <(git ls-files -z)
    SCAN_PATHS=(.)
  fi
  SCAN_PATHS+=(":(exclude)$BLOCKLIST" ":(exclude)$LOCAL_BLOCKLIST")
}

# ---- Checks ---------------------------------------------------------------------------

check_rules_pair() {
  if [ ! -f CLAUDE.md ] && [ ! -f AGENTS.md ]; then
    echo "  neither CLAUDE.md nor AGENTS.md exists; the fleet baseline wants both, identical"
    return 1
  fi
  cmp CLAUDE.md AGENTS.md
}

check_em_dash() {
  if [ "$MODE" = staged ] && [ "${#SCAN_FILES[@]}" -eq 0 ]; then return 0; fi
  grep_hits "em dash (U+2014); reword with a colon, semicolon, comma or parentheses" -F 0 "$EM_DASH"
}

check_forbidden_paths() {
  local out
  out="$(git ls-files -- "${FORBIDDEN_TRACKED[@]}")" || { echo "  git ls-files failed"; return 1; }
  [ -z "$out" ] && return 0
  printf '%s\n' "$out" | sed 's/^/  tracked but must not be: /'
  echo "  untrack with: git rm -r --cached <path>, then add it to .gitignore"
  return 1
}

check_readme() {
  local bad=0 n ref path
  [ -f README.md ] || { echo "  no README.md; nothing to check"; return 0; }
  while IFS=: read -r n _; do
    [ -n "$n" ] || continue
    echo "  README.md:$n: internal-only content; move it to docs/INTERNAL.md"
    bad=1
  done < <(grep -niE "$README_INTERNAL_RE" README.md)
  # Local images: markdown ![alt](path "title"), <img src="path">, and [ref]: path.
  while IFS= read -r ref; do
    ref="${ref#<}"; ref="${ref%>}"
    case "$ref" in ''|http://*|https://*|//*|data:*|mailto:*|'#'*) continue ;; esac
    path="${ref%%[#?]*}"; path="${path#./}"; path="${path#/}"; path="${path//%20/ }"
    if ! git ls-files --error-unmatch -- "$path" > /dev/null 2>&1; then
      echo "  README.md references a missing or untracked file: $path"
      bad=1
    fi
  done < <(
    grep -oE '!\[[^]]*\]\([^)]+\)' README.md | sed -E 's/^!\[[^]]*\]\(//; s/\)$//; s/[[:space:]].*$//'
    grep -oiE '<img[^>]*src=("[^"]*"|'"'"'[^'"'"']*'"'"')' README.md | sed -E 's/.*src=["'"'"']//; s/["'"'"']$//'
    grep -oiE '^\[[^]]+\]:[[:space:]]*[^[:space:]]+\.(png|jpe?g|gif|svg|webp)' README.md | sed -E 's/^\[[^]]+\]:[[:space:]]*//'
  )
  if [ -f docs/INTERNAL.md ] && ! head -1 docs/INTERNAL.md | grep -q '^<!-- INTERNAL-ONLY:'; then
    echo "  docs/INTERNAL.md must start with <!-- INTERNAL-ONLY: ... -->"
    bad=1
  fi
  return "$bad"
}

check_safety() {
  local i rc bad=0 hint=0 f
  if [ "$MODE" = staged ] && [ "${#SCAN_FILES[@]}" -eq 0 ]; then
    echo "  nothing staged; nothing scanned"
    return 0
  fi
  for f in ${SCAN_FILES[@]+"${SCAN_FILES[@]}"}; do
    if private_file_name "$f"; then echo "  $f: private key, credential or env file"; bad=1; fi
  done
  for i in "${!RULE_NAMES[@]}"; do
    grep_hits "${RULE_NAMES[$i]}" -E "${RULE_ICASE[$i]}" "${RULE_RES[$i]}"; rc=$?
    [ "$rc" -eq 0 ] || bad=1
    [ "$rc" -eq 1 ] && hint=1
  done
  [ "$hint" -eq 0 ] || echo "  a hit that is truly public: reword it, or add the marker '$ALLOW_MARKER' to that line"
  return "$bad"
}

# History: -G finds candidate commits fast, then each candidate's diff is re-read so the
# allow marker and placeholders are honored. Commit messages are searched too.
check_history() {
  local i re icase c msg bad=0 f line
  local -a gi=() hits=() excl=(-- . ":(exclude)$BLOCKLIST" ":(exclude)$LOCAL_BLOCKLIST")
  if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" != false ]; then
    echo "  not a full clone; run git fetch --unshallow first"
    return 1
  fi
  for i in "${!RULE_NAMES[@]}"; do
    re="${RULE_RES[$i]}"; icase="${RULE_ICASE[$i]}"; gi=()
    [ "$icase" = 1 ] && gi=(-i)
    hits=()
    while IFS= read -r c; do
      [ -n "$c" ] || continue
      while IFS= read -r line; do
        case "$line" in '+++ '*|'--- '*) continue ;; [+-]*) ;; *) continue ;; esac
        if keep_hit "$re" "$icase" "${line:1}"; then hits+=("$c"); break; fi
      done < <(git show --format= --no-color -U0 "$c" "${excl[@]}" | grep -E ${gi[@]+"${gi[@]}"} -e "$re")
    done < <(git log --all --format=%h ${gi[@]+"${gi[@]}"} -G"$re" "${excl[@]}")
    msg="$(git log --all --format=%h ${gi[@]+"${gi[@]}"} -E --grep="$re" | tr '\n' ' ')"
    if [ "${#hits[@]}" -gt 0 ]; then echo "  ${RULE_NAMES[$i]}: in the diffs of ${hits[*]}"; bad=1; fi
    if [ -n "$msg" ]; then echo "  ${RULE_NAMES[$i]}: in the messages of $msg"; bad=1; fi
  done
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if private_file_name "$f"; then echo "  $f: private key, credential or env file was committed"; bad=1; fi
  done < <(git log --all --format= --name-only | sort -u)
  [ "$bad" -eq 0 ] || echo "  inspect with: git log --all -p -G '<pattern>'; rotate any real secret before going public"
  return "$bad"
}

# ---- Run ------------------------------------------------------------------------------

main() {
  local before failed=0 r
  git rev-parse --git-dir > /dev/null 2>&1 || { echo "FAIL not inside a git repository"; exit 1; }
  load_rules
  if [ "$MODE" = history ]; then
    check "public-safety scan of all history" check_history
  else
    set_scope
    [ "$MODE" = staged ] || check "CLAUDE.md and AGENTS.md identical" check_rules_pair
    check "no em dashes in tracked text" check_em_dash
    check "no agent or planning state tracked" check_forbidden_paths
    [ "$MODE" = staged ] || check "README is public-ready" check_readme
    check "public-safety scan" check_safety
    if [ "$MODE" = full ]; then
      before=${#NAMES[@]}
      repo_tests
      [ "${#NAMES[@]}" -gt "$before" ] || echo "SKIP repo tests: none configured (see the hook point at the end of scripts/check.sh)"
    fi
  fi
  for r in ${RESULTS[@]+"${RESULTS[@]}"}; do [ "$r" = PASS ] || failed=$((failed + 1)); done
  if [ "$failed" -gt 0 ]; then
    echo "check: $failed of ${#NAMES[@]} checks FAILED"
    exit 1
  fi
  echo "check: all ${#NAMES[@]} checks passed"
}

# ======================================================================================
# HOOK POINT: this repository's own tests.
# Add one `check "<name>" <command> [args...]` line per test command. They run in a full
# check only (--fast, --staged and --history skip them). Examples:
#   check "unit tests" npm test
#   check "python tests" uv run --frozen pytest -q
#   check "go tests" go test ./...
# ======================================================================================
repo_tests() {
  check "type check" pnpm run typecheck
  check "lint" pnpm run lint
  check "unit tests" pnpm run test
}

main
