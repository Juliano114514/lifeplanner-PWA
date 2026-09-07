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
db.close();
console.log('SQL migrations, integrity, atomic revision rejection and update: passed (in-memory SQLite).');
