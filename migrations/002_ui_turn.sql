-- Link each child-visible item to the turn that produced it, so the parent transcript can show exactly what the child saw.
ALTER TABLE ui_events ADD COLUMN turn_id INTEGER REFERENCES turns(id);
CREATE INDEX ui_events_turn ON ui_events(turn_id);
