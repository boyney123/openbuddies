-- Quizzes a buddy makes for a child (quizzes.ts): the questions with their answers and explanations, and every try.
CREATE TABLE quizzes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id    TEXT NOT NULL REFERENCES children(id),
  buddy_id    INTEGER NOT NULL REFERENCES buddies(id),
  -- The chat it was asked for in, so the finished quiz is announced there.
  app         TEXT NOT NULL,
  topic       TEXT NOT NULL,
  -- multiple_choice or single_answer; null until the child picks.
  style       TEXT CHECK (style IN ('multiple_choice','single_answer')),
  count       INTEGER NOT NULL DEFAULT 6,
  -- offered: waiting for the child to pick a style. making: being written. ready. failed.
  status      TEXT NOT NULL DEFAULT 'offered' CHECK (status IN ('offered','making','ready','failed')),
  title       TEXT,
  -- [{question, choices?, answer, accept?, hint?, explanation}]
  questions_json TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT
);
CREATE INDEX quizzes_buddy ON quizzes(buddy_id, deleted_at);

CREATE TABLE quiz_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id     INTEGER NOT NULL REFERENCES quizzes(id),
  -- Per question: {tries: [answers], correct: bool, done: bool}
  answers_json TEXT NOT NULL DEFAULT '[]',
  score       INTEGER,
  total       INTEGER NOT NULL,
  started_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at TEXT
);
CREATE INDEX quiz_attempts_quiz ON quiz_attempts(quiz_id);
