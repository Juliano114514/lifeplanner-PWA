-- One-time independent copy, including completed and archived food wishes.
-- New UUIDs ensure future recipe edits never target the original wish.
-- The version bump makes pre-migration offline commands resolve against the copy.
UPDATE planner_state
SET data = json_set(data,
  '$.recipes', json(COALESCE((
    SELECT json_group_array(json_set(value, '$.id',
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) ||
      '-4' || substr(lower(hex(randomblob(2))), 2) ||
      '-8' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))))
    FROM json_each(planner_state.data, '$.wishes')
    WHERE json_extract(value, '$.kind') = 'EAT'
      AND json_extract(value, '$.deletedAt') IS NULL
  ), '[]')),
  '$.version', version + 1),
  version = version + 1
WHERE json_type(data, '$.recipes') IS NULL;
