-- Profiles are separate from GitHub identity, so OAuth refreshes cannot erase them.
CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES members(id),
  data TEXT NOT NULL CHECK (json_valid(data))
);
