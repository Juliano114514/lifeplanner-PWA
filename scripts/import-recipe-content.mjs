// Defaults to a read-only production preview; --apply explicitly writes D1.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { recipeDraftSchema } from '../shared/recipe.ts';
import content from '../content/recipes-20260917.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const apply = process.argv.includes('--apply');
const actor = process.argv.find(value => value.startsWith('--actor='))?.slice(8);
if (!actor) throw new Error('Provide --actor=<existing member id>.');
const sqlString = value => `'${String(value).replaceAll("'", "''")}'`;
const execute = args => {
  const output = execFileSync(process.execPath,
    [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', 'DB', '--remote', '--json', ...args],
    { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, windowsHide: true });
  // Wrangler's file-import progress can precede its JSON even with --json.
  const jsonStart = output.search(/^\[/m);
  if (jsonStart < 0) throw new Error('Missing D1 JSON output; inspect current state before retrying a write.');
  const result = JSON.parse(output.slice(jsonStart));
  if (!result.length || result.some(item => !item.success)) throw new Error('D1 execution failed.');
  return result;
};
const query = sql => execute(['--command', sql]).flatMap(item => item.results);
const snapshot = () => {
  const rows = query("SELECT space_id, version, data FROM planner_state WHERE space_id = 'shared'");
  if (rows.length !== 1) throw new Error('Expected exactly one shared planner row.');
  return rows[0];
};
if (query(`SELECT id FROM members WHERE id = ${sqlString(actor)}`).length !== 1) throw new Error('Unknown actor.');
const before = snapshot();
const planner = JSON.parse(before.data);
if (planner.version !== before.version || planner.recipeFormatVersion !== 2 || !Array.isArray(planner.recipes)) {
  throw new Error('Unexpected recipe format or unaligned version.');
}
const nextRecipes = structuredClone(planner.recipes);
const now = Date.now();
const summary = { updated: [], added: [], unchanged: [] };
const seen = new Set();
for (const item of content) {
  if (seen.has(item.name)) throw new Error(`Duplicate content name: ${item.name}`);
  seen.add(item.name);
  const matches = nextRecipes.filter(recipe => recipe.name === item.name && recipe.deletedAt == null);
  if (matches.length > 1) throw new Error(`Ambiguous recipe: ${item.name}`);
  const existing = matches[0];
  const draft = recipeDraftSchema.parse({ id: existing?.id ?? randomUUID(), ...item });
  if (existing) {
    if (['ingredients', 'seasonings', 'steps'].every(key => JSON.stringify(existing[key]) === JSON.stringify(draft[key]))) {
      summary.unchanged.push(item.name);
      continue;
    }
    if (['ingredients', 'seasonings', 'steps'].some(key => existing[key]?.length)) {
      throw new Error(`Refusing to overwrite non-empty recipe: ${item.name}`);
    }
    Object.assign(existing, draft, { updatedBy: actor, updatedAt: now });
    summary.updated.push(item.name);
  } else {
    if (nextRecipes.some(recipe => recipe.name === item.name)) throw new Error(`Refusing to recreate deleted recipe: ${item.name}`);
    nextRecipes.push({ ...draft, createdBy: actor, updatedBy: actor, createdAt: now, updatedAt: now });
    summary.added.push(item.name);
  }
}
if (new Set(nextRecipes.map(recipe => recipe.id)).size !== nextRecipes.length) throw new Error('Duplicate recipe id.');
console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', expectedVersion: before.version, ...summary }, null, 2));
if (!summary.updated.length && !summary.added.length) {
  console.log('Already imported; no changes.');
  process.exit(0);
}
const sql = `UPDATE planner_state SET data = json_set(data, '$.recipes', json(${sqlString(JSON.stringify(nextRecipes))}), '$.version', version + 1), version = version + 1 WHERE space_id = 'shared' AND version = ${before.version} AND json_extract(data, '$.version') = ${before.version};`;
// Parse and evaluate the exact statement against the captured row before release.
const local = new DatabaseSync(':memory:');
local.exec('CREATE TABLE planner_state(space_id TEXT PRIMARY KEY, version INTEGER, data TEXT CHECK(json_valid(data)))');
local.prepare('INSERT INTO planner_state VALUES (?, ?, ?)').run(before.space_id, before.version, before.data);
local.exec(sql);
const expected = local.prepare('SELECT * FROM planner_state').get();
local.close();
const expectedData = JSON.parse(expected.data);
const withoutRecipes = data => Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'recipes' && key !== 'version'));
if (JSON.stringify(withoutRecipes(planner)) !== JSON.stringify(withoutRecipes(expectedData))) throw new Error('Unrelated data changed.');
if (expected.version !== before.version + 1 || expectedData.version !== expected.version) throw new Error('Version mismatch.');
for (const old of planner.recipes.filter(recipe => recipe.deletedAt != null)) {
  if (JSON.stringify(old) !== JSON.stringify(expectedData.recipes.find(recipe => recipe.id === old.id))) throw new Error('Deleted record changed.');
}
const backupDir = resolve(root, '.wrangler/backups', `recipe-content-${now}`);
mkdirSync(backupDir, { recursive: true });
writeFileSync(resolve(backupDir, 'before.json'), JSON.stringify(before));
writeFileSync(resolve(backupDir, 'apply.sql'), sql);
writeFileSync(resolve(backupDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`Validated SQL; private backup: ${backupDir}`);
if (!apply) process.exit(0);
execute(['--file', resolve(backupDir, 'apply.sql')]);
const after = snapshot();
writeFileSync(resolve(backupDir, 'after.json'), JSON.stringify(after));
if (after.version !== expected.version || JSON.stringify(JSON.parse(after.data)) !== JSON.stringify(expectedData)) {
  throw new Error('Post-write snapshot differs (possibly a concurrent edit); inspect backup before any further write.');
}
console.log(JSON.stringify({ verified: true, version: after.version,
  activeRecipes: nextRecipes.filter(recipe => recipe.deletedAt == null).length,
  deletedRecipes: nextRecipes.filter(recipe => recipe.deletedAt != null).length,
  unrelatedDataUnchanged: true }));
