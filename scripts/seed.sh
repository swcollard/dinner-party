#!/usr/bin/env bash
# Create a demo group to click around in, against a running `npm run dev`:
#   npm run seed
# Prints a personal link for each member; open them in different browsers (or private
# windows) to act as different people. Safe to run repeatedly: each run makes a new group.
set -euo pipefail
BASE=${BASE:-http://localhost:8787}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SECRET=${SETUP_SECRET:-$(sed -n 's/^SETUP_SECRET=//p' "$ROOT/.dev.vars" 2>/dev/null)}
[ -n "$SECRET" ] || { echo "Set SETUP_SECRET in .dev.vars (see .dev.vars.example)"; exit 2; }
curl -sf "$BASE/healthz" >/dev/null || { echo "Nothing at $BASE: start it with 'npm run dev' first"; exit 2; }

api() { # api TOKEN METHOD PATH [JSON]
  curl -sf -X "$2" "$BASE$3" -H "Authorization: Bearer $1" -H 'content-type: application/json' ${4:+-d "$4"}
}
token() { sed 's/.*#t=//'; }

ADMIN_LINK=$(curl -sf -X POST "$BASE/admin/groups" -H "x-setup-secret: $SECRET" -H 'content-type: application/json' \
  -d '{"name":"Sunday Supper (demo)","admin":{"name":"Alex","email":"alex@example.com"}}' | jq -r .adminLink)
ALEX=$(echo "$ADMIN_LINK" | token)
api "$ALEX" PUT /api/me '{"dietary":"severe sesame allergy","address":"1 Main St, Austin TX"}' >/dev/null
api "$ALEX" PUT /api/group '{"chatUrl":"https://chat.whatsapp.com/example"}' >/dev/null

declare -a NAMES=(Bea Cal Dee) LINKS=()
for n in "${NAMES[@]}"; do
  LINKS+=("$(api "$ALEX" POST /api/members "{\"name\":\"$n\",\"email\":\"$(echo "$n" | tr 'A-Z' 'a-z')@example.com\"}" | jq -r .link)")
done
for i in 1 2 3 4; do api "$ALEX" POST /api/dinners/schedule-next >/dev/null; done

echo "Demo group created: 4 members, 4 dinners scheduled in rotation order."
echo
echo "  Alex (admin, profile filled in): $ADMIN_LINK"
for i in "${!NAMES[@]}"; do echo "  ${NAMES[$i]} (member, no dietary info yet): ${LINKS[$i]}"; done
echo
echo "Calendar feed for Alex: $(api "$ALEX" GET /api/me | jq -r .calendarUrl)"
