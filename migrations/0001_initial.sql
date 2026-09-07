-- Each task is a versioned aggregate, including occurrences. The trigger makes
-- revision check + task write + retained idempotent response ONE SQLite statement.
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version > 0),
  data TEXT NOT NULL CHECK (json_valid(data))
);
CREATE TABLE mutations (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  task_id TEXT NOT NULL,
  expected_version INTEGER NOT NULL,
  result TEXT NOT NULL CHECK (json_valid(result)),
  created_at INTEGER NOT NULL
);
CREATE TRIGGER mutation_version_guard BEFORE INSERT ON mutations
WHEN COALESCE((SELECT version FROM tasks WHERE id = NEW.task_id), 0) != NEW.expected_version
BEGIN
  SELECT RAISE(ABORT, 'VERSION_CONFLICT');
END;
CREATE TRIGGER mutation_apply AFTER INSERT ON mutations
BEGIN
  INSERT INTO tasks(id, version, data)
    VALUES(NEW.task_id, NEW.expected_version + 1, NEW.result)
    ON CONFLICT(id) DO UPDATE SET version = excluded.version, data = excluded.data;
END;
CREATE INDEX mutations_task ON mutations(task_id);
CREATE TABLE members (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL,
  name TEXT NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES members(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
