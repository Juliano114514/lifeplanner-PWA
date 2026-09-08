import type { Identity, Snapshot, Task, UserProfile } from '../../shared/contracts';
import { api, ApiFailure } from './api';
import { acknowledge, mergeSnapshot, readAccount, saveIdentity, updateAccount } from './store';
import { acknowledgePlanner, mergePlanner } from './store';
import type { PlannerData } from '../../shared/planner';

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
    const plannerInitial = await readAccount(id);
    for (const pending of plannerInitial?.plannerPending ?? []) {
      const account = await readAccount(id);
      const command = account?.plannerPending.find(value => value.command.mutationId === pending.command.mutationId)?.command;
      if (!command || account?.plannerConflict) continue;
      try {
        const result = await api<{ planner: PlannerData }>('/api/v1/planner/commands', command, id);
        await acknowledgePlanner(id, command.mutationId, result.planner);
      } catch (error) {
        if (error instanceof ApiFailure && error.detail.error === 'VERSION_CONFLICT') {
          await updateAccount(id, state => {
            if (state.plannerPending.some(value => value.command.mutationId === command.mutationId)) {
              state.plannerConflict = { current: error.detail.current as unknown as PlannerData, message: error.message };
            }
          });
          break;
        }
        throw error;
      }
    }
    const plannerSnapshot = await api<{ planner: PlannerData }>('/api/v1/planner/snapshot');
    await mergePlanner(id, plannerSnapshot.planner);
    // Profile failures must not prevent task/planner synchronization.
    const profileAccount = await readAccount(id);
    if (profileAccount?.profilePending && profileAccount.profile) {
      const pendingId = profileAccount.profilePending;
      const result = await api<{ profile: UserProfile }>('/api/v1/profile', profileAccount.profile, id);
      await updateAccount(id, state => {
        if (state.profilePending !== pendingId) return;
        state.profilePending = null;
        state.profile = result.profile;
        state.identity.user = { ...state.identity.user, name: result.profile.name, profile: result.profile };
        state.identity.members = state.identity.members.map(member => member.id === id ? state.identity.user : member);
      });
    }
  };
  const promise = (navigator.locks ? navigator.locks.request(`lifeplanner-sync-${id}`, run) : run())
    .finally(() => running.delete(id));
  running.set(id, promise);
  return promise;
}
