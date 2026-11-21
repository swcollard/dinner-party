#!/usr/bin/env bash
# End-to-end smoke test against a running `wrangler dev` (local D1, migrations applied).
#   npm run db:migrate:local && npm run dev   # in another terminal
#   SETUP_SECRET=... BASE=http://localhost:8787 scripts/smoke.sh
# Creates fresh groups on every run, so it is safe to repeat.
set -u
BASE=${BASE:-http://localhost:8787}
SECRET=${SETUP_SECRET:-devsecret}
FAILS=0
ROOT=$(cd "$(dirname "$0")/.." && pwd)

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
# Fire the hourly cron once (needs `wrangler dev --test-scheduled`).
trigger() { curl -s -o /dev/null "$BASE/cdn-cgi/handler/scheduled?cron=0+*+*+*+*"; sleep 2; }
# Run SQL against the local D1 (test setup only: lets us back-date a dinner).
local_sql() { (cd "$ROOT" && npx wrangler d1 execute DB --local --command "$1" >/dev/null 2>&1); }

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
req "$BEA" PUT "/api/dinners/$ID1/rsvp" '{"response":"maybe"}'; check "maybe requires dietary info too (it appears in the host's list)" "$CODE" 409
req "$BEA" PUT "/api/dinners/$ID1/rsvp" '{"response":"no"}'; check "declining doesn't need it" "$CODE" 200
req "$BEA" PUT /api/me '{"dietary":"none"}'
req "$BEA" PUT "/api/dinners/$ID1/rsvp" '{"response":"yes"}'; check "yes after setting dietary ('none' counts)" "$CODE" 200
req "$ALEX" PUT "/api/dinners/$ID1/rsvp" '{"response":"yes"}'; check "host RSVPs yes" "$CODE" 200
req "$BEA" PUT "/api/dinners/$ID2/rsvp" '{"response":"yes"}'; check "can't RSVP to a cancelled dinner" "$CODE" 409
req "$BEA" POST "/api/dinners/$ID1/guests" '{"name":"Pat","email":"pat@example.com","dietary":"peanut allergy"}'; check "member adds a guest with contact" "$CODE" 201
GUEST=$(echo "$BODY" | jq -r .id)
req "$BEA" POST "/api/dinners/$ID1/guests" '{"name":"Bad","email":"not-an-email"}'; check "guest email validated" "$CODE" 400
req "$BEA" GET /api/dinners; check "dinner list includes my own RSVP" "$(echo "$BODY" | jq -r --arg id "$ID1" '.dinners[]|select(.id==$id)|.my_response')" yes
req "$ALEX" GET "/api/dinners/$ID1"
check "headcount = 2 members + 1 guest" "$(echo "$BODY" | jq .headcount)" 3
check "host sees dietary needs (sesame + peanut; 'none' omitted)" "$(echo "$BODY" | jq '.dietary|map(.dietary)|sort|join(",")' -r)" "peanut allergy,severe sesame allergy"
check "guest contact details are not exposed" "$(echo "$BODY" | jq '.guests[0]|has("email")')" false
req "$BEA" POST "/api/dinners/$ID1/guests" '{"name":"Sam"}'; SAM=$(echo "$BODY" | jq -r .id)
req "$ALEX" GET "/api/dinners/$ID1"
check "a guest with no dietary info shows as 'not provided' to the host" "$(echo "$BODY" | jq -r '.dietary[]|select(.name=="Sam")|.dietary')" "not provided"
req "$ALEX" DELETE "/api/dinners/$ID1/guests/$SAM"
req "$CAL" DELETE "/api/dinners/$ID1/guests/$GUEST"; check "other member can't remove someone's guest" "$CODE" 403
req "$BEA" PUT "/api/dinners/$ID1/guests/$GUEST" '{"response":"no"}'; check "inviter updates guest response" "$CODE" 200
req "$ALEX" DELETE "/api/dinners/$ID1/guests/$GUEST"; check "host removes guest" "$CODE" 200

echo "== potluck / menu modes"
req "$ALEX" POST /api/dinners/schedule-next; HOSTONLY=$(echo "$BODY" | jq -r .id)
req "$BEA" POST "/api/dinners/$HOSTONLY/dishes" '{"description":"Salad"}'; check "host-menu dinner rejects dish sign-ups" "$CODE" 409
req "$BEA" POST "/api/dinners/$ID1/dishes" '{"course":"dessert","description":"Lemon tart","dietaryNotes":"contains gluten"}'; check "dish sign-up on a 'both' dinner" "$CODE" 201
DISH=$(echo "$BODY" | jq -r .id)
req "$BEA" POST "/api/dinners/$ID1/dishes" '{"course":"brunch","description":"x"}'; check "unknown course rejected" "$CODE" 400
req "$CAL" DELETE "/api/dinners/$ID1/dishes/$DISH"; check "others can't remove your dish" "$CODE" 403
req "$BEA" GET "/api/dinners/$ID1"; check "detail lists the dish with its notes" "$(echo "$BODY" | jq -r '.dishes[0]|"\(.member_name):\(.description):\(.dietary_notes)"')" "bea:Lemon tart:contains gluten"
req "$ALEX" DELETE "/api/dinners/$ID1/dishes/$DISH"; check "host can remove a dish" "$CODE" 200

echo "== calendar feed"
req "$BEA" GET /api/me; FEED=$(echo "$BODY" | jq -r .calendarUrl | sed "s#^[^/]*//[^/]*##")
ICS=$(curl -s "$BASE$FEED"); ICS_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$FEED")
check "member's secret feed URL works" "$ICS_CODE" 200
check "feed has events with the host's address" "$([ "$(echo "$ICS" | grep -c 'LOCATION:1 Main St')" -ge 1 ] && echo y)" y
check "feed omits cancelled dinners" "$(echo "$ICS" | grep -c "DTSTART:$(echo "$D2" | tr -d -)")" 0
check "wrong token -> 404" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/calendar/nope/dinners.ics")" 404
OTHER_FEED=$(req "$(new_group "Third" tess)" GET /api/me; echo "$BODY" | jq -r .calendarUrl | sed "s#^[^/]*//[^/]*##")
check "other group's feed has none of our dinners" "$(curl -s "$BASE$OTHER_FEED" | grep -c VEVENT)" 0

echo "== link reissue & calendar token rotation"
req "$ALEX" POST "/api/members/$BEA_ID/link"; NEWBEA=$(tok "$BODY")
check "admin gets the new link back" "$([ -n "$NEWBEA" ] && echo y)" y
req "$BEA" GET /api/me; check "old link is revoked" "$CODE" 401
req "$NEWBEA" GET /api/me; check "new link works" "$CODE" 200
NEW_FEED=$(echo "$BODY" | jq -r .calendarUrl | sed "s#^[^/]*//[^/]*##")
check "old calendar URL stops working" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE$FEED")" 404
check "new calendar URL works" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE$NEW_FEED")" 200
BEA=$NEWBEA
req "$CAL" POST "/api/members/$BEA_ID/link"; check "member without manage_members can't reissue others'" "$CODE" 403
req "$ALEX" PUT "/api/members/$CAL_ID" '{"permissions":["manage_members"]}'
read DEE_ID DEE < <(add_member "$ALEX" dee)   # a throwaway target: with email configured the delegate's reissue succeeds and revokes it
req "$CAL" POST "/api/members/$DEE_ID/link"
check "a delegate is never handed someone else's link" "$(echo "$BODY" | jq 'has("link")')" false
req "$CAL" POST "/api/members/$ALEX_ID/link"; check "a delegate can't touch an admin's link" "$CODE" 403
req "$CAL" POST "/api/members/$CAL_ID/link"; check "anyone can reissue their own" "$CODE" 200; CAL=$(tok "$BODY")

echo "== past dinners are closed, then marked done"
req "$ALEX" POST /api/dinners/schedule-next; PAST=$(echo "$BODY" | jq -r .id)
local_sql "UPDATE dinners SET date='2020-01-05' WHERE id='$PAST'"
req "$ALEX" GET "/api/dinners/$PAST"; check "back-dated dinner is now in the past (test setup worked)" "$(echo "$BODY" | jq -r .date)" 2020-01-05
check "address is hidden once the dinner has passed" "$(echo "$BODY" | jq '.address')" null
req "$BEA" PUT "/api/dinners/$PAST/rsvp" '{"response":"no"}';        check "can't RSVP to a past dinner" "$CODE" 409
check "...with a clear reason" "$(echo "$BODY" | jq -r .error)" "dinner is in the past"
req "$BEA" POST "/api/dinners/$PAST/guests" '{"name":"Late"}';      check "can't add guests to a past dinner" "$CODE" 409
req "$BEA" POST "/api/dinners/$PAST/dishes" '{"description":"x"}';  check "can't add dishes to a past dinner" "$CODE" 409
req "$ALEX" PUT "/api/dinners/$PAST" '{"menu":"late edit"}';        check "can't edit a past dinner" "$CODE" 409
req "$ALEX" PUT "/api/dinners/$PAST/host" "{\"hostId\":\"$CAL_ID\"}"; check "can't change the host of a past dinner" "$CODE" 409
req "$ALEX" POST "/api/dinners/$PAST/cancel";                       check "can't cancel a past dinner" "$CODE" 409
trigger
req "$ALEX" GET "/api/dinners/$PAST"; check "hourly job marks it done" "$(echo "$BODY" | jq -r .status)" done
req "$ALEX" GET "/api/dinners/$ID1";  check "upcoming dinners are left alone" "$(echo "$BODY" | jq -r .status)" scheduled

echo "== concurrent scheduling"
RACE=$( { for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/api/dinners/schedule-next" -H "Authorization: Bearer $ALEX" & done; wait; } | sort | uniq -c | tr -s ' ' | tr '\n' ';')
check "six simultaneous schedule requests: no 500s (only 201 or 409)" "$(echo "$RACE" | grep -cE ' 5[0-9][0-9]')" 0
check "...and at least one succeeded" "$(echo "$RACE" | grep -c ' 201')" 1
echo "       ($RACE)"

echo "== multi-tenancy isolation"
OTHER=$(new_group "Other Group" zed)
req "$OTHER" GET "/api/dinners/$ID1";            check "other group can't read dinner" "$CODE" 404
req "$OTHER" PUT "/api/dinners/$ID1/rsvp" '{"response":"yes"}'; check "other group can't RSVP" "$CODE" 404
req "$OTHER" POST "/api/dinners/$ID1/cancel";    check "other group can't cancel" "$CODE" 404
req "$OTHER" PUT "/api/members/$BEA_ID" '{"active":false}'; check "other group can't edit members" "$CODE" 404
req "$OTHER" GET /api/dinners;                   check "other group sees no dinners" "$(echo "$BODY" | jq '.dinners|length')" 0

# Reminders need a mock email server and `wrangler dev --test-scheduled`:
#   scripts/mock-email.py /tmp/emails.jsonl 9999 &
#   .dev.vars: RESEND_API_KEY=test, EMAIL_API_URL=http://localhost:9999/emails
#   MOCK_EMAIL_LOG=/tmp/emails.jsonl scripts/smoke.sh
if [ -n "${MOCK_EMAIL_LOG:-}" ]; then
  echo "== notifications (mock email)"
  RUN=$RANDOM
  sent_to() { jq -c --arg to "$1" 'select(.to[0]==$to)' "$MOCK_EMAIL_LOG" | wc -l | tr -d ' '; }
  subjects() { jq -r --arg to "$1" 'select(.to[0]==$to)|.subject' "$MOCK_EMAIL_LOG" | sort | tr '\n' '|'; }
  TOKR=$(curl -s -X POST "$BASE/admin/groups" -H "x-setup-secret: $SECRET" -H 'content-type: application/json' \
    -d "{\"name\":\"Reminders\",\"admin\":{\"name\":\"host$RUN\",\"email\":\"host$RUN@example.com\"}}" | jq -r '.adminLink | split("#t=")[1]')
  TOMORROW_DOW=$(TZ=America/Chicago date -d tomorrow +%w)
  req "$TOKR" PUT /api/group "{\"dinnerWeekday\":$TOMORROW_DOW,\"reminderHour\":0,\"rsvpDeadlineDays\":1}"
  req "$TOKR" PUT /api/me '{"dietary":"none","address":"9 Elm St"}'
  req "$TOKR" POST /api/members "{\"name\":\"yes$RUN\",\"email\":\"yes$RUN@example.com\"}"; YES=$(tok "$BODY")
  req "$TOKR" POST /api/members "{\"name\":\"quiet$RUN\",\"email\":\"quiet$RUN@example.com\"}"; QUIET_ID=$(echo "$BODY" | jq -r .id); QUIET=$(tok "$BODY")
  req "$YES" PUT /api/me '{"dietary":"none"}'
  req "$TOKR" POST /api/dinners/schedule-next; RD=$(echo "$BODY" | jq -r .id)
  check "dinner lands on tomorrow (group timezone)" "$(echo "$BODY" | jq -r .date)" "$(TZ=America/Chicago date -d tomorrow +%F)"
  req "$YES" PUT "/api/dinners/$RD/rsvp" '{"response":"yes"}'
  req "$YES" POST "/api/dinners/$RD/guests" "{\"name\":\"Pat\",\"email\":\"pat$RUN@example.com\"}"
  sleep 1
  check "new members get an invite email with their link" "$(jq -r --arg to "quiet$RUN@example.com" 'select(.to[0]==$to)|.text' "$MOCK_EMAIL_LOG" | grep -c '#t=')" 1
  check "new host is told it's their turn" "$(subjects "host$RUN@example.com")" "You're hosting Reminders on $(date -u -d "$(TZ=America/Chicago date -d tomorrow +%F)" +'%A, %b %-d')|"
  trigger
  check "host gets day-before reminder" "$(subjects "host$RUN@example.com" | grep -c "Tomorrow: dinner at host$RUN's")" 1
  check "'yes' member gets day-before reminder" "$(subjects "yes$RUN@example.com" | grep -c "Tomorrow: dinner at host$RUN's")" 1
  check "guest with an email gets day-before reminder" "$(subjects "pat$RUN@example.com")" "Tomorrow: dinner at host$RUN's|"
  check "non-responder gets the RSVP reminder, not the day-before one" "$(subjects "quiet$RUN@example.com" | tr '|' '\n' | grep -c 'RSVP today')" 1
  check "day-before email includes the address" "$(jq -r --arg to "yes$RUN@example.com" 'select(.to[0]==$to)|.text' "$MOCK_EMAIL_LOG" | grep -c 'Where: 9 Elm St')" 1
  check "RSVP reminder does not include the address" "$(jq -r --arg to "quiet$RUN@example.com" 'select(.to[0]==$to and (.subject|startswith("RSVP")))|.text' "$MOCK_EMAIL_LOG" | grep -c '9 Elm St')" 0
  BEFORE=$(wc -l < "$MOCK_EMAIL_LOG")
  trigger
  check "re-running the cron sends nothing twice" "$(( $(wc -l < "$MOCK_EMAIL_LOG") - BEFORE ))" 0

  echo "== delegated link reissue is emailed, not returned"
  req "$TOKR" POST /api/members "{\"name\":\"dele$RUN\",\"email\":\"dele$RUN@example.com\"}"; DELE_ID=$(echo "$BODY" | jq -r .id); DELE=$(tok "$BODY")
  req "$TOKR" PUT "/api/members/$DELE_ID" '{"permissions":["manage_members"]}'
  req "$DELE" POST "/api/members/$QUIET_ID/link"
  check "delegate gets no link in the response" "$(echo "$BODY" | jq -c '{sent, hasLink: has("link")}')" '{"sent":true,"hasLink":false}'
  NEWQ=$(jq -r --arg to "quiet$RUN@example.com" 'select(.to[0]==$to and (.subject|startswith("Your new")))|.text' "$MOCK_EMAIL_LOG" | grep -o '#t=[A-Za-z0-9_-]*' | tail -1 | cut -c4-)
  check "the member receives the new link by email" "$([ -n "$NEWQ" ] && echo y)" y
  req "$NEWQ" GET /api/me; check "emailed link works" "$CODE" 200
  req "$QUIET" GET /api/me; check "member's previous link was revoked" "$CODE" 401
fi

echo
[ "$FAILS" -eq 0 ] && echo "ALL PASSED" || { echo "$FAILS FAILED"; exit 1; }
