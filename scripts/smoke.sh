#!/usr/bin/env bash
# End-to-end smoke test against a running `wrangler dev` (local D1, migrations applied).
#   npm run db:migrate:local && npm run dev   # in another terminal
#   SETUP_SECRET=... BASE=http://localhost:8787 scripts/smoke.sh
# Creates fresh groups on every run, so it is safe to repeat.
set -u
BASE=${BASE:-http://localhost:8787}
SECRET=${SETUP_SECRET:-devsecret}
FAILS=0

# req TOKEN METHOD PATH [JSON]  -> sets $BODY and $CODE
req() {
  local token=$1 method=$2 path=$3 data=${4:-}
  local args=(-s -o /tmp/smoke.body -w '%{http_code}' -X "$method" "$BASE$path")
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$data" ] && args+=(-H 'content-type: application/json' -d "$data")
  CODE=$(curl "${args[@]}"); BODY=$(cat /tmp/smoke.body)
}
check() { # check "description" actual expected
  if [ "$2" == "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1 (got '$2', want '$3')"; FAILS=$((FAILS+1)); fi
}
tok() { echo "$1" | jq -r '.link // .adminLink | split("#t=")[1]'; }

new_group() { # name adminName -> prints admin token
  curl -s -X POST "$BASE/admin/groups" -H "x-setup-secret: $SECRET" -H 'content-type: application/json' \
    -d "{\"name\":\"$1\",\"admin\":{\"name\":\"$2\",\"email\":\"$2@example.com\"}}" | jq -r '.adminLink | split("#t=")[1]'
}
add_member() { # adminToken name -> prints "id token"
  req "$1" POST /api/members "{\"name\":\"$2\",\"email\":\"$2@example.com\"}"
  echo "$(echo "$BODY" | jq -r .id) $(tok "$BODY")"
}
dow() { date -u -d "$1 +$2 day" +%F; }

echo "== setup"
ALEX=$(new_group "Sunday Supper" alex)
read BEA_ID BEA < <(add_member "$ALEX" bea)
read CAL_ID CAL < <(add_member "$ALEX" cal)
req "" GET /api/me;                    check "no token -> 401" "$CODE" 401
req "bogus" GET /api/me;               check "bad token -> 401" "$CODE" 401
req "$ALEX" GET /api/me;               check "admin /me" "$(echo "$BODY" | jq -r .role)" admin
ALEX_ID=$(echo "$BODY" | jq -r .id)
check "profile incomplete until dietary set" "$(echo "$BODY" | jq -r .profileComplete)" false
req "$ALEX" PUT /api/me '{"dietary":"severe sesame allergy","address":"1 Main St"}'; check "set profile" "$CODE" 200
req "$BEA" PUT /api/me '{"dietary":""}';  check "empty dietary rejected" "$CODE" 400
req "$BEA" POST /api/members '{"name":"x","email":"x@example.com"}'; check "member without grant can't add members" "$CODE" 403
req "$ALEX" POST /api/members '{"name":"b2","email":"BEA@example.com"}'; check "duplicate email -> 409" "$CODE" 409

echo "== rotation: fixed order, cancel carry, override, skip"
req "$ALEX" POST /api/dinners/schedule-next; D1=$(echo "$BODY" | jq -r .date); H1=$(echo "$BODY" | jq -r .hostId); ID1=$(echo "$BODY" | jq -r .id)
req "$ALEX" POST /api/dinners/schedule-next; D2=$(echo "$BODY" | jq -r .date); H2=$(echo "$BODY" | jq -r .hostId); ID2=$(echo "$BODY" | jq -r .id)
check "first turn is first member (Alex), not Bea" "$([ "$H1" != "$BEA_ID" ] && [ "$H1" != "$CAL_ID" ] && echo y)" y
check "second turn is Bea" "$H2" "$BEA_ID"
check "dinners are a week apart" "$(( ( $(date -u -d "$D2" +%s) - $(date -u -d "$D1" +%s) ) / 86400 ))" 7
req "$CAL" POST "/api/dinners/$ID2/cancel";  check "non-host can't cancel" "$CODE" 403
req "$BEA" POST "/api/dinners/$ID2/cancel" '{"reason":"flu"}'; check "host can cancel own dinner" "$CODE" 200
req "$ALEX" POST /api/dinners/schedule-next; D3=$(echo "$BODY" | jq -r .date); ID3=$(echo "$BODY" | jq -r .id)
check "cancelled week isn't refilled: next date is a week later" "$D3" "$(dow "$D2" 7)"
check "cancelled host (Bea) keeps their turn" "$(echo "$BODY" | jq -r .hostId)" "$BEA_ID"
req "$BEA" PUT "/api/dinners/$ID3/host" "{\"hostId\":\"$CAL_ID\"}"; check "member can't override host" "$CODE" 403
req "$ALEX" PUT "/api/dinners/$ID3/host" "{\"hostId\":\"$CAL_ID\"}"; check "admin overrides host" "$CODE" 200
req "$ALEX" POST /api/dinners/schedule-next; D4=$(echo "$BODY" | jq -r .date)
check "override doesn't shift turns: next turn is Cal (after Bea)" "$(echo "$BODY" | jq -r .hostId)" "$CAL_ID"
req "$ALEX" POST /api/skips "{\"date\":\"$(dow "$D4" 7)\"}"; check "skip a week" "$CODE" 201
req "$ALEX" POST /api/skips "{\"date\":\"$D1\"}"; check "can't skip a day with a dinner" "$CODE" 409
req "$ALEX" POST /api/dinners/schedule-next; D6=$(echo "$BODY" | jq -r .date)
check "skipped week is passed over" "$D6" "$(dow "$D4" 14)"
check "skip consumed no turn: back to Alex" "$(echo "$BODY" | jq -r .hostId)" "$H1"

echo "== permissions"
req "$ALEX" PUT "/api/members/$BEA_ID" '{"permissions":["schedule_dinners"]}'; check "admin grants a permission" "$CODE" 200
req "$BEA" POST /api/dinners/schedule-next; check "granted member can schedule" "$CODE" 201
req "$BEA" PUT "/api/members/$CAL_ID" '{"role":"admin"}'; check "non-admin can't promote" "$CODE" 403
req "$ALEX" PUT /api/group '{"memberPermissions":["skip_weeks"]}'; check "group default grants" "$CODE" 200
req "$CAL" POST /api/skips "{\"date\":\"$(dow "$D6" 70)\"}"; check "default grant applies to members" "$CODE" 201
req "$ALEX" PUT "/api/members/$ALEX_ID" '{"active":false}'
check "can't deactivate the last admin" "$CODE" 409
req "$ALEX" PUT "/api/members/order" "{\"ids\":[\"$CAL_ID\",\"$BEA_ID\"]}"; check "order must list everyone" "$CODE" 400

echo "== dinner detail & privacy"
req "$ALEX" PUT "/api/dinners/$ID1" '{"menu":"Pasta","menuMode":"both"}'; check "host edits menu" "$CODE" 200
req "$CAL" PUT "/api/dinners/$ID1" '{"menu":"Nope"}'; check "non-host can't edit menu" "$CODE" 403
req "$BEA" GET "/api/dinners/$ID1"
check "address visible to members" "$(echo "$BODY" | jq -r .address)" "1 Main St"
check "dietary hidden from non-host" "$(echo "$BODY" | jq 'has("dietary") and (.dietary != null)')" false
req "$ALEX" GET "/api/dinners/$ID1"; check "dietary key present for host" "$(echo "$BODY" | jq 'has("dietary")')" true

echo "== RSVPs & guests"
req "$BEA" PUT "/api/dinners/$ID1/rsvp" '{"response":"yes"}'; check "yes requires dietary info" "$CODE" 409
check "...with a clear error code" "$(echo "$BODY" | jq -r .error)" dietary_required
req "$BEA" PUT "/api/dinners/$ID1/rsvp" '{"response":"maybe"}'; check "maybe doesn't" "$CODE" 200
req "$BEA" PUT /api/me '{"dietary":"none"}'
req "$BEA" PUT "/api/dinners/$ID1/rsvp" '{"response":"yes"}'; check "yes after setting dietary ('none' counts)" "$CODE" 200
req "$ALEX" PUT "/api/dinners/$ID1/rsvp" '{"response":"yes"}'; check "host RSVPs yes" "$CODE" 200
req "$BEA" PUT "/api/dinners/$ID2/rsvp" '{"response":"yes"}'; check "can't RSVP to a cancelled dinner" "$CODE" 409
req "$BEA" POST "/api/dinners/$ID1/guests" '{"name":"Pat","email":"pat@example.com","dietary":"peanut allergy"}'; check "member adds a guest with contact" "$CODE" 201
GUEST=$(echo "$BODY" | jq -r .id)
req "$BEA" POST "/api/dinners/$ID1/guests" '{"name":"Bad","email":"not-an-email"}'; check "guest email validated" "$CODE" 400
req "$ALEX" GET "/api/dinners/$ID1"
check "headcount = 2 members + 1 guest" "$(echo "$BODY" | jq .headcount)" 3
check "host sees dietary needs (sesame + peanut; 'none' omitted)" "$(echo "$BODY" | jq '.dietary|map(.dietary)|sort|join(",")' -r)" "peanut allergy,severe sesame allergy"
check "guest contact details are not exposed" "$(echo "$BODY" | jq '.guests[0]|has("email")')" false
req "$CAL" DELETE "/api/dinners/$ID1/guests/$GUEST"; check "other member can't remove someone's guest" "$CODE" 403
req "$BEA" PUT "/api/dinners/$ID1/guests/$GUEST" '{"response":"no"}'; check "inviter updates guest response" "$CODE" 200
req "$ALEX" DELETE "/api/dinners/$ID1/guests/$GUEST"; check "host removes guest" "$CODE" 200

echo "== multi-tenancy isolation"
OTHER=$(new_group "Other Group" zed)
req "$OTHER" GET "/api/dinners/$ID1";            check "other group can't read dinner" "$CODE" 404
req "$OTHER" PUT "/api/dinners/$ID1/rsvp" '{"response":"yes"}'; check "other group can't RSVP" "$CODE" 404
req "$OTHER" POST "/api/dinners/$ID1/cancel";    check "other group can't cancel" "$CODE" 404
req "$OTHER" PUT "/api/members/$BEA_ID" '{"active":false}'; check "other group can't edit members" "$CODE" 404
req "$OTHER" GET /api/dinners;                   check "other group sees no dinners" "$(echo "$BODY" | jq '.dinners|length')" 0

echo
[ "$FAILS" -eq 0 ] && echo "ALL PASSED" || { echo "$FAILS FAILED"; exit 1; }
