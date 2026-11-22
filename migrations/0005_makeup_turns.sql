-- A make-up dinner repays a cancelled dinner's turn. Make-ups sit outside the regular
-- order, so they never move the rotation pointer. The unique index allows at most one
-- make-up per cancelled dinner (two organizers racing get a clean 409).
-- Existing data: no deployment has cancellations yet, so nothing is backfilled.
ALTER TABLE dinners ADD COLUMN makeup_for TEXT REFERENCES dinners(id);
CREATE UNIQUE INDEX idx_dinners_makeup_for ON dinners(makeup_for);
