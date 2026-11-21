-- Reworks the model for: multiple groups, fixed-order rotation with skips and
-- overrides, configurable permissions, named guests, potluck dishes,
-- personal-link auth and a notification log. Additive only (no table rebuilds).

-- Group settings -----------------------------------------------------------
ALTER TABLE groups ADD COLUMN chat_url TEXT;                                   -- e.g. WhatsApp group link
ALTER TABLE groups ADD COLUMN dinner_weekday INTEGER NOT NULL DEFAULT 0;       -- 0 = Sunday
ALTER TABLE groups ADD COLUMN default_start_time TEXT NOT NULL DEFAULT '18:00';
ALTER TABLE groups ADD COLUMN rsvp_deadline_days INTEGER NOT NULL DEFAULT 3;   -- days before dinner
ALTER TABLE groups ADD COLUMN reminder_hour INTEGER NOT NULL DEFAULT 9;        -- local hour reminders go out
-- JSON array of permission names every (non-admin) member has by default.
ALTER TABLE groups ADD COLUMN member_permissions TEXT NOT NULL DEFAULT '[]';

-- Members ------------------------------------------------------------------
ALTER TABLE members ADD COLUMN phone TEXT;
-- Fixed rotation order. Inactive members keep their slot so history stays readable.
ALTER TABLE members ADD COLUMN rotation_position INTEGER NOT NULL DEFAULT 0;
-- JSON array of extra permissions granted to this member on top of the group default.
ALTER TABLE members ADD COLUMN permissions TEXT NOT NULL DEFAULT '[]';
ALTER TABLE members ADD COLUMN notify_channels TEXT NOT NULL DEFAULT '["email"]';
-- Secret embedded in the calendar-subscription URL (calendar apps cannot send headers).
ALTER TABLE members ADD COLUMN calendar_token TEXT;
CREATE UNIQUE INDEX idx_members_calendar_token ON members(calendar_token);

-- Dinners ------------------------------------------------------------------
-- host_id is who actually hosts; rotation_host_id is whose *turn* it was.
-- They differ when the host is overridden for a single dinner, and the rotation
-- is computed from rotation_host_id so an override never shifts anyone's turn.
ALTER TABLE dinners ADD COLUMN rotation_host_id TEXT REFERENCES members(id);
ALTER TABLE dinners ADD COLUMN menu_mode TEXT NOT NULL DEFAULT 'host'
  CHECK (menu_mode IN ('host', 'potluck', 'both'));
ALTER TABLE dinners ADD COLUMN cancel_reason TEXT;

-- Weeks with no dinner. A skip is not a dinner and does not consume a turn.
CREATE TABLE skip_dates (
  group_id TEXT NOT NULL REFERENCES groups(id),
  date     TEXT NOT NULL,   -- YYYY-MM-DD
  reason   TEXT,
  PRIMARY KEY (group_id, date)
);

-- Non-member guests / plus-ones, optionally with contact details for reminders.
CREATE TABLE guests (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id),
  dinner_id  TEXT NOT NULL REFERENCES dinners(id) ON DELETE CASCADE,
  invited_by TEXT NOT NULL REFERENCES members(id),
  name       TEXT NOT NULL,
  email      TEXT,
  phone      TEXT,
  dietary    TEXT,
  response   TEXT NOT NULL DEFAULT 'yes' CHECK (response IN ('yes', 'no', 'maybe')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Potluck dishes (used when dinners.menu_mode is 'potluck' or 'both').
CREATE TABLE dishes (
  id            TEXT PRIMARY KEY,
  group_id      TEXT NOT NULL REFERENCES groups(id),
  dinner_id     TEXT NOT NULL REFERENCES dinners(id) ON DELETE CASCADE,
  member_id     TEXT NOT NULL REFERENCES members(id),
  course        TEXT NOT NULL DEFAULT 'other'
                  CHECK (course IN ('starter', 'main', 'side', 'dessert', 'drink', 'other')),
  description   TEXT NOT NULL,
  dietary_notes TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Personal-link auth: no accounts. Each member gets an unguessable link; only its
-- SHA-256 hash is stored. Links can be revoked and reissued.
DROP TABLE login_tokens;
CREATE TABLE access_tokens (
  token_hash TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id),
  member_id  TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);
CREATE INDEX idx_access_tokens_member ON access_tokens(member_id);

-- Which reminders went to whom, so cron retries never double-send.
CREATE TABLE notifications (
  dinner_id TEXT NOT NULL REFERENCES dinners(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL CHECK (kind IN ('host_assigned', 'rsvp_deadline', 'day_before', 'day_of')),
  recipient TEXT NOT NULL,   -- 'member:<id>' or 'guest:<id>'
  channel   TEXT NOT NULL,
  sent_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (dinner_id, kind, recipient, channel)
);

CREATE INDEX idx_guests_dinner ON guests(dinner_id);
CREATE INDEX idx_dishes_dinner ON dishes(dinner_id);
