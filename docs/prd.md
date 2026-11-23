# Dinner Club App: Product Requirements Document

Nov 23, 2026 · @Sam Collard

## Overview

Dinner Club is a lightweight web app that lets one friend group plan a recurring series of dinner parties in a single place: pick dates, collect RSVPs, claim potluck dishes, plan the menu, and send text announcements. It replaces three tools the group uses today with one that is simpler than any of them.

**Today's setup and where it hurts**

- **WhatsApp / iMessage group chat** handles logistics, but dates, headcounts and "who's bringing what" get buried in banter.
- **Partiful** handles invites and RSVPs, but has no potluck or menu planning and doesn't understand a recurring series.
- **Google Sheets** handles potluck and menu planning, but is clumsy on a phone and sits apart from the invite.

**Product bet:** a friend group will switch if the app is faster to use than the chat thread it replaces, never asks anyone to create an account, and puts date, RSVP, dishes and dietary needs on one page per dinner.

**Deliberate boundary:** conversation between guests stays in WhatsApp. The app is the source of truth for logistics; it does not become another chat.

## Goals, non-goals and principles

The app succeeds if planning a dinner takes less effort than it does in the group chat today, and if nobody ever has to be taught how to use it.

**Goals**

1. Anyone in the group can open their link and finish their task (RSVP, claim a dish) in under 30 seconds, with no sign-up.
2. A host can set up a dinner, invite the group and see headcount, dishes and dietary needs on one screen.
3. The group can see a whole season of dinners, who hosts each, and what was served in the past.
4. Announcements and reminders reach people by text without the host retyping them.

**Non-goals**

- Replacing the WhatsApp group chat or building any messaging between guests.
- Supporting many unrelated groups, public events or strangers (one core friend group, with occasional guests).
- Photo sharing, cost splitting and shopping lists (see Scope).

**Design principles**

1. **Ease of use beats everything.** If a feature adds a step to the common path, it needs a strong reason.
2. **No accounts, no passwords.** Identity comes from a personal link.
3. **Phone first.** Most people will open it from a text message on a phone.
4. **One page per dinner.** Date, guests, dishes, menu and notes live together, not in separate tools.
5. **Show what's missing.** The app should make gaps obvious (no dessert yet, three people haven't replied) so the host doesn't have to count.
6. **Light, not heavy.** Fewer settings and fewer screens; sensible defaults over configuration.

## Users and roles

The primary audience is a single, fixed group of friends. Roles are lightweight and attach to a person for a given dinner, not to the whole app.

| Role | Who | What they do |
| --- | --- | --- |
| Member | Everyone in the core group | Has a personal link, sets their profile and dietary needs, RSVPs, claims dishes |
| Host | The member hosting a given dinner (changes each time) | Sets date and details, manages the guest list and menu, sends announcements |
| Group organizer | One or two trusted members | Adds or removes members, sets up the season and host rotation, fixes anything that goes wrong |
| Guest | A plus-one or one-off invitee | Gets a link for a single dinner; can RSVP and claim a dish, but isn't part of the group |

## Access and identity

Nobody creates an account. Each person gets a personal link that recognizes them, and that link is the only credential.

**Requirements**

1. The organizer adds a member by name and phone number; the app texts them their personal link.
2. Opening the link takes the person straight into the app as themselves, with no password, code entry or sign-up form.
3. A link works on any device the person opens it from. If someone gets a new phone, they can ask for the link again by text.
4. A guest invited to one dinner gets a link that only opens that dinner.
5. The organizer can revoke a link and issue a new one (for example, a lost or forwarded phone).
6. Anyone without a valid link sees nothing about the group, its dinners or its members.

**Security expectations**

The data is low sensitivity (names, phone numbers, dietary needs, dates), so the goal is "private among friends," not high-security. Even so, links must be hard to guess, and the app must never expose one member's phone number or dietary information to anyone outside the group.

**Open point:** whether a forwarded link should be usable by someone else is a trade-off between convenience and safety (see Open questions).

## Core concepts

Five things make up the whole product. Keeping the model this small is what keeps the app feeling light.

| Concept | What it is |
| --- | --- |
| Group | The one friend group: its members, their dietary needs, and its history of dinners |
| Season (series) | A run of planned dinners, such as "Winter 2027," with a cadence and a host rotation |
| Dinner (event) | One evening: date, time, host, location, guest list, dishes, menu and notes |
| Dish | One item on a dinner's menu, either claimed by a member (potluck) or assigned by the host (planned menu) |
| Member | A person with a personal link, a profile and dietary needs |

## Feature requirements

Requirements are marked **v1** (must ship in the first version) or **later**. Everything in v1 serves the dinner lifecycle: schedule it, confirm who's coming, decide who brings or cooks what, and keep everyone informed.

### 1. Scheduling

1. **Host picks a date (v1).** A host can create a dinner with a fixed date, time, location and note in under a minute.
2. **Availability poll (v1).** A host can instead offer two to five candidate dates. Members mark each as yes, maybe or no, and the app shows the best date at a glance. The host confirms one, which turns the poll into a dinner.
3. **Recurring and rotating (v1).** An organizer can define a season with a cadence (for example, monthly on the first Saturday) and a host order. The app creates the placeholder dinners and shows whose turn it is.
4. **Season view (v1).** One screen lists upcoming dinners with date, host and status (planning, confirmed, past).
5. **Calendar export (v1).** Each confirmed dinner can be added to the member's own calendar in one tap.
6. **Changes are announced (v1).** If a date, time or place changes, members who said yes are notified.

### 2. RSVP and headcount

1. **One-tap RSVP (v1).** Yes, maybe or no, changeable any time until the host closes the list.
2. **Plus-ones (v1).** A member can add guests by name, with their dietary needs. Guests count toward headcount.
3. **Live headcount (v1).** The host sees confirmed, maybe, declined and no-reply counts, and who hasn't answered.
4. **Capacity (v1).** The host can set a maximum. When it's full, further yeses go to a waitlist.
5. **Nudges (v1).** The host can text everyone who hasn't replied with one tap.

### 3. Potluck sign-up and menu planning

Potluck and menu planning are one feature with two ways to use it, so the group never needs a separate spreadsheet. A dinner's menu is a list of courses (for example starter, main, sides, dessert, drinks). Each course has one or more slots.

1. **Host sets the shape (v1).** The host starts from a default course list, edits it, and sets how many dishes each course needs. A "fully hosted" dinner can leave all slots assigned to the host.
2. **Claim a slot (v1).** A member taps an open slot, types what they're bringing and optionally a note or recipe link. It appears for everyone immediately.
3. **Host assigns (v1).** The host can assign a slot to a specific member ("Sam, you're on dessert"), who can accept or swap.
4. **Gaps and duplicates are visible (v1).** The page shows unclaimed slots and warns when two people claim the same kind of dish.
5. **Free-form items (v1).** Anyone can add something outside the slots, such as a bottle of wine or ice.
6. **Change or release a claim (v1).** A member can edit or drop their own dish at any time; if they drop one after confirming, the host is told.
7. **Serving estimate (later).** The app suggests how much of each dish to make based on headcount.

### 4. Dietary needs and allergies

1. **Captured once per person (v1).** Each member sets dietary needs and allergies in their profile (for example vegetarian, nut allergy, no pork), and they carry over to every dinner.
2. **Guests too (v1).** Plus-ones and guest invitees can provide their own, or the member bringing them can.
3. **Surfaced where it matters (v1).** The host's dinner page shows a one-line summary of everyone coming who has restrictions, and each dish can be tagged (vegetarian, contains nuts).
4. **Allergy warnings (v1).** When someone claims or the host plans a dish tagged with an allergen that a confirmed guest has, the app flags it. It informs; it never blocks.

### 5. Recipes

1. **Link a recipe to a dish (v1).** A dish can carry a recipe link or pasted recipe text.
2. **Saved recipe library (v1).** Recipes attached to dishes are saved to the group's library, searchable by name, so someone can reuse a favorite.
3. **Reuse in one tap (v1).** When claiming a dish, a member can start from a saved recipe instead of typing.
4. **Scaling and shopping lists (later).** Not in v1.

### 6. Announcements and reminders by text

Text message is the only outbound channel. The app does not require people to install anything or check it on their own.

1. **Host announcements (v1).** The host writes a short message on the dinner page and sends it by text to everyone invited, to confirmed guests only, or to non-responders only.
2. **Invite text (v1).** Creating or confirming a dinner sends each member a text containing their personal link to that dinner.
3. **Automatic reminders (v1).** Configurable defaults: a nudge to non-responders a few days out, and a day-before reminder to confirmed guests with time, place and who's bringing what.
4. **Change alerts (v1).** Date, time or place changes and newly opened slots can trigger a text, and the host decides whether to send.
5. **Opt-out (v1).** Members can stop texts at any time and still use their link.
6. **Replies are not conversation.** Texts are one-way notifications that point back to the link. Discussion stays in WhatsApp.

### 7. History

1. **Past dinners (v1).** Every completed dinner stays on record with date, host, guests and the dishes served.
2. **Look back (v1).** Members can browse past dinners and find what was cooked, by whom, and with which recipe.
3. **Hosting record (later).** Counts of who has hosted and attended help keep the rotation fair.
4. **No photos.** Photo sharing is explicitly excluded.

## Permissions

The host runs the dinner; everyone controls their own contributions. The organizer can step in anywhere.

| Action | Member | Host (of that dinner) | Organizer |
| --- | --- | --- | --- |
| Create a dinner or poll | No | Yes | Yes |
| Edit date, time, place, notes | No | Yes | Yes |
| Confirm the final date from a poll | No | Yes | Yes |
| Vote in a poll, RSVP, add own plus-ones | Yes | Yes | Yes |
| Edit the course and slot structure | No | Yes | Yes |
| Claim, edit or drop own dish | Yes | Yes | Yes |
| Assign a dish to someone else | No | Yes | Yes |
| Edit or remove someone else's dish | No | Yes | Yes |
| Send announcements by text | No | Yes | Yes |
| Edit own profile and dietary needs | Yes | Yes | Yes |
| Add or remove members, reissue links | No | No | Yes |
| Set up a season and host rotation | No | No | Yes |

Past dinners are read-only to everyone except the organizer, so history can't be edited by accident.

## Key user flows

Each flow below is the target experience. If any flow takes noticeably more steps than described, it needs redesign.

**Flow A: A member RSVPs and claims a dish (the most common path)**

1. Member gets a text: "Sam is hosting Saturday, Feb 7. Tap to RSVP."
2. They tap the link and land directly on that dinner, already identified.
3. They tap Yes, optionally add a plus-one.
4. The page shows open slots; they tap "Dessert," type "Lemon tart," and save.
5. Done in under 30 seconds. The host's headcount and menu update immediately.

**Flow B: A host sets up a dinner with a date poll**

1. Host opens their link, taps New dinner, and picks Poll for date.
2. They choose three candidate dates and optionally set capacity and a default course list.
3. They send the invite by text to the whole group.
4. As votes arrive, the best date is highlighted. Host taps Confirm on one.
5. The app texts everyone the confirmed date and opens RSVP and dish sign-up.

**Flow C: A host prepares in the final week**

1. The host opens the dinner page and sees headcount, open slots and dietary notes together.
2. They nudge non-responders and assign the unclaimed main to a member.
3. The app flags a nut-containing dish because one confirmed guest has a nut allergy; the host and cook adjust.
4. The day before, an automatic reminder goes to confirmed guests with the final menu.

**Flow D: The organizer sets up a season**

1. Organizer adds members by name and phone; each gets a personal link by text.
2. They create a season with a cadence and a host order.
3. The app generates placeholder dinners and tells each host when their turn is coming.

**Flow E: Someone loses their link**

1. They ask the organizer, or request the link again by text.
2. A fresh link arrives; the old one is revoked if requested.

## Non-functional requirements

- **Mobile first.** Every screen is designed for a phone held in one hand, then scaled up. No horizontal scrolling and large tap targets.
- **Fast.** A link opens to a usable page almost immediately, including on a weak connection at a dinner party.
- **Zero learning curve.** A first-time user completes an RSVP and a dish claim without instructions, help text or a tutorial.
- **Accessible.** Readable text sizes, sufficient color contrast, screen-reader labels, and no meaning conveyed by color alone.
- **Private by default.** Only members with a valid link see anything. Phone numbers and dietary details are visible only to the people who need them (the host and the member themselves; dietary needs summarized for the host).
- **Data ownership.** The group can export its history (dinners, dishes, recipes) at any time, and the organizer can delete a member's personal data on request.
- **Dependable notifications.** Texts are sent once, not duplicated, and a failed delivery is visible to the host.
- **Forgiving.** Mistakes are easy to undo: changing an RSVP, dropping a dish, or correcting a date never requires help.

## Success metrics

This is a tool for a small group, so success is about whether the group actually switches and stays switched. Targets are proposals to confirm with the group.

| Metric | What it tells us | Proposed target |
| --- | --- | --- |
| Dinners planned fully in the app | The group has stopped using Partiful and Sheets for this | 100% of dinners after the first two |
| Response rate within 3 days of invite | RSVP is easier than the chat | At least 90% of members |
| Time from opening link to completed RSVP | Ease of use | Under 30 seconds |
| Members who claim a dish unprompted | Potluck flow is natural | Majority of confirmed guests |
| Host setup time for a new dinner | Hosting isn't a chore | Under 5 minutes |
| "Who's bringing what?" questions in WhatsApp | The app is the source of truth | Near zero |
| Qualitative check after 3 dinners | Friends actually like it | Every member says they'd keep using it |

## Scope

Version 1 covers the full dinner lifecycle for one group. Anything that doesn't serve that lifecycle waits.

| In v1 | Later | Out of scope |
| --- | --- | --- |
| Personal-link access, no accounts | Hosting and attendance stats | Messaging or chat between guests |
| Fixed-date dinners and availability polls | Serving-size suggestions and scaling | Photo sharing |
| Seasons with recurring cadence and host rotation | Shopping lists | Cost splitting and payments |
| RSVP, plus-ones, capacity and waitlist | Multiple groups | Public events and discovery |
| Potluck slots and menu planning in one view | Other notification channels (email, push) | Social features such as profiles, follows or likes |
| Dietary needs and allergy flags | Theme or cuisine suggestions | Restaurant reservations |
| Recipe links and saved recipe library |  |  |
| Text announcements and automatic reminders |  |  |
| Calendar export |  |  |
| History of past dinners |  |  |

## Open questions and risks

**Assumptions made in this draft**

- You asked for announcements "in Reminders through text." I read this as text-message announcements plus automatic reminders, both sent from the app. Tell me if you meant Apple Reminders.
- One group only. Multi-group support is deferred.
- A guest is someone invited to a single dinner, not a member.

**Open questions**

1. **Forwarded links.** If a friend forwards their link, anyone can act as them. Is that acceptable for a trusted group, or should a link be tied to the first device that opens it?
2. **Group size.** How many members and how many guests per dinner? This affects capacity and waitlist needs.
3. **Host rotation.** Is it strict (everyone takes turns) or informal (people volunteer)? Do some people never host?
4. **Menu style.** Is a typical dinner a true potluck, a host-cooked meal with a few assigned items, or a mix?
5. **Poll details.** Should a poll let people mark "maybe," or only yes and no? Is there a deadline after which the host decides?
6. **Text cost and consent.** Sending texts to friends' phones needs their consent and may carry a small per-message cost. Who covers that?
7. **Time zones and location.** Do all dinners happen in one place and time zone? Does the app need to hold an address or only a note?

**Risks**

- **Adoption.** If even one or two friends keep using the chat for logistics, the app stops being the source of truth. Mitigation: reminder texts always link back, and the host posts the link in WhatsApp.
- **Feature creep.** Each extra feature threatens the "lightweight" promise. Mitigation: every new feature must pass the 30-second test.
- **Link loss.** Without accounts, a lost link means asking someone. Mitigation: easy re-send by text.
