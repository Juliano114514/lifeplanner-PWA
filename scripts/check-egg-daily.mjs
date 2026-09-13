import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

// Run the real Worker route against isolated SQLite, without network or D1 writes.
const hooks = registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); }
    catch (error) {
      if (specifier.startsWith('.')) return next(`${specifier}.ts`, context);
      throw error;
    }
  },
  load(url, context, next) {
    if (url.endsWith('.ts') && !url.includes('/node_modules/')) return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText,
    };
    return next(url, context);
  },
});
const { eggRoute } = await import('../worker/egg.ts');
const { today } = await import('../shared/domain.ts');
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
const migrations = new URL('../migrations/', import.meta.url);
for (const file of readdirSync(migrations).filter(f => f.endsWith('.sql') && f < '0006').sort()) db.exec(readFileSync(new URL(file, migrations), 'utf8'));
db.exec("INSERT INTO members(id, login, name) VALUES ('1', 'one', 'One'), ('2', 'two', 'Two')");
const midnight = Date.parse('2026-09-14T00:00:00+08:00');
const seed = db.prepare('INSERT INTO eggs(id, author_id, author_name, created_at, text, media, request_hash, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
for (const [id, owner, at] of [['old', '1', midnight - 2], ['latest', '1', midnight - 1], ['tie', '1', midnight - 1], ['other', '2', midnight - 1]]) {
  seed.run(id, owner, owner, at, id, '{}', id, owner);
  db.prepare('INSERT INTO egg_media VALUES (?, ?, ?, ?)').run(id, 'audio', 0, 'AA==');
}
db.exec(readFileSync(new URL('0006_daily_eggs.sql', migrations), 'utf8'));
assert.deepEqual(db.prepare('SELECT id FROM eggs WHERE deleted_at IS NULL ORDER BY seq').all().map(row => row.id), ['tie', 'other']);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM egg_media').get().n, 2);
assert.equal(today('Asia/Shanghai', midnight - 1), '2026-09-13');
assert.equal(today('Asia/Shanghai', midnight), '2026-09-14');

const env = {
  APP_ORIGIN: 'https://example.test', ALLOWED_GITHUB_IDS: '1,2', APP_TIME_ZONE: 'Asia/Shanghai',
  GITHUB_CLIENT_ID: 'test', GITHUB_CLIENT_SECRET: 'test',
  DB: {
    prepare(sql) {
      return { bind(...args) { return {
        first: async () => db.prepare(sql).get(...args) ?? null,
        all: async () => ({ results: db.prepare(sql).all(...args) }),
        run: () => db.prepare(sql).run(...args),
      }; } };
    },
    async batch(statements) {
      db.exec('BEGIN');
      try { const result = statements.map(statement => statement.run()); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  },
};
const actor = { user: { id: '1', name: 'One' }, timeZone: env.APP_TIME_ZONE };
const call = (path, body) => eggRoute(new Request(`${env.APP_ORIGIN}/api/v1/eggs${path}`, body ? {
  method: 'POST', headers: { Origin: env.APP_ORIGIN, 'Content-Type': 'application/json', 'X-LifePlanner-Actor': '1' }, body: JSON.stringify(body),
} : {}), env, actor);
const draft = text => ({ text, image: null, audio: { name: 'audio', mime: 'audio/mp4; codecs="mp4a.40.2"', data: 'AA==' } });
const first = { id: crypto.randomUUID(), draft: draft('first') };
const second = { id: crypto.randomUUID(), draft: draft('second') };
const originalNow = Date.now;
try {
  Date.now = () => midnight - 1;
  await call('', first);
  await call('', second);
  await call('', second); // A retry must not create another daily entry.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM eggs WHERE owner_id = '1' AND deleted_at IS NULL").get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM egg_media WHERE egg_id = ?').get(first.id).n, 0);
  await assert.rejects(call('', first), error => error.status === 410);
  await assert.rejects(call('', { ...first, id: crypto.randomUUID(), ownerId: '2' }), error => error.status === 403);
  // Force media insertion to fail and verify that the prior daily entry survives.
  db.exec("CREATE TRIGGER reject_media BEFORE INSERT ON egg_media BEGIN SELECT RAISE(ABORT, 'fixture'); END");
  await assert.rejects(call('', { id: crypto.randomUUID(), draft: draft('failed') }));
  db.exec('DROP TRIGGER reject_media');
  assert.equal((await (await call('/latest?owner=1')).json()).entry.id, second.id);
  Date.now = () => midnight;
  const third = { id: crypto.randomUUID(), draft: draft('next day') };
  await call('', third);
  const history = await (await call('')).json();
  assert.deepEqual(history.entries.map(item => item.id), [third.id, second.id, 'other']);
  const page = await (await call(`?before=${db.prepare('SELECT seq FROM eggs WHERE id = ?').get(third.id).seq}`)).json();
  assert.deepEqual(page.entries.map(item => item.id), [second.id, 'other']);
  await call(`/${third.id}/delete`, {});
  assert.equal((await (await call('/latest?owner=1')).json()).entry.id, second.id);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  console.log('Daily eggs: migration, midnight, same-day replacement, media cleanup, retries, rollback, ownership, pagination and deletion passed (in-memory SQLite).');
} finally { Date.now = originalNow; db.close(); hooks.deregister(); }
