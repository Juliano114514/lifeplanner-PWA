import { openDB, type DBSchema } from 'idb';
import type { Command, Identity, Operation, Task, TaskDraft } from '../../shared/contracts';
import { applyCommand } from '../../shared/domain';

export interface Pending { command: Command; at: number; preview: Task }
export interface Conflict { current: Task | null; message: string }
export interface Account {
  identity: Identity; base: Task[]; pending: Pending[];
  conflicts: Record<string, Conflict>; lastSync: number | null;
}
export interface EditorDraft { taskId: string; existing: boolean; baselineVersion: number; draft: TaskDraft }
interface Database extends DBSchema {
  accounts: { key: string; value: Account };
  drafts: { key: string; value: EditorDraft };
}
const database = openDB<Database>('lifeplanner-v1', 1, { upgrade(db) {
  db.createObjectStore('accounts'); db.createObjectStore('drafts');
} });
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('lifeplanner-data');
const events = new EventTarget();
channel?.addEventListener('message', () => events.dispatchEvent(new Event('change')));
export function subscribe(listener: () => void): () => void {
  events.addEventListener('change', listener);
  return () => events.removeEventListener('change', listener);
}
function notify() { events.dispatchEvent(new Event('change')); channel?.postMessage('changed'); }
export const readAccount = async (id: string) => (await database).get('accounts', id);
export async function updateAccount(id: string, change: (account: Account) => void): Promise<void> {
  const db = await database, tx = db.transaction('accounts', 'readwrite');
  const account = await tx.store.get(id);
  if (!account) { await tx.done; throw new Error('本地账号数据不可用，请重新登录'); }
  change(account);
  await tx.store.put(account, id);
  await tx.done;
  notify();
}
export async function saveIdentity(identity: Identity): Promise<void> {
  const db = await database, tx = db.transaction('accounts', 'readwrite');
  const old = await tx.store.get(identity.user.id);
  await tx.store.put(old ? { ...old, identity } : { identity, base: [], pending: [], conflicts: {}, lastSync: null }, identity.user.id);
  await tx.done;
  localStorage.setItem('lp-account', identity.user.id);
  notify();
}
export async function cachedAccount(): Promise<Account | undefined> {
  const id = localStorage.getItem('lp-account');
  return id ? readAccount(id) : undefined;
}
export function materialize(account: Account): Task[] {
  const tasks = new Map(account.base.map(task => [task.id, structuredClone(task)]));
  for (const { command, at } of account.pending) {
    const current = tasks.get(command.taskId) ?? null;
    // Base remains the version on which local work started until conflict resolution.
    try { tasks.set(command.taskId, applyCommand(current, command, account.identity.user.id, account.identity.timeZone, at)); }
    catch {
      // A server-side date rollover can invalidate a later offline operation.
      // Keep its saved preview visible until the user resolves the conflict.
      const preview = account.pending.find(p => p.command.mutationId === command.mutationId)!.preview;
      tasks.set(command.taskId, structuredClone(preview));
    }
  }
  return [...tasks.values()];
}
export async function enqueue(id: string, taskId: string, operation: Operation, expectedVersion?: number): Promise<void> {
  await updateAccount(id, account => {
    if (account.conflicts[taskId]) throw new Error('请先处理此任务的同步冲突');
    const current = materialize(account).find(t => t.id === taskId) ?? null;
    const command: Command = { mutationId: crypto.randomUUID(), taskId, expectedVersion: expectedVersion ?? current?.version ?? 0, operation };
    const at = Date.now();
    const result = applyCommand(current, command, id, account.identity.timeZone, at);
    if (operation.type === 'ensure' && result.occurrences.length === current?.occurrences.length) return;
    account.pending.push({ command, at, preview: result });
  });
}
export async function acknowledge(id: string, mutationId: string, task: Task): Promise<void> {
  await updateAccount(id, account => {
    if (!account.pending.some(p => p.command.mutationId === mutationId)) return;
    account.pending = account.pending.filter(p => p.command.mutationId !== mutationId);
    account.base = account.base.filter(t => t.id !== task.id).concat(task);
  });
}
export async function mergeSnapshot(id: string, tasks: Task[]): Promise<void> {
  await updateAccount(id, account => {
    const pendingIds = new Set(account.pending.map(p => p.command.taskId));
    const base = new Map(account.base.map(t => [t.id, t]));
    for (const task of tasks) {
      if (!pendingIds.has(task.id) && (!base.has(task.id) || base.get(task.id)!.version <= task.version)) base.set(task.id, task);
    }
    account.base = [...base.values()];
    account.lastSync = Date.now();
  });
}
export async function resolveConflict(id: string, taskId: string, choice: 'cloud' | 'local'): Promise<void> {
  await updateAccount(id, account => {
    const conflict = account.conflicts[taskId];
    if (!conflict) return;
    const localTask = materialize(account).find(t => t.id === taskId);
    const old = account.pending.filter(p => p.command.taskId === taskId);
    account.pending = account.pending.filter(p => p.command.taskId !== taskId);
    account.base = account.base.filter(t => t.id !== taskId);
    if (conflict.current) account.base.push(conflict.current);
    delete account.conflicts[taskId];
    if (choice === 'cloud') return;
    // An archived cloud task is immutable. Preserve local content in a new task.
    if ((!conflict.current || conflict.current.isArchived) && localTask) {
      const { title, note, dueAt, isPinned, recurrence, recurrenceStart, ownerId } = localTask;
      const command: Command = { mutationId: crypto.randomUUID(), taskId: crypto.randomUUID(),
        expectedVersion: 0, operation: { type: 'save', draft: { title, note, dueAt, isPinned, recurrence, recurrenceStart, ownerId } } };
      const at = Date.now();
      account.pending.push({ at, command, preview: applyCommand(null, command, id, account.identity.timeZone, at) });
      return;
    }
    let current = conflict.current;
    for (const pending of old) {
      const command = { ...pending.command, mutationId: crypto.randomUUID(), expectedVersion: current?.version ?? 0 };
      current = applyCommand(current, command, id, account.identity.timeZone, Date.now());
      account.pending.push({ command, at: Date.now(), preview: current });
    }
  });
}
export const loadDraft = async (id: string) => (await database).get('drafts', id);
export const storeDraft = async (id: string, draft: EditorDraft) => (await database).put('drafts', draft, id);
export const removeDraft = async (id: string) => (await database).delete('drafts', id);
