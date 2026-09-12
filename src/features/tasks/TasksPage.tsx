import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Operation, Task } from '../../../shared/contracts';
import { ensureOperation, localDateTime, needsEnsure, organize, today } from '../../../shared/domain';
import { enqueue, enqueuePlanner, loadDraft, materialize, materializePlanner, resolveConflict, type Account, type EditorDraft } from '../../data/store';
import { Badge, formatMinute, PageHeading } from '../planner/PlannerUi';
import { TaskEditor } from './TaskEditor';

const groupNames = { urgent: '置顶 / 临近15天', todayPending: '今日未完成', todayCompleted: '今日已完成', others: '其他任务' };
const recurrenceNames = { DAILY: '每日', WEEKLY: '每周', MONTHLY: '每月' };
const groupKeys = ['urgent', 'todayPending', 'todayCompleted', 'others'] as const;
function TaskSummary({ task, zone, name }: { task: Task | null; zone: string; name: (id: string) => string }) {
  if (!task) return <p>云端尚无此任务。</p>;
  return <><p><strong>{task.title}</strong></p><p>{task.note || '无备注'}</p>
    <p>归属：{name(task.ownerId)} · {task.isArchived ? '已归档' : task.isPinned ? '已置顶' : '普通任务'}</p>
    <p>开始：{task.recurrenceStart} · {task.recurrence ? recurrenceNames[task.recurrence] : '不重复'}</p>
    <p>截止：{task.dueAt === null ? '未设置' : localDateTime(task.dueAt, zone).replace('T', ' ')}</p>
    <p>最后修改：{name(task.updatedBy)} · {localDateTime(task.updatedAt, zone).replace('T', ' ')}</p>
    <details><summary>查看各次完成状态</summary>{task.occurrences.map(o => <p key={o.id}>{o.plannedDate} · {o.status === 'COMPLETED' ? '已完成' : o.status === 'SKIPPED' ? '已跳过' : '待办'}</p>)}</details></>;
}
export function TasksPage({ account, sync, onEditing }: { account: Account; sync: () => void; onEditing: (value: boolean) => void }) {
  const { identity } = account, userId = identity.user.id, zone = identity.timeZone;
  const date = today(zone), navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [archived, setArchived] = useState(false);
  const [editor, setEditor] = useState<EditorDraft | null>(null);
  const [resume, setResume] = useState<EditorDraft | null>(null);
  const [error, setError] = useState('');
  const tasks = useMemo(() => materialize(account), [account]);
  const visible = tasks.filter(t => filter === 'all' || (filter === 'mine' ? t.ownerId === userId : t.ownerId !== userId));
  const groups = organize(visible, date, zone);
  const ownerName = (id: string) => identity.members.find(m => m.id === id)?.name ?? '成员';
  const ownerAvatar = (id: string) => (id === userId ? account.profile : identity.members.find(m => m.id === id)?.profile)?.avatar;
  const schedules = materializePlanner(account).schedules.filter(value => value.date === date && !value.isArchived);
  const pendingSchedules = schedules.filter(value => value.status !== 'COMPLETED').sort((a, b) => a.startMinute - b.startMinute);
  const completedSchedules = schedules.filter(value => value.status === 'COMPLETED').sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  useEffect(() => { let active = true; void loadDraft(userId).then(value => { if (active) setResume(value ?? null); }).catch(() => setError('无法读取本地草稿'));
    return () => { active = false; }; }, [userId, editor]);
  useEffect(() => {
    onEditing(editor !== null);
    return () => onEditing(false);
  }, [editor, onEditing]);
  useEffect(() => {
    let cancelled = false;
    async function generate() {
      let changed = false;
      for (const task of tasks) {
        if (cancelled) return;
        if (!account.conflicts[task.id] && needsEnsure(task, date)) {
          await enqueue(userId, task.id, ensureOperation(date)); changed = true;
        }
      }
      if (changed) sync();
    }
    void generate().catch(e => setError(e instanceof Error ? e.message : '任务实例生成失败'));
    return () => { cancelled = true; };
  }, [tasks, account.conflicts, date, userId, sync]);

  async function act(taskId: string, operation: Operation) {
    try { await enqueue(userId, taskId, operation, tasks.find(task => task.id === taskId)?.version); setError(''); sync(); }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败'); }
  }
  function edit(task?: Task) {
    if (resume) { setEditor(resume); return; }
    setEditor({ taskId: task?.id ?? crypto.randomUUID(), existing: !!task, baselineVersion: task?.version ?? 0, draft: task ? {
      title: task.title, note: task.note, dueAt: task.dueAt, isPinned: task.isPinned,
      recurrence: task.recurrence, recurrenceStart: task.recurrenceStart, ownerId: task.ownerId,
    } : { title: '', note: '', dueAt: null, isPinned: false, recurrence: null, recurrenceStart: date, ownerId: userId } });
  }
  async function toggleSchedule(id: string, completed: boolean) {
    const block = schedules.find(value => value.id === id), status = completed ? 'PENDING' : 'COMPLETED';
    try {
      await enqueuePlanner(userId, { type: 'scheduleStatus', id, status });
      if (block?.taskId && block.occurrenceDate) await enqueue(userId, block.taskId, { type: 'status', date: block.occurrenceDate, status });
      setError(''); sync();
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : '日程操作失败'); }
  }
  return <>
    <PageHeading title="任务计划" action={<button className="primary desktop-add" onClick={() => edit()}>新增任务<span>＋</span></button>} />
    <div className="filter-row"><div className="segmented" aria-label="任务归属筛选">{[['all', '全部'], ['mine', '我的'], ['other', '对方的']].map(([value, label]) =>
      <button key={value} aria-pressed={filter === value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div>
      <button className="text-button" aria-pressed={archived} onClick={() => setArchived(!archived)}>{archived ? '返回待办' : '查看归档'}</button></div>
    {resume && !editor && <div className="notice">有一份未保存的任务草稿。<button className="text-button" onClick={() => setEditor(resume)}>继续编辑 ↗</button></div>}
    {error && <p className="notice error-text" role="alert">{error}</p>}
    {Object.entries(account.conflicts).map(([taskId, conflict]) => {
      const local = tasks.find(t => t.id === taskId);
      return <section className="conflict" key={taskId} role="alert"><p className="eyebrow">需要你来决定</p><h3>「{local?.title}」有不同版本</h3><p>{conflict.message}</p>
        <div className="compare"><div><strong>本机内容</strong><TaskSummary task={local ?? null} zone={zone} name={ownerName} /></div><div><strong>云端内容</strong><TaskSummary task={conflict.current} zone={zone} name={ownerName} /></div></div>
        <div className="actions"><button onClick={async () => { await resolveConflict(userId, taskId, 'cloud'); sync(); }}>采用云端，放弃本机修改</button>
          <button onClick={async () => { try { await resolveConflict(userId, taskId, 'local'); setError(''); sync(); } catch (e) { setError(e instanceof Error ? e.message : '无法重新提交，请采用云端后重新编辑'); } }}>
            {conflict.current && !conflict.current.isArchived ? '重新提交本机修改' : '将本机内容另存为新任务'}</button></div>
        <p className="hint">重新提交只重放本机操作；云端已归档时另建任务，不恢复原任务。</p></section>;
    })}
    {archived ? <section className="task-section"><div className="section-heading"><h2>已归档</h2><span>{visible.filter(t => t.isArchived).length} 件事</span></div>
      {visible.filter(t => t.isArchived).map(t => <article className="task-card" key={t.id}><div><h3>{t.title}</h3><p className="muted">{ownerName(t.ownerId)} · 已归档</p></div></article>)}
      {!visible.some(t => t.isArchived) && <p className="empty">还没有归档的任务。</p>}</section>
      : groupKeys.map(key => <div className="task-group" key={key}>{key === 'todayCompleted' && pendingSchedules.length > 0 && <section className="task-section"><div className="section-heading"><h2>今日日程</h2><span>{pendingSchedules.length}</span></div>
        {pendingSchedules.map(block => <article className="task-card schedule-task-card" key={block.id}><button className="completion" onClick={() => void toggleSchedule(block.id, false)} aria-label={`完成日程：${block.title}`} />
          <button className="task-body card-main" onClick={() => navigate(`/schedule?date=${date}`)}><strong>{block.title}</strong><span>{formatMinute(block.startMinute)}–{formatMinute(block.endMinute)}</span>{block.note && <p>{block.note}</p>}</button><Badge>{block.taskId ? '任务' : block.source === 'QUICK_PLAN' ? '快速安排' : '手动'}</Badge></article>)}</section>}
        <section className="task-section">
        <div className="section-heading"><h2><span className={`section-dot ${key}`} />{groupNames[key]}</h2><span>{groups[key].length.toString().padStart(2, '0')}</span></div>
        {key === 'todayCompleted' && completedSchedules.map(block => <article className="task-card schedule-task-card is-done" key={block.id}><button className="completion" onClick={() => void toggleSchedule(block.id, true)} aria-label={`恢复日程：${block.title}`}>✓</button><button className="task-body card-main" onClick={() => navigate(`/schedule?date=${date}`)}><strong>{block.title}</strong><span>{formatMinute(block.startMinute)}–{formatMinute(block.endMinute)}</span></button><Badge tone="success">已完成</Badge></article>)}
        {groups[key].map(({ task, occurrence }) => <article className={`task-card planned-task-card ${occurrence?.status === 'COMPLETED' ? 'is-done' : ''}`} key={task.id}>
          <div className="task-overview">
          <span className="avatar task-avatar" aria-hidden="true">{ownerAvatar(task.ownerId) ? <img src={ownerAvatar(task.ownerId)} alt="" /> : ownerName(task.ownerId).slice(0, 1)}</span>
          <div className="task-body"><div className="task-title-row"><button className="task-title" onClick={() => edit(task)} disabled={!!account.conflicts[task.id]}>{task.title}</button>
            {task.isPinned && <span className="pin-label">置顶</span>}</div>
            <div className="metadata"><span className={`owner ${task.ownerId === userId ? '' : 'other'}`}>{ownerName(task.ownerId)}</span>
              {(occurrence?.dueAt ?? task.dueAt) !== null && <span>截止 {localDateTime((occurrence?.dueAt ?? task.dueAt)!, zone).replace('T', ' ')}</span>}
            </div></div>
          <input className="task-checkbox" type="checkbox" checked={occurrence?.status === 'COMPLETED'} disabled={!occurrence || !!account.conflicts[task.id]} aria-label={`完成任务：${task.title}`}
            onChange={event => occurrence && void act(task.id, { type: 'status', date: occurrence.plannedDate, status: event.target.checked ? 'COMPLETED' : 'PENDING' })} />
          </div>
          <div className="task-extra">
            {task.note && <p className="task-note">{task.note}</p>}
            <div className="metadata">
              {task.recurrence && <span>↻ {recurrenceNames[task.recurrence]}</span>}
              {occurrence && <span>{occurrence.plannedDate}</span>}
              {account.pending.some(p => p.command.taskId === task.id) && <span>待同步</span>}</div>
            <details className="task-details"><summary>操作与记录</summary><div className="actions">
              <button disabled={!!account.conflicts[task.id]} onClick={() => edit(task)}>编辑 / 转交</button>
              <button onClick={() => void act(task.id, { type: 'pin', pinned: !task.isPinned })}>{task.isPinned ? '取消置顶' : '置顶'}</button>
              {occurrence && <button onClick={() => navigate(`/schedule?date=${occurrence.plannedDate}&task=${task.id}`)}>安排</button>}
              {occurrence?.status === 'PENDING' && <button onClick={() => void act(task.id, { type: 'status', date: occurrence.plannedDate, status: 'SKIPPED' })}>跳过本次</button>}
              <button onClick={() => { if (window.confirm(`归档「${task.title}」？归档后将从待办隐藏。`)) void act(task.id, { type: 'archive' }); }}>归档</button></div>
              <p className="hint">创建：{ownerName(task.createdBy)} · 最后修改：{ownerName(task.updatedBy)}</p>
              {task.occurrences.filter(o => o.status !== 'PENDING').map(o => <div className="history-row" key={o.id}><span>{o.plannedDate} · {o.status === 'SKIPPED' ? '已跳过' : '已完成'}</span>
                <button className="text-button" onClick={() => void act(task.id, { type: 'status', date: o.plannedDate, status: 'PENDING' })}>恢复待办</button></div>)}
            </details></div>
        </article>)}
        {!groups[key].length && !(key === 'todayCompleted' && completedSchedules.length) && <p className="empty">{key === 'todayCompleted' ? '完成的小事，会在这里慢慢积累。' : '这里暂时没有安排，留一点空白也很好。'}</p>}
      </section></div>)}
    <button className="primary mobile-add" onClick={() => edit()}>＋ 新增任务</button>
    {editor && <TaskEditor key={editor.taskId} identity={identity} initial={editor} onClose={() => setEditor(null)} onSaved={sync} />}
  </>;
}
