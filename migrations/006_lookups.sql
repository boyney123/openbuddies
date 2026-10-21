-- How many times a day each child's buddies looked something up on the internet (web.ts), for the daily limit.
ALTER TABLE usage ADD COLUMN lookups INTEGER NOT NULL DEFAULT 0;
