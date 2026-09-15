import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { localDateTime } from '../../../shared/domain';
import { wishDraftSchema, wishHorizons, wishKinds, type Place, type Wish, type WishDraft, type WishKind } from '../../../shared/wish';
import { api } from '../../data/api';
import { enqueuePlanner, materializePlanner, type Account } from '../../data/store';
import { Modal, PageHeading, SectionHeading } from '../planner/PlannerUi';
import { LongPressArticle } from '../planner/LongPressArticle';

const kinds = Object.keys(wishKinds) as WishKind[];
const horizons = Object.keys(wishHorizons) as WishDraft['horizon'][];
const symbols = { GO: '⌖', EAT: '◒', BUY: '♧' };
const budgetLabel = (value: number | null) => value === null ? '预算未定' : `预算 ¥${value.toFixed(2)}`;

export function WishesHome() {
  return <><PageHeading title="愿望" /><div className="inventory-menu">{kinds.map(kind => <Link className="content-card inventory-menu-item" key={kind} to={`/wishes/${kind.toLowerCase()}`}><span aria-hidden="true">{symbols[kind]}</span><strong>{wishKinds[kind]}</strong><span aria-hidden="true">›</span></Link>)}</div></>;
}

export function WishesPage({ account, sync, onEditing, recipes = false }: { account: Account; sync: () => void; onEditing: (value: boolean) => void; recipes?: boolean }) {
  const { kind: routeKind } = useParams();
  const label = recipes ? '菜谱' : '愿望';
  const kind = recipes ? 'EAT' : kinds.find(value => value.toLowerCase() === routeKind);
  const [editor, setEditor] = useState<Wish | 'new' | null>(null), [filter, setFilter] = useState('all');
  const [archived, setArchived] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const acting = useRef(false);
  const { identity } = account, userId = identity.user.id, blocked = !!account.plannerConflict || busy;
  const name = (id: string) => identity.members.find(member => member.id === id)?.name ?? '成员';
  const avatar = (id: string) => (id === userId ? account.profile : identity.members.find(member => member.id === id)?.profile)?.avatar;
  const stamp = (at: number) => localDateTime(at, identity.timeZone).replace('T', ' ');
  useEffect(() => { onEditing(editor !== null); return () => onEditing(false); }, [editor, onEditing]);
  async function run(operation: Parameters<typeof enqueuePlanner>[1]) {
    if (acting.current) throw new Error('正在保存，请稍候');
    acting.current = true; setBusy(true);
    try { await enqueuePlanner(userId, operation); setError(''); sync(); }
    finally { acting.current = false; setBusy(false); }
  }
  function act(operation: Parameters<typeof enqueuePlanner>[1]) {
    void run(operation).catch(reason => setError(reason instanceof Error ? reason.message : '操作失败'));
  }
  if (!kind) return <><PageHeading title="未找到愿望分类" /><Link to="/wishes">返回愿望</Link></>;
  const wishes = materializePlanner(account)[recipes ? 'recipes' : 'wishes'].filter(wish => wish.deletedAt === undefined && (recipes || wish.kind === kind) && wish.isArchived === archived &&
    (filter === 'all' || (filter === 'mine' ? wish.ownerId === userId : wish.ownerId !== userId)));
  const pending = wishes.filter(wish => wish.status === 'PENDING').sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || horizons.indexOf(a.horizon) - horizons.indexOf(b.horizon) || b.updatedAt - a.updatedAt);
  const completed = wishes.filter(wish => wish.status === 'COMPLETED').sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  function card(wish: Wish) {
    const done = wish.status === 'COMPLETED';
    const map = wish.coordinates ? `https://www.openstreetmap.org/?mlat=${wish.coordinates.latitude}&mlon=${wish.coordinates.longitude}#map=16/${wish.coordinates.latitude}/${wish.coordinates.longitude}` : null;
    return <LongPressArticle className={`task-card planned-task-card wish-card ${done ? 'is-done' : ''}`} key={wish.id} enabled={archived && !blocked} title={wish.name} onDelete={() => act({ type: recipes ? 'deleteRecipe' : 'deleteWish', id: wish.id })}>
      <div className="task-overview"><span className="avatar task-avatar" aria-hidden="true">{avatar(wish.ownerId) ? <img src={avatar(wish.ownerId)} alt="" /> : name(wish.ownerId).slice(0, 1)}</span>
        <div className="task-body"><div className="wish-title-row"><button className="task-title" disabled={archived || blocked} onClick={() => setEditor(wish)}>{wish.name}</button>{wish.isPinned && <span className="pin-label">置顶</span>}
          {wish.address && (map ? <a className="wish-address" href={map} target="_blank" rel="noreferrer" aria-label={`在地图查看：${wish.address}`}>📍 {wish.address}</a> : <span className="wish-address">📍 {wish.address}</span>)}</div>
          <div className="metadata"><span>{wishHorizons[wish.horizon]}</span><span>{budgetLabel(wish.budget)}</span><span className={`owner ${wish.ownerId === userId ? '' : 'other'}`}>{name(wish.ownerId)}</span></div></div>
        <input className="task-checkbox" type="checkbox" checked={done} disabled={archived || blocked} aria-label={`${done ? '恢复' : '完成'}${label}：${wish.name}`} onChange={() => act({ type: recipes ? 'recipeStatus' : 'wishStatus', id: wish.id, status: done ? 'PENDING' : 'COMPLETED' })} />
      </div><div className="task-extra">{wish.note && <p className="task-note">{wish.note}</p>}
        <details className="task-details"><summary>操作与记录</summary>{!archived && <div className="actions">
          <button disabled={blocked} onClick={() => setEditor(wish)}>编辑 / 转交</button>
          <button disabled={blocked} onClick={() => act({ type: recipes ? 'recipePin' : 'wishPin', id: wish.id, pinned: !wish.isPinned })}>{wish.isPinned ? '取消置顶' : '置顶'}</button>
          <button disabled={blocked} onClick={() => act({ type: recipes ? 'recipeStatus' : 'wishStatus', id: wish.id, status: done ? 'PENDING' : 'COMPLETED' })}>{done ? '恢复待办' : '完成'}</button>
          <button disabled={blocked} onClick={() => { if (window.confirm(`归档「${wish.name}」？归档后将从清单隐藏。`)) act({ type: recipes ? 'archiveRecipe' : 'archiveWish', id: wish.id }); }}>归档</button></div>}
          <p className="hint">创建：{name(wish.createdBy)} · {stamp(wish.createdAt)}<br />最后修改：{name(wish.updatedBy)} · {stamp(wish.updatedAt)}</p>
          {wish.history.map(entry => <div className="history-row" key={entry.id}><span>{stamp(entry.at)} · {name(entry.actor)} · {entry.status === 'COMPLETED' ? '已完成' : '恢复待办'}</span></div>)}
        </details></div>
    </LongPressArticle>;
  }
  return <><PageHeading title={recipes ? label : wishKinds[kind]} action={<button className="primary" disabled={blocked} onClick={() => setEditor('new')}>新增{label}<span>＋</span></button>} />
    {!recipes && <Link className="text-button back-link" to="/wishes">← 返回愿望</Link>}
    <div className="filter-row"><div className="segmented" aria-label={`${label}归属筛选`}>{[['all', '全部'], ['mine', '我的'], ['other', '对方的']].map(([value, label]) => <button key={value} aria-pressed={filter === value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div><button className="text-button" aria-pressed={archived} onClick={() => setArchived(!archived)}>{archived ? '返回清单' : '查看归档'}</button></div>
    {error && <p className="notice error-text" role="alert">{error}</p>}
    {account.plannerPending.some(value => (recipes ? ['saveRecipe', 'recipePin', 'recipeStatus', 'archiveRecipe', 'deleteRecipe'] : ['saveWish', 'wishPin', 'wishStatus', 'archiveWish', 'deleteWish']).includes(value.command.operation.type)) && <p className="hint">{label}有待同步的修改</p>}
    {archived && <p className="hint">长按条目可删除；电脑端也可右键或按 Delete。</p>}
    {archived ? <section className="task-section"><SectionHeading title="已归档" count={wishes.length} />{wishes.sort((a, b) => b.updatedAt - a.updatedAt).map(card)}{!wishes.length && <p className="empty">还没有归档的{label}。</p>}</section> : <>
      <section className="task-section"><SectionHeading title={recipes ? '想要做' : '想要实现'} count={pending.length} />{pending.map(card)}{!pending.length && <p className="empty">{recipes ? '记下想做的菜，慢慢尝试。' : '把想去、想吃、想买的事记下来，慢慢实现。'}</p>}</section>
      <section className="task-section"><SectionHeading title={recipes ? '已经做过' : '已经实现'} count={completed.length} />{completed.map(card)}{!completed.length && <p className="empty">{recipes ? '做过的菜会留在这里。' : '实现的愿望会留在这里。'}</p>}</section></>}
    {editor && <WishEditor key={editor === 'new' ? 'new' : editor.id} initial={editor === 'new' ? undefined : editor} kind={kind} label={label} account={account} onClose={() => setEditor(null)} onSave={async draft => { await run({ type: recipes ? 'saveRecipe' : 'saveWish', draft }); setEditor(null); }} />}
  </>;
}

function WishEditor({ initial, kind, label, account, onClose, onSave }: { label: string; initial?: Wish; kind: WishKind; account: Account; onClose: () => void; onSave: (draft: WishDraft) => Promise<void> }) {
  const [draft, setDraft] = useState<WishDraft>(() => initial ? { id: initial.id, name: initial.name, kind: initial.kind, ownerId: initial.ownerId, horizon: initial.horizon, budget: initial.budget, address: initial.address, coordinates: initial.coordinates, note: initial.note } :
    { id: crypto.randomUUID(), name: '', kind, ownerId: account.identity.user.id, horizon: 'SOMEDAY', budget: null, address: '', coordinates: null, note: '' });
  const [budget, setBudget] = useState(initial?.budget?.toString() ?? ''), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const [query, setQuery] = useState(''), [results, setResults] = useState<Place[]>([]), [searchMessage, setSearchMessage] = useState(''), [searching, setSearching] = useState(false);
  const searchVersion = useRef(0), submitting = useRef(false);
  useEffect(() => () => { searchVersion.current++; }, []);
  function update<K extends keyof WishDraft>(key: K, value: WishDraft[K]) { setDraft(previous => ({ ...previous, [key]: value })); }
  function invalidateSearch() { searchVersion.current++; setSearching(false); setResults([]); setSearchMessage(''); }
  async function search() {
    const version = ++searchVersion.current;
    setSearching(true); setResults([]); setSearchMessage('');
    try {
      const response = await api<{ places: Place[] }>('/api/v1/places/search', { query: query.trim() }, account.identity.user.id);
      if (version !== searchVersion.current) return;
      setResults(response.places); setSearchMessage(response.places.length ? '选择地点后仍可修改地址。' : '没有找到地点，可以添加城市名称重试或手填地址。');
    } catch (reason) { if (version === searchVersion.current) setSearchMessage(reason instanceof Error ? reason.message : '搜索失败，请手填地址'); }
    finally { if (version === searchVersion.current) setSearching(false); }
  }
  async function submit() {
    if (submitting.current) return;
    if (budget.trim() && !/^\d+(\.\d{1,2})?$/.test(budget.trim())) { setError('预算需为非负金额，最多两位小数'); return; }
    const parsed = wishDraftSchema.safeParse({ ...draft, budget: budget.trim() === '' ? null : Number(budget) });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '请检查愿望内容'); return; }
    submitting.current = true; setSaving(true); setError('');
    try { await onSave(parsed.data); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，请重试'); }
    finally { submitting.current = false; setSaving(false); }
  }
  return <Modal title={`${initial ? '编辑' : '新增'}${label}`} wide onClose={() => { if (!submitting.current) onClose(); }}><form onSubmit={event => { event.preventDefault(); void submit(); }}>
    <fieldset disabled={saving} className="wish-editor-fields"><label>名称<input autoFocus required maxLength={200} value={draft.name} onChange={event => update('name', event.target.value)} /></label>
      <div className="form-grid">{label !== '菜谱' && <label>分类<select value={draft.kind} onChange={event => update('kind', event.target.value as WishKind)}>{kinds.map(value => <option key={value} value={value}>{wishKinds[value]}</option>)}</select></label>}
        <label>归属成员<select value={draft.ownerId} onChange={event => update('ownerId', event.target.value)}>{account.identity.members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label></div>
      <fieldset><legend>什么时候做</legend><div className="choice-grid four">{horizons.map(value => <button type="button" key={value} className={`choice-chip ${draft.horizon === value ? 'selected' : ''}`} aria-pressed={draft.horizon === value} onClick={() => update('horizon', value)}>{wishHorizons[value]}</button>)}</div></fieldset>
      <label>预算（人民币，可选）<input inputMode="decimal" placeholder="预算未定" value={budget} onChange={event => setBudget(event.target.value)} /></label>
      <label>搜索公开地点<input maxLength={200} value={query} placeholder="城市、景点或店铺名称" onChange={event => { invalidateSearch(); setQuery(event.target.value); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (query.trim().length >= 2 && !searching) void search(); } }} /></label>
      <button className="secondary" type="button" disabled={searching || query.trim().length < 2} onClick={() => void search()}>{searching ? '搜索中…' : '搜索地点'}</button>
      <p className="hint">仅搜索公开地点，请勿提交私人住址等敏感信息。搜索不到时可手填地址。地点数据 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> · <a href="https://operations.osmfoundation.org/policies/nominatim/" target="_blank" rel="noreferrer">使用规则</a></p>
      <p className="hint" role="status">{searchMessage}</p>
      {!!results.length && <ul className="wish-place-results">{results.map((place, index) => <li key={index}><button type="button" onClick={() => { invalidateSearch(); setDraft(previous => ({ ...previous, address: place.address, coordinates: { latitude: place.latitude, longitude: place.longitude } })); }}>📍 {place.address}</button></li>)}</ul>}
      <label>具体地址（可选）<input maxLength={1000} value={draft.address} onChange={event => { invalidateSearch(); setDraft(previous => ({ ...previous, address: event.target.value, coordinates: null })); }} /></label>
      {draft.coordinates && <p className="hint">已关联地图位置；修改地址会取消关联。</p>}
      <label>备注（可选）<textarea rows={3} maxLength={10000} value={draft.note} onChange={event => update('note', event.target.value)} /></label>
    </fieldset>{error && <p className="error-text" role="alert">{error}</p>}
    <div className="editor-footer"><button type="button" className="text-button" disabled={saving} onClick={onClose}>取消</button><button className="primary" disabled={saving || !!account.plannerConflict}>{saving ? '保存中…' : '保存'}</button></div>
  </form></Modal>;
}
