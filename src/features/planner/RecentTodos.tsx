import { useEffect, useState } from 'react';
import { applyCommand, ensureOperation, localDateTime, today, toEpoch } from '../../../shared/domain';
import { materialize, type Account } from '../../data/store';

export function RecentTodos({ account }: { account: Account }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const zone = account.identity.timeZone;
  const recent = materialize(account).filter(task => !task.isArchived && task.ownerId === account.identity.user.id).flatMap(task => {
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
  return <section className="recent-todos" aria-label="最近的五条 Todo"><h3>最近的五条 Todo</h3><p className="hint">我的未完成任务 · 按时间接近程度排序，重复任务仅显示最近一次。</p>
      {recent.length ? <ul className="profile-todos">{recent.map(({ task, item }) => <li key={task.id}><strong>{task.title}</strong><span className="muted">{item.dueAt === null ? `计划 ${item.plannedDate}` : `截止 ${localDateTime(item.dueAt, zone).replace('T', ' ')}`}</span></li>)}</ul> : <p className="empty">暂时没有待办，留点时间给生活。</p>}
    </section>;
}
