-- Existing deployment uses Asia/Shanghai. New writes supply the configured local date.
ALTER TABLE eggs ADD COLUMN day_key TEXT;
UPDATE eggs SET day_key = date(created_at / 1000, 'unixepoch', '+8 hours');

-- Keep only the last live snapshot per owner/day; retain IDs/hashes as retry guards.
UPDATE eggs SET deleted_at = created_at, text = '', media = '{"image":null,"audio":null}'
WHERE deleted_at IS NULL AND EXISTS (
  SELECT 1 FROM eggs AS newer
  WHERE newer.owner_id = eggs.owner_id AND newer.day_key = eggs.day_key
    AND newer.deleted_at IS NULL
    AND (newer.created_at > eggs.created_at OR (newer.created_at = eggs.created_at AND newer.seq > eggs.seq))
);
DELETE FROM egg_media WHERE egg_id IN (SELECT id FROM eggs WHERE deleted_at IS NOT NULL);
CREATE UNIQUE INDEX eggs_owner_day_live ON eggs(owner_id, day_key) WHERE deleted_at IS NULL;
