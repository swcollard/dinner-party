-- Every table carries group_id so the app can become multi-tenant without a rewrite.

CREATE TABLE groups (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  timezone   TEXT NOT NULL DEFAULT 'America/Chicago',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE members (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id),
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  dietary    TEXT,            -- free text: allergies / restrictions
  address    TEXT,            -- shown to members only, only for their hosted dinners
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (group_id, email)
);

CREATE TABLE dinners (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id),
  host_id    TEXT NOT NULL REFERENCES members(id),
  date       TEXT NOT NULL,   -- YYYY-MM-DD in the group's timezone
  start_time TEXT NOT NULL DEFAULT '18:00',
  menu       TEXT,
  notes      TEXT,
  status     TEXT NOT NULL DEFAULT 'scheduled'
               CHECK (status IN ('scheduled', 'cancelled', 'done')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (group_id, date)
);

CREATE TABLE rsvps (
  dinner_id  TEXT NOT NULL REFERENCES dinners(id) ON DELETE CASCADE,
  member_id  TEXT NOT NULL REFERENCES members(id),
  response   TEXT NOT NULL CHECK (response IN ('yes', 'no', 'maybe')),
  guests     INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (dinner_id, member_id)
);

-- Passwordless login: hashed one-time tokens emailed to members.
CREATE TABLE login_tokens (
  token_hash TEXT PRIMARY KEY,
  member_id  TEXT NOT NULL REFERENCES members(id),
  expires_at TEXT NOT NULL,
  used_at    TEXT
);

CREATE INDEX idx_dinners_group_date ON dinners(group_id, date);
CREATE INDEX idx_members_group ON members(group_id);
