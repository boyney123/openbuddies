-- Study buddies. A child makes their first (main) buddy when they pair a device and can add more. Each buddy has its
-- own chat: sittings and problems belong to the buddy they were with. Removed buddies are kept for the parent's history.
CREATE TABLE buddies (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id     TEXT NOT NULL REFERENCES children(id),
  name         TEXT NOT NULL,
  color        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  subject      TEXT,
  main         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at   TEXT
);
CREATE INDEX buddies_child ON buddies(child_id, id);

ALTER TABLE children ADD COLUMN active_buddy_id INTEGER REFERENCES buddies(id);
ALTER TABLE sessions ADD COLUMN buddy_id INTEGER REFERENCES buddies(id);
ALTER TABLE problems ADD COLUMN buddy_id INTEGER REFERENCES buddies(id);
