-- Recover entry authors from their first appearance in the append-only history.
-- Recover the last content-changing actor for the legacy shared body.
-- Unknown entry authors stay empty rather than attributing them to another user.
WITH entry_history AS (
  SELECT json_extract(day.value, '$.date') AS date,
         json_extract(entry.value, '$.id') AS id,
         mutation.actor_id,
         ROW_NUMBER() OVER (
           PARTITION BY json_extract(day.value, '$.date'), json_extract(entry.value, '$.id')
           ORDER BY mutation.expected_version, mutation.created_at, mutation.id
         ) AS appearance
  FROM planner_mutations AS mutation,
       json_each(mutation.result, '$.diaryDays') AS day,
       json_each(day.value, '$.entries') AS entry
), body_history AS (
  SELECT json_extract(day.value, '$.date') AS date,
         json_extract(day.value, '$.text') AS content,
         mutation.actor_id, mutation.expected_version,
         LAG(json_extract(day.value, '$.text')) OVER (
           PARTITION BY json_extract(day.value, '$.date') ORDER BY mutation.expected_version
         ) AS previous_content
  FROM planner_mutations AS mutation, json_each(mutation.result, '$.diaryDays') AS day
), upgraded_days AS (
  SELECT state.space_id, day.key AS position,
    json_set(day.value,
      '$.entries', json((
        SELECT json_group_array(json_set(entry.value, '$.createdBy',
          COALESCE(json_extract(entry.value, '$.createdBy'), (
            SELECT history.actor_id FROM entry_history AS history
            WHERE history.date = json_extract(day.value, '$.date')
              AND history.id = json_extract(entry.value, '$.id') AND history.appearance = 1
          ), '')
        )) FROM json_each(day.value, '$.entries') AS entry
      )),
      '$.texts', json(COALESCE(json_extract(day.value, '$.texts'),
        CASE WHEN length(trim(COALESCE(json_extract(day.value, '$.text'), ''))) > 0
        THEN json_array(json_object(
          'ownerId', COALESCE((
            SELECT history.actor_id FROM body_history AS history
            WHERE history.date = json_extract(day.value, '$.date')
              AND history.content = json_extract(day.value, '$.text')
              AND history.content IS NOT history.previous_content
            ORDER BY history.expected_version DESC LIMIT 1
          ), json_extract(day.value, '$.updatedBy')),
          'content', json_extract(day.value, '$.text'),
          'createdAt', json_extract(day.value, '$.updatedAt'),
          'updatedAt', json_extract(day.value, '$.updatedAt')
        )) ELSE '[]' END)),
      '$.text', ''
    ) AS value
  FROM planner_state AS state, json_each(state.data, '$.diaryDays') AS day
)
UPDATE planner_state
SET data = json_set(data,
      '$.diaryDays', json((SELECT json_group_array(json(value)) FROM (
        SELECT value FROM upgraded_days WHERE space_id = planner_state.space_id ORDER BY position
      ))),
      '$.version', version + 1),
    version = version + 1
WHERE json_array_length(data, '$.diaryDays') > 0;
