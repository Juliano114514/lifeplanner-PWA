import { useEffect, useState } from 'react';
import { today } from '../../../shared/domain';
import type { DiaryDay, DiaryEntry, DiaryEntryType } from '../../../shared/planner';
import { enqueuePlanner, materializePlanner, type Account } from '../../data/store';
import { DateNavigator, Modal, PageHeading, SectionHeading } from '../planner/PlannerUi';

export function DiaryPage({ account, sync, onEditing }: { account: Account; sync: () => void; onEditing: (value: boolean) => void }) {
  const zone = account.identity.timeZone, planner = materializePlanner(account);
  const [date, setDate] = useState(() => today(zone));
  const saved = planner.diaryDays.find(value => value.date === date);
  const savedKey = JSON.stringify(saved ?? null);
  const [entries, setEntries] = useState<DiaryEntry[]>(saved?.entries ?? []), [text, setText] = useState(saved?.text ?? '');
  const [happy, setHappy] = useState(''), [unhappy, setUnhappy] = useState(''), [editing, setEditing] = useState<DiaryEntry | null>(null);
  const [dirty, setDirty] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  useEffect(() => { const value = JSON.parse(savedKey) as DiaryDay | null; setEntries(value?.entries ?? []); setText(value?.text ?? ''); setDirty(false); }, [date, savedKey]);
  useEffect(() => { onEditing(dirty || editing !== null); return () => onEditing(false); }, [dirty, editing, onEditing]);
  const recorded = new Set(planner.diaryDays.filter(value => value.text || value.entries.length).map(value => value.date));
  const add = (type: DiaryEntryType) => {
    const value = (type === 'HAPPY' ? happy : unhappy).trim(); if (!value) return;
    setEntries(current => current.concat({ id: crypto.randomUUID(), type, content: value, createdAt: Date.now(), updatedAt: Date.now() }));
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
    <DiarySection title="感到开心的事" empty="还没有开心条目。" entries={entries.filter(value => value.type === 'HAPPY')} value={happy} onValue={setHappy} onAdd={() => add('HAPPY')} onEdit={setEditing} />
    <DiarySection title="感到不开心的事" empty="还没有不开心条目。" entries={entries.filter(value => value.type === 'UNHAPPY')} value={unhappy} onValue={setUnhappy} onAdd={() => add('UNHAPPY')} onEdit={setEditing} />
    <section className="diary-text" id="diary-editor"><SectionHeading title={date === today(zone) ? '今日日记' : '当日日记'} />
      <textarea rows={9} value={text} placeholder="完整记录今天发生的事、感受与想法……" onChange={event => { setText(event.target.value); setDirty(true); }} />
      <button className="primary full" disabled={saving || !dirty} onClick={() => void save()}>{saving ? '保存中…' : dirty ? '保存日记' : '已保存'}<span>↗</span></button>
      {saved?.text && <article className="tonal-card"><strong>已保存</strong><p>{saved.text}</p></article>}
    </section>
    {editing && <EntryEditor entry={editing} onClose={() => setEditing(null)} onSave={(content, type) => { setEntries(current => current.map(value => value.id === editing.id ? { ...value, content, type, updatedAt: Date.now() } : value)); setDirty(true); setEditing(null); }} onDelete={() => { setEntries(current => current.filter(value => value.id !== editing.id)); setDirty(true); setEditing(null); }} />}
  </>;
}

function DiarySection({ title, empty, entries, value, onValue, onAdd, onEdit }: { title: string; empty: string; entries: DiaryEntry[]; value: string; onValue: (value: string) => void; onAdd: () => void; onEdit: (entry: DiaryEntry) => void }) {
  return <section className="diary-section"><SectionHeading title={title} count={entries.length} /><div className="inline-editor"><input maxLength={2000} value={value} placeholder="新增条目" onChange={event => onValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') onAdd(); }} /><button className="secondary" disabled={!value.trim()} onClick={onAdd}>＋ 添加</button></div>
    {!entries.length ? <p className="empty compact-empty">{empty}</p> : <div className="diary-entries">{entries.map(entry => <button key={entry.id} onClick={() => onEdit(entry)}><span aria-hidden="true">{entry.type === 'HAPPY' ? '♥' : '◆'}</span><p>{entry.content}</p><small>点击预览和修改</small></button>)}</div>}
  </section>;
}
function EntryEditor({ entry, onClose, onSave, onDelete }: { entry: DiaryEntry; onClose: () => void; onSave: (content: string, type: DiaryEntryType) => void; onDelete: () => void }) {
  const [content, setContent] = useState(entry.content), [type, setType] = useState(entry.type);
  return <Modal title="编辑条目" onClose={onClose}><div className="choice-grid"><button className={`choice-chip ${type === 'HAPPY' ? 'selected' : ''}`} onClick={() => setType('HAPPY')}>开心</button><button className={`choice-chip ${type === 'UNHAPPY' ? 'selected' : ''}`} onClick={() => setType('UNHAPPY')}>不开心</button></div>
    <label>条目内容<textarea rows={5} value={content} onChange={event => setContent(event.target.value)} /></label>
    <div className="editor-footer"><button className="danger-text" onClick={() => { if (window.confirm('删除后无法恢复，确认删除？')) onDelete(); }}>删除</button><div className="actions"><button className="text-button" onClick={onClose}>取消</button><button className="primary" disabled={!content.trim()} onClick={() => onSave(content.trim(), type)}>保存</button></div></div>
  </Modal>;
}
