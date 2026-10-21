-- What a buddy is wearing (a JSON list of accessories, e.g. ["cap","scarf"]), picked by the child.
ALTER TABLE buddies ADD COLUMN wear TEXT NOT NULL DEFAULT '[]';
