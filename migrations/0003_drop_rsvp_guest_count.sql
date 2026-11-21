-- Plus-ones are now named rows in `guests` (with optional email/phone for reminders),
-- so the anonymous per-RSVP headcount is redundant.
ALTER TABLE rsvps DROP COLUMN guests;
