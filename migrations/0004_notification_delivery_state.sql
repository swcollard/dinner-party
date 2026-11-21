-- Delivery state for reminders, so a worker dying mid-send doesn't lose the reminder
-- forever and a permanently failing address isn't retried every hour.
--   pending: claimed and being sent (re-claimable if it stays pending > 10 minutes)
--   sent:    delivered
--   failed:  last attempt failed (retried until attempts reaches the cap)
-- Existing rows were only ever written after a claim and are treated as sent.
ALTER TABLE notifications ADD COLUMN status TEXT NOT NULL DEFAULT 'sent'
  CHECK (status IN ('pending', 'sent', 'failed'));
ALTER TABLE notifications ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1;
-- SQLite can't add a column with a non-constant default, so this is nullable and set by code.
ALTER TABLE notifications ADD COLUMN updated_at TEXT;
