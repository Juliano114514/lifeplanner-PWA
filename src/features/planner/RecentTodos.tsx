import { useEffect, useState } from 'react';
import { applyCommand, ensureOperation, localDateTime, today, toEpoch } from '../../../shared/domain';
import { enqueue, materialize, type Account } from '../../data/store';

export function RecentTodos({ account, ownerId = account.identity.user.id, sync }: { account: Account; ownerId?: string; sync?: () => void }) {
  const [error, setError] = useState(''), [saving, setSaving] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const zone = account.identity.timeZone;
  const recent = materialize(account).filter(task => !task.isArchived && task.ownerId === ownerId).flatMap(task => {
    // Generate nearby recurring instances in memory without changing the sync queue.
    const expanded = task.recurrence ? applyCommand(task, {
      mutationId: 'profile-preview', taskId: task.id, expectedVersion: task.version,
      operation: ensureOperation(today(zone, now)),
    }, account.identity.user.id, zone, now) : task;
    const nearest = expanded.occurrences.filter(item => item.status === 'PENDING').map(item => ({
      item, at: item.dueAt ?? toEpoch(`${item.plannedDate}T00:00`, zone),
    })).sort((a, b) => Math.abs(a.at - now) - Math.abs(b.at - now) || a.at - b.at)[0];
    return nearest ? [{ task, ...nearest }] : [];
  }).sort((a, b) => Math.abs(a.at - now) - Math.abs(b.at - now) || a.at - b.at || a.task.id.localeCompare(b.task.id)).slice(0, 5);
  const member = account.identity.members.find(value => value.id === ownerId) ?? account.identity.user;
  const profile = ownerId === account.identity.user.id ? account.profile ?? member.profile : member.profile;
  async function complete(taskId: string, plannedDate: string) {
    setSaving(taskId);
    try {
      const task = materialize(account).find(value => value.id === taskId);
      if (!task?.occurrences.some(value => value.plannedDate === plannedDate)) await enqueue(account.identity.user.id, taskId, ensureOperation(today(zone)));
      await enqueue(account.identity.user.id, taskId, { type: 'status', date: plannedDate, status: 'COMPLETED' });
      setError(''); sync?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败'); }
    finally { setSaving(null); }
  }
  return <section className="recent-todos" aria-label="最近的五条 Todo"><h3>最近的五条 Todo</h3>
    {error && <p className="notice error-text" role="alert">{error}</p>}
    {recent.length ? sync ? <div className="recent-task-cards">{recent.map(({ task, item }) => <article className="task-card planned-task-card" key={task.id}><div className="task-overview">
      <span className="avatar task-avatar" aria-hidden="true">{profile?.avatar ? <img src={profile.avatar} alt="" /> : (profile?.name || member.name).slice(0, 1)}</span>
      <div className="task-body"><strong className="task-title">{task.title}</strong><div className="metadata"><span>{item.dueAt === null ? `计划 ${item.plannedDate}` : `截止 ${localDateTime(item.dueAt, zone).replace('T', ' ')}`}</span></div></div>
      <input className="task-checkbox" type="checkbox" checked={false} disabled={saving !== null || !!account.conflicts[task.id]} aria-label={`完成任务：${task.title}`} onChange={() => void complete(task.id, item.plannedDate)} />
    </div></article>)}</div> : <ul className="profile-todos">{recent.map(({ task, item }) => <li key={task.id}><strong>{task.title}</strong><span className="muted">{item.dueAt === null ? `计划 ${item.plannedDate}` : `截止 ${localDateTime(item.dueAt, zone).replace('T', ' ')}`}</span></li>)}</ul> : <p className="empty">暂时没有待办，留点时间给生活。</p>}
  </section>;
}
