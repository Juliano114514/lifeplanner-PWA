import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EggHistory, EggSummary } from '../../../shared/egg';
import { api } from '../../data/api';
import type { Account } from '../../data/store';
import { PageHeading } from '../planner/PlannerUi';
import { EggDialog } from './EggDialog';

export function EggHistoryPage({ account, onEditing }: { account: Account; onEditing: (value: boolean) => void }) {
  const [entries, setEntries] = useState<EggSummary[]>([]), [cursor, setCursor] = useState<number | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null), [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    void api<EggHistory>('/api/v1/eggs').then(result => { if (active) { setEntries(result.entries); setCursor(result.nextCursor); setError(''); } }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '历史记录读取失败'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);
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
    <ul className="egg-history">{entries.map(item => <li key={item.id}><button onClick={() => setSelected(item.id)}><strong>{item.authorName}（{date(item.createdAt)}）改动</strong>{item.text && <small>{item.text}</small>}{item.imageName && <small>{item.imageName}</small>}</button></li>)}</ul>
    {loading && <p role="status">正在读取历史记录…</p>}{!loading && !error && !entries.length && <p className="empty">还没有彩蛋记录。</p>}
    {cursor !== null && <button className="text-button" disabled={loading} onClick={() => void more()}>加载更多</button>}
    {selected && <EggDialog key={selected} account={account} entryId={selected} onClose={() => { setSelected(null); setReload(value => value + 1); }} onEditing={onEditing} />}
  </>;
}
