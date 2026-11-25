-- Timestamps are UTC milliseconds.
CREATE TABLE group_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  default_courses TEXT NOT NULL
);

CREATE TABLE people (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('member', 'guest')),
  name TEXT NOT NULL,
  phone TEXT,
  is_organizer INTEGER NOT NULL DEFAULT 0,
  texts_opt_out INTEGER NOT NULL DEFAULT 0,
  link_version INTEGER NOT NULL DEFAULT 1,
  removed_at INTEGER
);

CREATE TABLE dietary_needs (
  id INTEGER PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('allergen', 'diet', 'other')),
  label TEXT NOT NULL,
  UNIQUE (person_id, kind, label)
);

CREATE TABLE seasons (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  cadence TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL
);

CREATE TABLE season_hosts (
  season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (season_id, position)
);

CREATE TABLE dinners (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  season_id INTEGER REFERENCES seasons(id),
  host_id INTEGER NOT NULL REFERENCES people(id),
  title TEXT NOT NULL,
  starts_at INTEGER,
  location TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  capacity INTEGER CHECK (capacity IS NULL OR capacity > 0),
  status TEXT NOT NULL CHECK (status IN ('planning', 'polling', 'confirmed', 'cancelled')),
  rsvp_closed INTEGER NOT NULL DEFAULT 0,
  CHECK (status <> 'confirmed' OR starts_at IS NOT NULL)
);

CREATE TABLE poll_options (
  id INTEGER PRIMARY KEY,
  dinner_id INTEGER NOT NULL REFERENCES dinners(id) ON DELETE CASCADE,
  starts_at INTEGER NOT NULL,
  UNIQUE (dinner_id, starts_at)
);

CREATE TABLE poll_votes (
  option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  vote TEXT NOT NULL CHECK (vote IN ('yes', 'maybe', 'no')),
  PRIMARY KEY (option_id, person_id)
);

CREATE TABLE invitations (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  dinner_id INTEGER NOT NULL REFERENCES dinners(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id),
  rsvp TEXT CHECK (rsvp IN ('yes', 'maybe', 'no')),
  replied_at INTEGER,
  link_version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (dinner_id, person_id)
);

-- One row per seat wanted. Seats go in (queued_at, id) order, so the waitlist is never stored.
CREATE TABLE attendees (
  id INTEGER PRIMARY KEY,
  dinner_id INTEGER NOT NULL REFERENCES dinners(id) ON DELETE CASCADE,
  invitation_id INTEGER NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  person_id INTEGER REFERENCES people(id),
  plus_one_name TEXT,
  diet TEXT NOT NULL DEFAULT '[]',
  queued_at INTEGER NOT NULL,
  CHECK ((person_id IS NULL) <> (plus_one_name IS NULL)),
  UNIQUE (invitation_id, person_id)
);

CREATE TABLE courses (
  id INTEGER PRIMARY KEY,
  dinner_id INTEGER NOT NULL REFERENCES dinners(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE slots (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  assignee_id INTEGER REFERENCES people(id),
  assignment_status TEXT CHECK (assignment_status IN ('proposed', 'accepted'))
);

CREATE TABLE recipes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES people(id)
);

-- UNIQUE slot_id settles two people claiming at once; NULL means a free-form item.
CREATE TABLE dishes (
  id INTEGER PRIMARY KEY,
  dinner_id INTEGER NOT NULL REFERENCES dinners(id) ON DELETE CASCADE,
  slot_id INTEGER UNIQUE REFERENCES slots(id),
  person_id INTEGER NOT NULL REFERENCES people(id),
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  recipe_id INTEGER REFERENCES recipes(id)
);

CREATE TABLE dish_tags (
  dish_id INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (dish_id, tag)
);

CREATE TABLE announcements (
  id INTEGER PRIMARY KEY,
  dinner_id INTEGER NOT NULL REFERENCES dinners(id) ON DELETE CASCADE,
  audience TEXT NOT NULL CHECK (audience IN ('all', 'confirmed', 'no_reply')),
  body TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES people(id),
  marked_sent_at INTEGER
);

CREATE TABLE notices (
  id INTEGER PRIMARY KEY,
  dinner_id INTEGER REFERENCES dinners(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('change', 'drop', 'opening', 'assignment')),
  body TEXT NOT NULL,
  dismissed_at INTEGER
);

CREATE INDEX invitations_person ON invitations(person_id);
CREATE INDEX attendees_queue ON attendees(dinner_id, queued_at, id);
CREATE INDEX dishes_dinner ON dishes(dinner_id);
CREATE INDEX notices_person ON notices(person_id, dismissed_at);
