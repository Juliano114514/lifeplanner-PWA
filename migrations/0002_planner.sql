-- Shared non-task features use one versioned aggregate so an offline action can
-- be replayed atomically across schedules, diaries, stock and shopping.
CREATE TABLE planner_state (
  space_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 0),
  data TEXT NOT NULL CHECK (json_valid(data))
);
CREATE TABLE planner_mutations (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  expected_version INTEGER NOT NULL,
  result TEXT NOT NULL CHECK (json_valid(result)),
  created_at INTEGER NOT NULL
);
CREATE TRIGGER planner_version_guard BEFORE INSERT ON planner_mutations
WHEN COALESCE((SELECT version FROM planner_state WHERE space_id = 'shared'), 0) != NEW.expected_version
BEGIN
  SELECT RAISE(ABORT, 'VERSION_CONFLICT');
END;
CREATE TRIGGER planner_apply AFTER INSERT ON planner_mutations
BEGIN
  INSERT INTO planner_state(space_id, version, data)
    VALUES('shared', NEW.expected_version + 1, NEW.result)
    ON CONFLICT(space_id) DO UPDATE SET version = excluded.version, data = excluded.data;
END;
