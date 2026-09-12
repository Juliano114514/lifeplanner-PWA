import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EggHistory, EggSummary } from '../../../shared/egg';
import { api } from '../../data/api';
import type { Account } from '../../data/store';
import { Modal, PageHeading } from '../planner/PlannerUi';
import { EggDialog } from './EggDialog';

export function EggHistoryPage({ account, onEditing }: { account: Account; onEditing: (value: boolean) => void }) {
  const [entries, setEntries] = useState<EggSummary[]>([]), [cursor, setCursor] = useState<number | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [deleting, setDeleting] = useState<EggSummary | null>(null), [removing, setRemoving] = useState(false), [deleteError, setDeleteError] = useState('');
  const [selected, setSelected] = useState<string | null>(null), [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    void api<EggHistory>('/api/v1/eggs').then(result => { if (active) { setEntries(result.entries); setCursor(result.nextCursor); setError(''); } }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '历史记录读取失败'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);
  useEffect(() => {
    if (!deleting) return;
    onEditing(true);
    return () => onEditing(false);
  }, [deleting, onEditing]);
  async function remove() {
    if (!deleting || removing) return;
    setRemoving(true); setDeleteError('');
    try {
      await api(`/api/v1/eggs/${deleting.id}/delete`, {}, account.identity.user.id);
      setEntries(current => current.filter(item => item.id !== deleting.id)); setDeleting(null);
    } catch (reason) { setDeleteError(reason instanceof Error ? reason.message : '删除失败，请重试'); }
    finally { setRemoving(false); }
  }
  async function more() {
    if (cursor === null || loading) return;
    setLoading(true); setError('');
    try { const result = await api<EggHistory>(`/api/v1/eggs?before=${cursor}`); setEntries(current => [...current, ...result.entries.filter(value => !current.some(old => old.id === value.id))]); setCursor(result.nextCursor); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '历史记录读取失败'); }
    finally { setLoading(false); }
  }
  const date = (at: number) => new Intl.DateTimeFormat('zh-CN', { timeZone: account.identity.timeZone, year: 'numeric', month: 'long', day: 'numeric' }).format(at);
  return <><PageHeading title="历史记录" /><Link className="text-button back-link" to="/home">← 返回首页</Link>
    {error && <p className="notice error-text" role="alert">{error}<button className="text-button" disabled={loading} onClick={() => { setLoading(true); setReload(value => value + 1); }}>重试</button></p>}
    <ul className="egg-history">{entries.map(item => <HistoryItem key={item.id} item={item} date={date(item.createdAt)} onOpen={() => setSelected(item.id)} onDelete={() => { setDeleteError(''); setDeleting(item); }} />)}</ul>
    {deleting && <Modal title="删除这条彩蛋记录？" onClose={() => { if (!removing) setDeleting(null); }}><p>{deleting.authorName}（{date(deleting.createdAt)}）的这条记录及图片、录音将被删除，无法恢复。</p>{deleteError && <p className="notice error-text" role="alert">{deleteError}</p>}<div className="editor-footer"><button className="text-button" disabled={removing} onClick={() => setDeleting(null)}>取消</button><button className="primary" disabled={removing} onClick={() => void remove()}>{removing ? '删除中…' : '确认删除'}</button></div></Modal>}
    {loading && <p role="status">正在读取历史记录…</p>}{!loading && !error && !entries.length && <p className="empty">还没有彩蛋记录。</p>}
    {cursor !== null && <button className="text-button" disabled={loading} onClick={() => void more()}>加载更多</button>}
    {selected && <EggDialog key={selected} account={account} entryId={selected} onClose={() => { setSelected(null); setReload(value => value + 1); }} onEditing={onEditing} />}
  </>;
}

function HistoryItem({ item, date, onOpen, onDelete }: { item: EggSummary; date: string; onOpen: () => void; onDelete: () => void }) {
  const press = useRef<{ timer?: number; x: number; y: number; fired: boolean }>({ x: 0, y: 0, fired: false });
  useEffect(() => { const state = press.current; return () => clearTimeout(state.timer); }, []);
  function cancel() { clearTimeout(press.current.timer); }
  return <li><button className="egg-history-item" onPointerDown={event => {
    cancel();
    if (!event.isPrimary || event.button !== 0) return;
    press.current = { x: event.clientX, y: event.clientY, fired: false, timer: window.setTimeout(() => { press.current.fired = true; onDelete(); }, 600) };
  }} onPointerMove={event => { if (Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10) cancel(); }} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
    onContextMenu={event => { event.preventDefault(); cancel(); if (!press.current.fired) { press.current.fired = true; onDelete(); } }}
    onKeyDown={event => { if (event.key === 'Delete' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); onDelete(); } }}
    onClick={event => { if (press.current.fired) { event.preventDefault(); press.current.fired = false; return; } onOpen(); }}>
    <strong>{item.authorName}（{date}）改动</strong>{item.text && <small>{item.text}</small>}{item.imageName && <small>{item.imageName}</small>}
  </button></li>;
}
