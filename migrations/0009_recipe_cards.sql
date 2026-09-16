-- Convert only legacy recipe content; preserve IDs, audit metadata and tombstones.
-- The format marker makes this migration safe to repeat without clearing new data.
UPDATE planner_state
SET data = json_set(data,
  '$.recipes', json(COALESCE((
    SELECT json_group_array(json_patch(json_object(
      'id', json_extract(value, '$.id'),
      'name', json_extract(value, '$.name'),
      'ingredients', json(COALESCE(json_extract(value, '$.ingredients'), '[]')),
      'seasonings', json(COALESCE(json_extract(value, '$.seasonings'), '[]')),
      'steps', json(COALESCE(json_extract(value, '$.steps'), '[]')),
      'createdBy', json_extract(value, '$.createdBy'),
      'updatedBy', json_extract(value, '$.updatedBy'),
      'createdAt', json_extract(value, '$.createdAt'),
      'updatedAt', json_extract(value, '$.updatedAt')
    ), CASE WHEN json_extract(value, '$.deletedAt') IS NOT NULL
      THEN json_object('deletedAt', json_extract(value, '$.deletedAt')) ELSE '{}' END))
    FROM json_each(planner_state.data, '$.recipes')
  ), '[]')),
  '$.recipeFormatVersion', 2,
  '$.version', version + 1),
  version = version + 1
WHERE COALESCE(json_extract(data, '$.recipeFormatVersion'), 0) < 2;
