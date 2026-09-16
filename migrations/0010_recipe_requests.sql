-- A new collection, independent of recipe content and retired completion flags.
-- Keep existing requests on repeat execution and advance both revision copies.
UPDATE planner_state
SET data = json_set(data, '$.recipeRequests', json('[]'), '$.version', version + 1),
    version = version + 1
WHERE json_type(data, '$.recipeRequests') IS NULL;
