import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const hooks = registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); }
    catch (error) { if (specifier.startsWith('.')) return next(`${specifier}.ts`, context); throw error; }
  },
  load(url, context, next) {
    if (url.endsWith('.ts') && !url.includes('/node_modules/')) return { format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText };
    return next(url, context);
  },
});
const { emptyPlanner, applyPlannerCommand, normalizePlanner, plannerCommandSchema } = await import('../shared/planner.ts');
const date = '2026-09-15';
const first = { id: crypto.randomUUID(), type: 'HAPPY', content: 'first entry', createdAt: 1, updatedAt: 1 };
const second = { id: crypto.randomUUID(), type: 'UNHAPPY', content: 'second entry', createdAt: 2, updatedAt: 2 };
const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../migrations/0002_planner.sql', import.meta.url), 'utf8'));
const insert = db.prepare('INSERT INTO planner_mutations VALUES (?, ?, ?, ?, ?, ?)');
const legacy = emptyPlanner();
legacy.version = 1;
legacy.diaryDays = [{ date, entries: [first], text: 'first body', updatedBy: '1', updatedAt: 1 }];
insert.run('one', '1', 'one', 0, JSON.stringify(legacy), 1);
legacy.version = 2;
legacy.diaryDays = [{ date, entries: [first, second], text: 'second body', updatedBy: '2', updatedAt: 2 }];
insert.run('two', '2', 'two', 1, JSON.stringify(legacy), 2);
// Saving mood entries without changing the body must not become its author.
legacy.version = 3;
legacy.diaryDays[0].updatedBy = '1';
insert.run('three', '1', 'three', 2, JSON.stringify(legacy), 3);
db.exec(readFileSync(new URL('../migrations/0007_diary_owners.sql', import.meta.url), 'utf8'));
const migrated = JSON.parse(db.prepare('SELECT data FROM planner_state').get().data);
assert.equal(migrated.version, 4);
assert.equal(db.prepare('SELECT version FROM planner_state').get().version, 4);
assert.deepEqual(migrated.diaryDays[0].entries.map(entry => entry.createdBy), ['1', '2']);
assert.deepEqual(migrated.diaryDays[0].texts.map(item => [item.ownerId, item.content]), [['2', 'second body']]);
assert.equal(migrated.diaryDays[0].text, '');
assert.throws(() => insert.run('stale', '1', 'stale', 3, JSON.stringify(legacy), 4), /VERSION_CONFLICT/);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM planner_mutations').get().n, 3);

let current = migrated;
function save(actor, text, entries = current.diaryDays[0].entries, targetDate = date) {
  const command = plannerCommandSchema.parse({ mutationId: crypto.randomUUID(), expectedVersion: current.version,
    operation: { type: 'saveDiaryDay', date: targetDate, text, entries: entries.map(({ id, type, content, createdAt }) => ({ id, type, content, createdAt })) } });
  current = applyPlannerCommand(current, command, actor, 100 + current.version);
}
save('1', 'my diary');
save('1', 'my revised diary');
assert.deepEqual(current.diaryDays[0].texts.map(item => [item.ownerId, item.content]), [['2', 'second body'], ['1', 'my revised diary']]);
const createdAt = current.diaryDays[0].texts.find(item => item.ownerId === '1').createdAt;
save('1', 'third revision');
assert.equal(current.diaryDays[0].texts.find(item => item.ownerId === '1').createdAt, createdAt);
save('1', '   ');
assert.deepEqual(current.diaryDays[0].texts.map(item => item.ownerId), ['2']);
assert.deepEqual(current.diaryDays[0].entries.map(entry => entry.createdBy), ['1', '2']);
save('1', '', [], '2026-09-16');
assert.equal(current.diaryDays.find(day => day.date === '2026-09-16').texts.length, 0);
const normalized = normalizePlanner(legacy);
assert.equal(normalized.diaryDays[0].texts[0].ownerId, '1'); // Offline fallback has no mutation history.
assert.equal(normalized.diaryDays[0].entries[0].createdBy, '');
assert.deepEqual(normalizePlanner(normalized), normalized);
assert.equal(legacy.diaryDays[0].text, 'second body');
db.close(); hooks.deregister();
console.log('Diary migration, historical authors, version guard, per-user daily upsert, blank removal and legacy normalization: passed.');
