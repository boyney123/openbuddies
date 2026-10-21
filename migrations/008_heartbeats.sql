-- The buddy check-in each child gets at most once a day (heartbeat.ts): whether it ran, and what came of it.
CREATE TABLE heartbeats (
  child_id  TEXT NOT NULL REFERENCES children(id),
  day       TEXT NOT NULL,
  ran_at    TEXT NOT NULL,
  buddy_id  INTEGER,
  result    TEXT NOT NULL,
  PRIMARY KEY (child_id, day)
);
