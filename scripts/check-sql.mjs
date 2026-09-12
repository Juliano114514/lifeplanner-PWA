import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
const migrations = new URL('../migrations/', import.meta.url);
for (const file of readdirSync(migrations).filter(f => f.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(file, migrations), 'utf8'));
const integrity = db.prepare('PRAGMA integrity_check').get();
if (integrity.integrity_check !== 'ok') throw new Error('SQLite integrity check failed');
// Exercise the atomic revision guard against an isolated in-memory database.
const insert = db.prepare('INSERT INTO mutations VALUES (?, ?, ?, ?, ?, ?, ?)');
insert.run('first', 'member-a', 'hash', 'task-a', 0, '{"version":1}', 1);
let rejected = false;
try { insert.run('stale', 'member-b', 'hash2', 'task-a', 0, '{"version":1}', 2); } catch { rejected = true; }
if (!rejected || db.prepare('SELECT COUNT(*) AS n FROM mutations').get().n !== 1 || db.prepare('SELECT version FROM tasks').get().version !== 1) throw new Error('Revision guard did not roll back atomically');
insert.run('second', 'member-b', 'hash3', 'task-a', 1, '{"version":2}', 3);
if (db.prepare('SELECT version FROM tasks').get().version !== 2) throw new Error('Revision update failed');
const plannerInsert = db.prepare('INSERT INTO planner_mutations VALUES (?, ?, ?, ?, ?, ?)');
plannerInsert.run('planner-first', 'member-a', 'hash4', 0, '{"version":1}', 4);
let plannerRejected = false;
try { plannerInsert.run('planner-stale', 'member-b', 'hash5', 0, '{"version":1}', 5); } catch { plannerRejected = true; }
if (!plannerRejected || db.prepare("SELECT version FROM planner_state WHERE space_id = 'shared'").get().version !== 1) throw new Error('Planner revision guard failed');
if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign key check failed');
// Verify the new append-only media storage without touching a local or remote database.
db.prepare('INSERT INTO members(id, login, name) VALUES (?, ?, ?)').run('egg-member', 'example', 'Example');
const eggInsert = db.prepare('INSERT INTO eggs(id, author_id, author_name, created_at, text, media, request_hash) VALUES (?, ?, ?, ?, ?, ?, ?)');
const mediaInsert = db.prepare('INSERT INTO egg_media(egg_id, kind, part, data) VALUES (?, ?, ?, ?)');
const payload = Buffer.alloc(2 * 1024 * 1024, 7).toString('base64');
db.exec('BEGIN');
eggInsert.run('egg-first', 'egg-member', 'Example', 1, 'First', '{"image":{"name":"example.gif","mime":"image/gif"},"audio":null}', 'egg-hash');
for (let offset = 0; offset < payload.length; offset += 262144) mediaInsert.run('egg-first', 'image', offset / 262144, payload.slice(offset, offset + 262144));
db.exec('COMMIT');
const restored = db.prepare('SELECT data FROM egg_media WHERE egg_id = ? ORDER BY part').all('egg-first').map(row => row.data).join('');
if (restored !== payload) throw new Error('Egg media chunks failed to round-trip');
let eggRejected = false;
db.exec('BEGIN');
try {
  eggInsert.run('egg-failed', 'egg-member', 'Example', 2, 'Failed', '{}', 'failed-hash');
  mediaInsert.run('egg-failed', 'invalid-kind', 0, 'AA==');
  db.exec('COMMIT');
} catch { db.exec('ROLLBACK'); eggRejected = true; }
if (!eggRejected || db.prepare('SELECT id FROM eggs WHERE id = ?').get('egg-failed')) throw new Error('Egg media failure was not atomic');
eggInsert.run('egg-second', 'egg-member', 'Example', 1, 'Second', '{}', 'second-hash');
const firstPage = db.prepare('SELECT seq, id FROM eggs ORDER BY seq DESC LIMIT 1').get();
const secondPage = db.prepare('SELECT id FROM eggs WHERE seq < ? ORDER BY seq DESC LIMIT 1').get(firstPage.seq);
if (firstPage.id !== 'egg-second' || secondPage.id !== 'egg-first') throw new Error('Egg history cursor lost a same-time revision');
if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Egg foreign key check failed');
console.log('Egg 2 MiB media round-trip, atomic rollback and history pagination: passed (in-memory SQLite).');
db.close();
console.log('SQL migrations, integrity, atomic revision rejection and update: passed (in-memory SQLite).');
