-- Reminders and plans a child sets up with a buddy ("remind me at 8am to pack my PE kit", "every weekday at 4 quiz me
-- on times tables"). A reminder is a fixed message; a task runs a buddy turn. `rule_json` is
-- {"repeat":"once","date":"YYYY-MM-DD","time":"HH:MM"} or {"repeat":"weekly","days":[1,2,3,4,5],"time":"HH:MM"}
-- (0 = Sunday), in the household machine's local time.
CREATE TABLE schedules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id    TEXT NOT NULL REFERENCES children(id),
  buddy_id    INTEGER NOT NULL REFERENCES buddies(id),
  kind        TEXT NOT NULL CHECK (kind IN ('reminder','task')),
  label       TEXT NOT NULL,
  text        TEXT NOT NULL,
  rule_json   TEXT NOT NULL,
  -- proposed: waiting for the child to confirm; active; paused (by the child or parent); done (a one-off that ran or
  -- was missed); cancelled.
  status      TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','active','paused','done','cancelled')),
  next_at     TEXT,
  last_run_at TEXT,
  last_result TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX schedules_due ON schedules(status, next_at);

-- Browsers a child's device has let OpenBuddies send notifications to (Web Push).
CREATE TABLE push_subscriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id   INTEGER NOT NULL REFERENCES devices(id),
  endpoint    TEXT NOT NULL UNIQUE,
  keys_json   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
