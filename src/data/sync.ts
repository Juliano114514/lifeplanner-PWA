import type { Identity, Snapshot, Task } from '../../shared/contracts';
import { api, ApiFailure } from './api';
import { acknowledge, mergeSnapshot, readAccount, saveIdentity, updateAccount } from './store';

const running = new Map<string, Promise<void>>();
export function synchronize(id: string): Promise<void> {
  const existing = running.get(id);
  if (existing) return existing;
  const run = async () => {
    const identity = await api<Identity>('/api/v1/me');
    if (identity.user.id !== id) throw new ApiFailure(401, { error: 'ACCOUNT_CHANGED', message: '账号已改变，请刷新页面后继续' });
    await saveIdentity(identity);
    // Process a bounded snapshot so continuous typing cannot starve refresh.
    const initial = await readAccount(id);
    for (const pending of initial?.pending ?? []) {
      const account = await readAccount(id);
      const command = account?.pending.find(p => p.command.mutationId === pending.command.mutationId)?.command;
      if (!command || account?.conflicts[command.taskId]) continue;
      try {
        const result = await api<{ task: Task }>('/api/v1/tasks/commands', command, id);
        await acknowledge(id, command.mutationId, result.task);
      } catch (error) {
        if (error instanceof ApiFailure && error.detail.error === 'VERSION_CONFLICT') {
          await updateAccount(id, state => {
            if (state.pending.some(p => p.command.mutationId === command.mutationId)) {
              state.conflicts[command.taskId] = { current: error.detail.current ?? null, message: error.message };
            }
          });
          continue;
        }
        if (error instanceof ApiFailure && error.status === 400) {
          const snapshot = await api<Snapshot>('/api/v1/tasks/snapshot');
          await updateAccount(id, state => {
            if (state.pending.some(p => p.command.mutationId === command.mutationId)) {
              state.conflicts[command.taskId] = { current: snapshot.tasks.find(t => t.id === command.taskId) ?? null,
                message: `${error.message}。本机内容已保留，请采用云端后重新编辑。` };
            }
          });
          continue;
        }
        throw error;
      }
    }
    const snapshot = await api<Snapshot>('/api/v1/tasks/snapshot');
    await mergeSnapshot(id, snapshot.tasks);
  };
  const promise = (navigator.locks ? navigator.locks.request(`lifeplanner-sync-${id}`, run) : run())
    .finally(() => running.delete(id));
  running.set(id, promise);
  return promise;
}
