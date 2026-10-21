-- Pictures a child made in Picture Studio each day (pictures.ts), for the daily picture limit.
ALTER TABLE usage ADD COLUMN pictures INTEGER NOT NULL DEFAULT 0;
