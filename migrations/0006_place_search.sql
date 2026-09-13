CREATE TABLE place_search_gate (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  available_at INTEGER NOT NULL DEFAULT 0,
  lease TEXT NOT NULL DEFAULT ''
);
INSERT INTO place_search_gate(id) VALUES(1);
CREATE TABLE place_search_cache (
  query_key TEXT PRIMARY KEY,
  results TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TRIGGER place_search_cache_bound AFTER INSERT ON place_search_cache
BEGIN
  DELETE FROM place_search_cache WHERE query_key IN (
    SELECT query_key FROM place_search_cache ORDER BY created_at DESC, query_key DESC LIMIT -1 OFFSET 100
  );
END;
