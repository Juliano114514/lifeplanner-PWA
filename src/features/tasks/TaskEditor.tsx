import { useEffect, useRef, useState } from 'react';
import type { Identity, TaskDraft } from '../../../shared/contracts';
import { draftSchema } from '../../../shared/contracts';
import { localDateTime, toEpoch } from '../../../shared/domain';
import { enqueue, removeDraft, storeDraft, type EditorDraft } from '../../data/store';

interface Props { identity: Identity; initial: EditorDraft; onClose: () => void; onSaved: () => void }
export function TaskEditor({ identity, initial, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState(initial.draft);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const persistence = useRef(Promise.resolve());
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    persistence.current = persistence.current.catch(() => undefined)
      .then(async () => { await storeDraft(identity.user.id, { ...initial, draft }); })
      .catch(() => { setError('草稿无法保存到本机，请检查浏览器存储空间'); });
  }, [draft, identity.user.id, initial]);
  const change = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => setDraft(old => ({ ...old, [key]: value }));
  async function close() { await persistence.current; onClose(); }
  async function discard() {
    try { await persistence.current; await removeDraft(identity.user.id); onClose(); }
    catch { setError('未能删除草稿，请稍后重试'); }
  }
  async function save() {
    const parsed = draftSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '请检查输入'); return; }
    setSaving(true);
    try {
      await persistence.current;
      await enqueue(identity.user.id, initial.taskId, { type: 'save', draft: parsed.data }, initial.baselineVersion);
      await removeDraft(identity.user.id);
      onSaved(); onClose();
    } catch (error) { setError(error instanceof Error ? error.message : '保存失败'); }
    finally { setSaving(false); }
  }
  return <dialog className="editor" ref={dialog} onCancel={event => { event.preventDefault(); if (!saving) void close(); }}>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="section-heading"><div><p className="eyebrow">MAKE A LITTLE SPACE</p><h2>{initial.existing ? '修改任务' : '记下一件事'}</h2></div>
        <button type="button" className="icon-button" aria-label="关闭并保留草稿" disabled={saving} onClick={() => void close()}>×</button></div>
      <label>要做什么<input autoFocus required maxLength={200} value={draft.title} placeholder="让今天轻松一点的小事" onChange={e => change('title', e.target.value)} /></label>
      <label>备注<textarea rows={3} maxLength={10000} value={draft.note} placeholder="想法、细节，或者一句提醒" onChange={e => change('note', e.target.value)} /></label>
      <div className="form-grid"><label>归属人<select value={draft.ownerId} onChange={e => change('ownerId', e.target.value)}>{identity.members.map(m => <option key={m.id} value={m.id}>{m.name}{m.id === identity.user.id ? '（我）' : ''}</option>)}</select></label>
        <label>开始日期<input type="date" required value={draft.recurrenceStart} onChange={e => change('recurrenceStart', e.target.value)} /></label></div>
      <label>截止时间 · 可选<input type="datetime-local" value={draft.dueAt === null ? '' : localDateTime(draft.dueAt, identity.timeZone)} onChange={e => {
        try { change('dueAt', e.target.value ? toEpoch(e.target.value, identity.timeZone) : null); setError(''); }
        catch { setError('截止时间无效'); }
      }} /></label>
      <p className="hint">所有日期与时间按 {identity.timeZone} 记录。</p>
      <div className="form-grid"><label>重复<select value={draft.recurrence ?? ''} onChange={e => change('recurrence', (e.target.value || null) as TaskDraft['recurrence'])}>
        <option value="">不重复</option><option value="DAILY">每天</option><option value="WEEKLY">每周</option><option value="MONTHLY">每月</option></select></label>
        <label className="checkbox"><input type="checkbox" checked={draft.isPinned} onChange={e => change('isPinned', e.target.checked)} />置顶关注</label></div>
      {initial.existing && <p className="hint">修改会按新规则重建今天起的待办实例，保留已经完成或跳过的记录。</p>}
      {error && <p role="alert" className="error-text">{error}</p>}
      <div className="editor-footer"><button type="button" className="text-button" disabled={saving} onClick={() => void discard()}>丢弃草稿</button><button className="primary" disabled={saving}>{saving ? '保存中…' : '保存任务'}<span>↗</span></button></div>
      <p className="hint">保存到本机后自动同步；关闭编辑页会保留草稿。</p>
    </form>
  </dialog>;
}
