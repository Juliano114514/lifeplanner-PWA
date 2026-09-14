import { useEffect, useState } from 'react';
import { today } from '../../../shared/domain';
import type { DiaryDay, DiaryEntry, DiaryEntryType, DiaryText } from '../../../shared/planner';
import { enqueuePlanner, materializePlanner, type Account } from '../../data/store';
import { DateNavigator, Modal, PageHeading, SectionHeading } from '../planner/PlannerUi';

export function DiaryPage({ account, sync, onEditing }: { account: Account; sync: () => void; onEditing: (value: boolean) => void }) {
  const zone = account.identity.timeZone, planner = materializePlanner(account);
  const userId = account.identity.user.id;
  const ownerName = (id: string) => account.identity.members.find(member => member.id === id)?.name ?? (id ? '成员' : '历史条目');
  const [date, setDate] = useState(() => today(zone));
  const saved = planner.diaryDays.find(value => value.date === date);
  const savedKey = JSON.stringify(saved ?? null);
  const [entries, setEntries] = useState<DiaryEntry[]>(saved?.entries ?? []), [text, setText] = useState(saved?.texts.find(value => value.ownerId === userId)?.content ?? '');
  const [preview, setPreview] = useState<DiaryText | null>(null);
  const [happy, setHappy] = useState(''), [unhappy, setUnhappy] = useState(''), [editing, setEditing] = useState<DiaryEntry | null>(null);
  const [dirty, setDirty] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  useEffect(() => { const value = JSON.parse(savedKey) as DiaryDay | null; setEntries(value?.entries ?? []); setText(value?.texts.find(item => item.ownerId === userId)?.content ?? ''); setDirty(false); setPreview(null); }, [date, savedKey, userId]);
  useEffect(() => { onEditing(dirty || editing !== null); return () => onEditing(false); }, [dirty, editing, onEditing]);
  const recorded = new Set(planner.diaryDays.filter(value => value.texts.length || value.entries.length).map(value => value.date));
  const add = (type: DiaryEntryType) => {
    const value = (type === 'HAPPY' ? happy : unhappy).trim(); if (!value) return;
    setEntries(current => current.concat({ id: crypto.randomUUID(), type, content: value, createdBy: userId, createdAt: Date.now(), updatedAt: Date.now() }));
    if (type === 'HAPPY') setHappy(''); else setUnhappy(''); setDirty(true);
  };
  async function save() {
    setSaving(true);
    try { await enqueuePlanner(account.identity.user.id, { type: 'saveDiaryDay', date, text, entries: entries.map(({ id, type, content, createdAt }) => ({ id, type, content, createdAt })) }); setDirty(false); setError(''); sync(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败'); }
    finally { setSaving(false); }
  }
  return <>
    <PageHeading title="日记" action={<button className="primary" onClick={() => document.getElementById('diary-editor')?.scrollIntoView({ behavior: 'smooth' })}>编辑日记<span>✎</span></button>} />
    <DateNavigator date={date} zone={zone} recorded={recorded} onChange={setDate} />
    {error && <p className="notice error-text" role="alert">{error}</p>}
    <DiarySection title="感到开心的事" empty="还没有开心条目。" entries={entries.filter(value => value.type === 'HAPPY')} value={happy} onValue={setHappy} onAdd={() => add('HAPPY')} onEdit={setEditing} userId={userId} ownerName={ownerName} />
    <DiarySection title="感到不开心的事" empty="还没有不开心条目。" entries={entries.filter(value => value.type === 'UNHAPPY')} value={unhappy} onValue={setUnhappy} onAdd={() => add('UNHAPPY')} onEdit={setEditing} userId={userId} ownerName={ownerName} />
    <section className="diary-section diary-text" id="diary-editor"><SectionHeading title={date === today(zone) ? '今日日记' : '当日日记'} count={saved?.texts.length ?? 0} />
      <textarea rows={5} maxLength={20000} value={text} placeholder="写下自己的日记，每人每天一篇……" onChange={event => { setText(event.target.value); setDirty(true); }} />
      <p className="hint">输入框只显示自己的日记；留空不保存日记条目，清空后保存会移除自己的当日日记。</p>
      <button className="primary full" disabled={saving || !dirty} onClick={() => void save()}>{saving ? '保存中…' : dirty ? '保存日记' : '已保存'}<span>↗</span></button>
      {!saved?.texts.length ? <p className="empty compact-empty">还没有当日日记。</p> : <div className="diary-entries">{saved.texts.map(item => <button key={item.ownerId} onClick={() => setPreview(item)}><span className={`owner ${item.ownerId === userId ? '' : 'other'}`}>{ownerName(item.ownerId)}</span><p>{item.content}</p><small>点击预览</small></button>)}</div>}
    </section>
    {preview && <Modal title={`${ownerName(preview.ownerId)}的日记`} onClose={() => setPreview(null)}><p className="diary-preview">{preview.content}</p>{preview.ownerId === userId && <button className="primary" onClick={() => { setPreview(null); document.querySelector<HTMLTextAreaElement>('#diary-editor textarea')?.focus(); }}>编辑我的日记</button>}</Modal>}
    {editing && <EntryEditor entry={editing} onClose={() => setEditing(null)} onSave={(content, type) => { setEntries(current => current.map(value => value.id === editing.id ? { ...value, content, type, updatedAt: Date.now() } : value)); setDirty(true); setEditing(null); }} onDelete={() => { setEntries(current => current.filter(value => value.id !== editing.id)); setDirty(true); setEditing(null); }} />}
  </>;
}

function DiarySection({ title, empty, entries, value, onValue, onAdd, onEdit, userId, ownerName }: { title: string; empty: string; entries: DiaryEntry[]; value: string; onValue: (value: string) => void; onAdd: () => void; onEdit: (entry: DiaryEntry) => void; userId: string; ownerName: (id: string) => string }) {
  return <section className="diary-section"><SectionHeading title={title} count={entries.length} /><div className="inline-editor"><input maxLength={2000} value={value} placeholder="新增条目" onChange={event => onValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') onAdd(); }} /><button className="secondary" disabled={!value.trim()} onClick={onAdd}>＋ 添加</button></div>
    {!entries.length ? <p className="empty compact-empty">{empty}</p> : <div className="diary-entries">{entries.map(entry => <button key={entry.id} onClick={() => onEdit(entry)}><span className={`owner ${entry.createdBy === userId ? '' : 'other'}`}>{ownerName(entry.createdBy)}</span><p>{entry.content}</p><small>点击预览和修改</small></button>)}</div>}
  </section>;
}
function EntryEditor({ entry, onClose, onSave, onDelete }: { entry: DiaryEntry; onClose: () => void; onSave: (content: string, type: DiaryEntryType) => void; onDelete: () => void }) {
  const [content, setContent] = useState(entry.content), [type, setType] = useState(entry.type);
  return <Modal title="编辑条目" onClose={onClose}><div className="choice-grid"><button className={`choice-chip ${type === 'HAPPY' ? 'selected' : ''}`} onClick={() => setType('HAPPY')}>开心</button><button className={`choice-chip ${type === 'UNHAPPY' ? 'selected' : ''}`} onClick={() => setType('UNHAPPY')}>不开心</button></div>
    <label>条目内容<textarea rows={5} value={content} onChange={event => setContent(event.target.value)} /></label>
    <div className="editor-footer"><button className="danger-text" onClick={() => { if (window.confirm('删除后无法恢复，确认删除？')) onDelete(); }}>删除</button><div className="actions"><button className="text-button" onClick={onClose}>取消</button><button className="primary" disabled={!content.trim()} onClick={() => onSave(content.trim(), type)}>保存</button></div></div>
  </Modal>;
}
