CREATE TABLE member_sync (
  user_id TEXT PRIMARY KEY REFERENCES members(id),
  last_sync_at INTEGER NOT NULL
);
ALTER TABLE eggs ADD COLUMN owner_id TEXT;
UPDATE eggs SET owner_id = author_id;
ALTER TABLE eggs ADD COLUMN deleted_at INTEGER;
CREATE INDEX eggs_owner_seq ON eggs(owner_id, seq DESC);
CREATE TRIGGER eggs_default_owner AFTER INSERT ON eggs
WHEN NEW.owner_id IS NULL
BEGIN
  UPDATE eggs SET owner_id = NEW.author_id WHERE id = NEW.id;
END;
