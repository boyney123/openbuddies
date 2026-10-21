-- Files a child keeps with a buddy (homework photos, notes). The bytes live in data/files/; this holds what they are
-- and what the buddy can read from them (`text`: a transcription of a photo, or a text file's contents).
CREATE TABLE buddy_files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  buddy_id    INTEGER NOT NULL REFERENCES buddies(id),
  child_id    TEXT NOT NULL REFERENCES children(id),
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('image','text')),
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  path        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'reading' CHECK (status IN ('reading','ready','failed')),
  text        TEXT,
  summary     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT
);
CREATE INDEX buddy_files_buddy ON buddy_files(buddy_id, id);

-- A buddy's memory notes live in data/memory/<child>/<buddy>.md; this is the last turn they've been updated from.
ALTER TABLE buddies ADD COLUMN memory_turn_id INTEGER NOT NULL DEFAULT 0;
