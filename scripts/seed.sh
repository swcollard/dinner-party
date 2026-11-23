#!/usr/bin/env bash
# Create a demo group to click around in, against a running `npm run dev`:
#   npm run seed
# Prints a personal link for each member; open them in different browsers (or private
# windows) to act as different people. Safe to run repeatedly: each run makes a new group.
set -euo pipefail
BASE=${BASE:-http://localhost:8787}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
. "$ROOT/scripts/lib.sh"
require_tools curl jq
SECRET=$(read_setup_secret "$ROOT")
require_server "$BASE"

# Explain a failed request in plain terms, then stop.
explain() { # explain WHAT STATUS BODY
  echo "Seeding failed: $1 returned HTTP $2." >&2
  case "$2:$1" in
    403:*admin/groups*)
      echo "The setup secret was rejected: the running server has a different SETUP_SECRET than .dev.vars." >&2
      echo "If you created or edited .dev.vars after starting 'npm run dev', stop it (Ctrl-C) and start it again." >&2 ;;
    5*)
      echo "Server error. On a fresh checkout, run 'npm run db:migrate:local' and restart 'npm run dev'." >&2
      echo "The 'npm run dev' terminal shows the full error." >&2 ;;
  esac
  [ -n "$3" ] && echo "Response: $3" >&2
  exit 1
}

# call METHOD PATH HEADER [JSON]: prints the response body, or explains the failure and exits.
call() {
  local args=(-s -w '\n%{http_code}' -X "$1" "$BASE$2" -H "$3" -H 'content-type: application/json')
  [ -n "${4:-}" ] && args+=(-d "$4")
  local out status body
  out=$(curl "${args[@]}") || { echo "Couldn't reach $BASE. Is 'npm run dev' still running?" >&2; exit 1; }
  status=${out##*$'\n'}; body=${out%$'\n'*}
  case $status in 2*) printf '%s' "$body" ;; *) explain "$1 $2" "$status" "$body" ;; esac
}

GROUP=$(call POST /admin/groups "x-setup-secret: $SECRET" \
  '{"name":"Sunday Supper (demo)","admin":{"name":"Alex","email":"alex@example.com"}}')
ADMIN_LINK=$(printf '%s' "$GROUP" | jq -r .adminLink)
AUTH="Authorization: Bearer ${ADMIN_LINK#*#t=}"
call PUT /api/me "$AUTH" '{"dietary":"severe sesame allergy","address":"1 Main St, Austin TX"}' >/dev/null
call PUT /api/group "$AUTH" '{"chatUrl":"https://chat.whatsapp.com/example"}' >/dev/null

NAMES=(Bea Cal Dee)
LINKS=()
for n in "${NAMES[@]}"; do
  lower=$(printf '%s' "$n" | tr 'A-Z' 'a-z')
  LINKS+=("$(call POST /api/members "$AUTH" "{\"name\":\"$n\",\"email\":\"$lower@example.com\"}" | jq -r .link)")
done
for _ in 1 2 3 4; do call POST /api/dinners/schedule-next "$AUTH" >/dev/null; done

echo "Demo group created: 4 members, 4 dinners scheduled in rotation order."
echo
echo "  Alex (admin, profile filled in): $ADMIN_LINK"
for i in "${!NAMES[@]}"; do echo "  ${NAMES[$i]} (member, no dietary info yet): ${LINKS[$i]}"; done
echo
echo "Calendar feed for Alex: $(call GET /api/me "$AUTH" | jq -r .calendarUrl)"
