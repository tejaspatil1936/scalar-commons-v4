#!/usr/bin/env bash
# factory/merge.sh — the ONLY component permitted to merge. OFF BY DEFAULT.
#
#   ./factory/merge.sh --dry-run      # evaluate every candidate, merge nothing
#   ./factory/merge.sh                # execute (needs ENABLE_MERGE=true)
#   ./factory/merge.sh --pr 123       # restrict to one PR
#
# A PR is merged only if EVERY one of these holds:
#   1. branch protection with required status checks exists on the default
#      branch                              <- gate on the REPO, checked first
#   2. label agent-reviewed                <- review.sh got >=2/3 PASS
#   3. label tier:T3                       <- (or tier:T2 with MERGE_T2=true)
#   4. NO needs-human label                <- no unresolved objection
#   5. `gh pr checks` all passing          <- CI is green, not merely started
#   6. PR is OPEN and mergeable, no conflicts
#
# WHY CONDITION 1 IS ABSOLUTE: without branch protection and required checks,
# a squash-merge to master is unreviewable and unrevertable-by-policy — nothing
# would have stopped a bad merge, and nothing would require checks on the next
# one. Auto-merge without protection is not automation, it is an unguarded write
# to the trunk. So if protection is absent this script refuses to merge ANYTHING
# and prints why, no matter how the MERGE_* flags are set.
#
# THIS REPO, AS OF THE BUILD: master has NO protection (the API returns 404), so
# merge.sh currently refuses everything by design. That is the correct state.

set -uo pipefail

FACTORY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/common.sh
. "$FACTORY_DIR/lib/common.sh"

: "${ENABLE_MERGE:=false}"
: "${MERGE_T2:=false}"
: "${MERGE_T3:=true-only-after-protection}"

DRY_RUN=0
ONLY_PR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run|-n) DRY_RUN=1 ;;
    --pr)         ONLY_PR="${2:-}"; shift ;;
    -h|--help)    sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

stop_requested && { log "STOP_FACTORY present — merging nothing."; exit 0; }
have_gh || die "gh CLI required"

GH_ARGS=()
mapfile -t GH_ARGS < <(gh_repo_args)

DEFAULT_BRANCH="$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name "${GH_ARGS[@]}" 2>/dev/null || echo master)"

printf '\n=== factory merge %s ===\n' "$(ts)"
printf 'mode:           %s\n' "$([ "$DRY_RUN" = 1 ] && echo 'DRY RUN' || echo EXECUTE)"
printf 'default branch: %s\n' "$DEFAULT_BRANCH"
printf 'ENABLE_MERGE=%s  MERGE_T3=%s  MERGE_T2=%s\n\n' "$ENABLE_MERGE" "$MERGE_T3" "$MERGE_T2"

# ---------------------------------------------------- condition 1: protection --
# Require protection AND at least one required status check. Protection with no
# required checks would let a red PR through, which defeats the purpose.
PROT_JSON="$(gh api "repos/:owner/:repo/branches/$DEFAULT_BRANCH/protection" "${GH_ARGS[@]}" 2>&1)"
PROT_RC=$?
REQUIRED_CHECKS=""
if [ "$PROT_RC" -eq 0 ]; then
  REQUIRED_CHECKS="$(printf '%s' "$PROT_JSON" | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
rsc = d.get("required_status_checks") or {}
print(",".join(rsc.get("contexts") or [c.get("context","") for c in (rsc.get("checks") or [])]))
' 2>/dev/null)"
fi

if [ "$PROT_RC" -ne 0 ] || [ -z "$REQUIRED_CHECKS" ]; then
  cat <<EOF
REFUSING TO MERGE ANYTHING — branch protection precondition not met.

  branch:            $DEFAULT_BRANCH
  protection API:    $([ "$PROT_RC" -ne 0 ] && printf 'not configured (%s)' "$(printf '%s' "$PROT_JSON" | head -c 200)" || echo 'present')
  required checks:   ${REQUIRED_CHECKS:-<none>}

Auto-merge is only safe when the trunk itself enforces the rules. Without
protection and at least one REQUIRED status check, a squash-merge from this
script would be an unguarded write to $DEFAULT_BRANCH: nothing would compel CI
to be green, and nothing would stop the next bad merge either. The factory
would be trading a reviewable PR queue for an unreviewable trunk.

So merging stays off — regardless of MERGE_T3/MERGE_T2 — until a human sets up:

  1. Branch protection on $DEFAULT_BRANCH
  2. At least one required status check (e.g. the ci-fast workflow)
  3. Ideally: require PRs, dismiss stale approvals, no force-push

  gh api -X PUT repos/:owner/:repo/branches/$DEFAULT_BRANCH/protection \\
    --input factory/branch-protection.json

Until then: PRs still get built, gated, and adversarially reviewed. A human
clicks merge. That is Stage 1, and it is a perfectly good place to live.
EOF
  exit 1
fi

log "branch protection present on $DEFAULT_BRANCH; required checks: $REQUIRED_CHECKS"

if [ "$DRY_RUN" != "1" ] && [ "$ENABLE_MERGE" != "true" ]; then
  cat >&2 <<EOF
merge.sh is DISABLED (ENABLE_MERGE=$ENABLE_MERGE).

Branch protection is satisfied, so the remaining step is the explicit opt-in:
set ENABLE_MERGE=true in factory/config.env. Use --dry-run to see decisions.
EOF
  exit 1
fi

# ------------------------------------------------------------ candidate PRs ---
PRS_JSON="$(gh pr list --state open --limit 100 \
    --json number,title,labels,isDraft,mergeable,headRefName "${GH_ARGS[@]}" 2>/dev/null || echo '[]')"

ROWS="$(printf '%s' "$PRS_JSON" | python3 -c '
import json,sys
try: prs=json.load(sys.stdin)
except Exception: sys.exit(0)
for p in prs:
    labels={l["name"] for l in p.get("labels") or []}
    tier=next((l for l in sorted(labels) if l.startswith("tier:")),"")
    print("\x1f".join([
        str(p["number"]), tier,
        "1" if "agent-reviewed" in labels else "0",
        "1" if "needs-human" in labels else "0",
        "1" if p.get("isDraft") else "0",
        str(p.get("mergeable") or ""),
        (p.get("title") or "").replace("\t"," "),
    ]))
')"

if [ -z "$ROWS" ]; then
  printf 'No open PRs.\n\n'; exit 0
fi

MERGED=0
REFUSED=0

while IFS=$'\x1f' read -r num tier reviewed needshuman draft mergeable title; do
  [ -n "$num" ] || continue
  [ -z "$ONLY_PR" ] || [ "$num" = "$ONLY_PR" ] || continue

  refuse() { printf 'REFUSE #%-4s %s\n' "$num" "$1"; REFUSED=$((REFUSED+1)); }

  # The tier label may live on the issue rather than the PR; fall back to the
  # linked issue so a correctly-tiered task is not merged as "untiered".
  if [ -z "$tier" ]; then
    body="$(gh pr view "$num" --json body --jq .body "${GH_ARGS[@]}" 2>/dev/null || true)"
    iss="$(printf '%s' "$body" | grep -oiE '(closes|fixes|resolves) #[0-9]+' | grep -oE '[0-9]+' | head -1)"
    if [ -n "$iss" ]; then
      tier="$(gh issue view "$iss" --json labels \
        --jq '[.labels[].name] | map(select(startswith("tier:"))) | first // ""' \
        "${GH_ARGS[@]}" 2>/dev/null || true)"
      [ -n "$tier" ] && log "#$num tier resolved from linked issue #$iss: $tier"
    fi
  fi

  [ "$draft" = "1" ]      && { refuse "is a draft"; continue; }
  [ "$needshuman" = "1" ] && { refuse "has needs-human (unresolved review objection)"; continue; }
  [ "$reviewed" = "1" ]   || { refuse "missing agent-reviewed (run factory/review.sh $num)"; continue; }

  case "$tier" in
    tier:T3)
      if [ "$MERGE_T3" != "true" ] && [ "$MERGE_T3" != "true-only-after-protection" ]; then
        refuse "tier:T3 but MERGE_T3=$MERGE_T3"; continue
      fi ;;
    tier:T2)
      if [ "$MERGE_T2" != "true" ]; then
        refuse "tier:T2 and MERGE_T2=false (T2 auto-merge stays off by policy)"; continue
      fi ;;
    tier:T0|tier:T1)
      refuse "$tier is never auto-merged"; continue ;;
    '') refuse "no tier label on PR or linked issue"; continue ;;
    *)  refuse "unrecognised tier '$tier'"; continue ;;
  esac

  if [ "$mergeable" = "CONFLICTING" ]; then
    refuse "has merge conflicts"; continue
  fi

  # ---- CI must be GREEN, not merely present -------------------------------
  # `gh pr checks` exits non-zero when anything is failing or pending, but we
  # also parse it: a PR with zero checks must never count as "green".
  CHECKS="$(gh pr checks "$num" "${GH_ARGS[@]}" 2>&1)"
  CHECKS_RC=$?
  if printf '%s' "$CHECKS" | grep -qiE 'no checks reported|no check runs'; then
    refuse "no CI checks reported — cannot call that green"; continue
  fi
  if [ "$CHECKS_RC" -ne 0 ]; then
    NOTPASS="$(printf '%s' "$CHECKS" | grep -viE '^\s*$' | grep -icE 'fail|pending|cancel|skipping|in_progress|queued' || true)"
    refuse "CI not green ($NOTPASS check(s) failing/pending)"; continue
  fi

  # ---- all conditions satisfied ------------------------------------------
  if [ "$DRY_RUN" = "1" ]; then
    printf 'WOULD MERGE #%-4s %-8s %s\n' "$num" "$tier" "$title"
    printf '            gh pr merge %s --squash --delete-branch\n' "$num"
    MERGED=$((MERGED+1))
    continue
  fi

  log "merging #$num ($tier): $title"
  if gh pr merge "$num" --squash --delete-branch "${GH_ARGS[@]}" >/dev/null 2>&1; then
    printf 'MERGED #%-4s %-8s %s\n' "$num" "$tier" "$title"
    MERGED=$((MERGED+1))
    printf '%s\tmerged\t#%s\t%s\n' "$(ts)" "$num" "$title" >> "$FACTORY_DIR/logs/merges.log"
  else
    refuse "gh pr merge failed"
  fi
done <<< "$ROWS"

printf '\n%s: %s merged, %s refused.\n\n' \
  "$([ "$DRY_RUN" = 1 ] && echo 'Dry run' || echo 'Merge pass')" "$MERGED" "$REFUSED"
exit 0
