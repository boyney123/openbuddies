-- Things a buddy said on its own (a reminder going off, a plan, a daily check-in) that the child hasn't seen yet: shown
-- in the buddy's speech bubble on the home screen until they open the chat.
CREATE TABLE nudges (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id    TEXT NOT NULL REFERENCES children(id),
  buddy_id    INTEGER NOT NULL REFERENCES buddies(id),
  kind        TEXT NOT NULL CHECK (kind IN ('reminder','plan','checkin')),
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  seen_at     TEXT
);
CREATE INDEX nudges_unseen ON nudges(child_id, seen_at);
