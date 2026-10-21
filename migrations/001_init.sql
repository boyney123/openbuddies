-- OpenBuddies schema v1. Migrations are plain numbered SQL files, run in order on start.

CREATE TABLE children (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE devices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id      TEXT NOT NULL REFERENCES children(id),
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  paired_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at  TEXT,
  revoked_at    TEXT
);

-- One-time pairing tokens. Written by `openbuddies pair` (a separate process), redeemed by the server.
CREATE TABLE pairing_tokens (
  token_hash  TEXT PRIMARY KEY,
  child_id    TEXT NOT NULL REFERENCES children(id),
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);

-- One homework sitting. A new one starts after the idle gap.
CREATE TABLE sessions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id       TEXT NOT NULL REFERENCES children(id),
  app            TEXT NOT NULL,
  pi_session_id  TEXT,
  started_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at       TEXT
);
CREATE INDEX sessions_child ON sessions(child_id, started_at);

CREATE TABLE turns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   INTEGER NOT NULL REFERENCES sessions(id),
  role         TEXT NOT NULL CHECK (role IN ('child','tutor')),
  text         TEXT NOT NULL,
  intent_json  TEXT,
  action_json  TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX turns_session ON turns(session_id, id);

CREATE TABLE blocked_drafts (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  turn_id  INTEGER NOT NULL REFERENCES turns(id),
  text     TEXT NOT NULL,
  reason   TEXT NOT NULL
);

CREATE TABLE tool_calls (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  turn_id    INTEGER NOT NULL REFERENCES turns(id),
  tool       TEXT NOT NULL,
  args_json  TEXT NOT NULL,
  accepted   INTEGER NOT NULL,
  error      TEXT
);

-- Hint ladder state, one row per problem.
CREATE TABLE problems (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   INTEGER NOT NULL REFERENCES sessions(id),
  child_id     TEXT NOT NULL REFERENCES children(id),
  subject      TEXT,
  label        TEXT NOT NULL,
  text         TEXT NOT NULL,
  rung         TEXT NOT NULL DEFAULT 'ask',
  attempts     INTEGER NOT NULL DEFAULT 0,
  correct      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  solved_at    TEXT,
  closed_at    TEXT
);
CREATE INDEX problems_child ON problems(child_id, id);

CREATE TABLE alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id    TEXT NOT NULL REFERENCES children(id),
  turn_id     INTEGER REFERENCES turns(id),
  severity    TEXT NOT NULL,
  summary     TEXT NOT NULL,
  sent_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  read_at     TEXT
);

-- What the child's devices render, in order. Lets phone and laptop replay and stay in sync.
CREATE TABLE ui_events (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id    TEXT NOT NULL REFERENCES children(id),
  session_id  INTEGER NOT NULL REFERENCES sessions(id),
  item_json   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ui_events_child ON ui_events(child_id, seq);

-- Daily token use per child, for the budget in openbuddies.yaml.
CREATE TABLE usage (
  child_id  TEXT NOT NULL,
  day       TEXT NOT NULL,
  tokens    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (child_id, day)
);
