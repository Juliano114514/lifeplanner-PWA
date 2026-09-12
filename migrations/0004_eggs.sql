-- Append-only Easter egg revisions; media is chunked to keep each D1 row small.
CREATE TABLE eggs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  author_id TEXT NOT NULL REFERENCES members(id),
  author_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  text TEXT NOT NULL,
  media TEXT NOT NULL CHECK (json_valid(media)),
  request_hash TEXT NOT NULL
);
CREATE INDEX eggs_author_seq ON eggs(author_id, seq DESC);
CREATE TABLE egg_media (
  egg_id TEXT NOT NULL REFERENCES eggs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'audio')),
  part INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (egg_id, kind, part)
);
