import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { today } from '../../../shared/domain';
import { needsRestock, type FoodKind, type ShoppingEntry, type StockItem, type StockKind, type StockLevel, type StorageLocation, type TrackingMode } from '../../../shared/planner';
import { enqueuePlanner, materializePlanner, type Account } from '../../data/store';
import { Badge, Modal, PageHeading, SectionHeading } from '../planner/PlannerUi';

const levelNames: Record<StockLevel, string> = { MISSING: '缺货', LOW: '偏少', ENOUGH: '充足', EXCESS: '过多' };
const storageNames: Record<StorageLocation, string> = { REFRIGERATED: '冷藏', FROZEN: '冷冻', ROOM_TEMPERATURE: '常温', OTHER: '其他' };
const modeNames: Record<TrackingMode, string> = { QUANTITY: '数量', PERCENT: '百分比', STATUS: '状态' };
function stockValue(item: StockItem) {
  if (item.trackingMode === 'STATUS') return item.currentStatus ? levelNames[item.currentStatus] : '未记录';
  if (item.currentAmount === null) return '未记录';
  return item.trackingMode === 'PERCENT' ? `${item.currentAmount}%` : `${item.currentAmount}${item.unit}`;
}

export const DishesPage = (props: StockPageProps) => <StockPage {...props} kind="FOOD" />;
export const InventoryPage = (props: StockPageProps) => <StockPage {...props} kind="HOUSEHOLD" />;
interface StockPageProps { account: Account; sync: () => void; onEditing: (value: boolean) => void }
function StockPage({ account, sync, onEditing, kind }: StockPageProps & { kind: StockKind }) {
  const planner = materializePlanner(account), items = planner.stocks.filter(value => value.kind === kind && !value.isArchived).sort((a, b) => b.updatedAt - a.updatedAt);
  const [editor, setEditor] = useState<StockItem | 'new' | null>(null), [updating, setUpdating] = useState<StockItem | null>(null), [error, setError] = useState('');
  const title = kind === 'FOOD' ? '菜品记录' : '库存记录';
  useEffect(() => { onEditing(editor !== null || updating !== null); return () => onEditing(false); }, [editor, updating, onEditing]);
  const setModal = (value: StockItem | 'new' | null) => setEditor(value);
  async function run(operation: Parameters<typeof enqueuePlanner>[1]) {
    try { await enqueuePlanner(account.identity.user.id, operation); setError(''); sync(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败'); }
  }
  return <>
    <PageHeading title={title} action={<div className="heading-actions"><Link className="secondary" to="/shopping">🛒 采购清单</Link><button className="primary" onClick={() => setModal('new')}>{kind === 'FOOD' ? '新增菜品' : '新增物品'}<span>＋</span></button></div>} />
    {error && <p className="notice error-text" role="alert">{error}</p>}
    {!items.length ? <section className="feature-empty"><span>{kind === 'FOOD' ? '◒' : '▣'}</span><h2>{kind === 'FOOD' ? '冰箱里还没有记录' : '还没有库存记录'}</h2><p>点右上角新增第一项。</p></section> : <section className="card-list">{items.map(item => {
      const expired = item.expiryDate !== null && item.expiryDate < today(account.identity.timeZone);
      const warningDate = new Date(); warningDate.setDate(warningDate.getDate() + item.expiryWarningDays);
      const expiring = item.expiryDate !== null && item.expiryDate <= warningDate.toISOString().slice(0, 10);
      return <article className="content-card" key={item.id}><div className="card-title-row"><button className="card-main" onClick={() => setUpdating(item)}><strong>{item.name}</strong><span>{item.category} · {stockValue(item)}</span></button><button className="icon-button" aria-label={`归档 ${item.name}`} onClick={() => void run({ type: 'archiveStock', id: item.id })}>⌑</button></div>
        <div className="badge-row">{item.foodKind && <Badge>{item.foodKind === 'PREPARED' ? '熟食' : '食材'} · {item.storageLocation ? storageNames[item.storageLocation] : '未设置位置'}</Badge>}{expired && <Badge tone="error">已过期 · {item.expiryDate}</Badge>}{!expired && expiring && <Badge tone="error">临期 · {item.expiryDate}</Badge>}{needsRestock(item) && <Badge tone="warning">需要补货</Badge>}</div>
        <button className="text-button" onClick={() => setModal(item)}>编辑详情</button>
      </article>;
    })}</section>}
    {editor && <StockEditor kind={kind} initial={editor === 'new' ? undefined : editor} onClose={() => setModal(null)} onSave={async draft => { await run({ type: 'saveStock', draft }); setModal(null); }} />}
    {updating && <StockUpdate item={updating} onClose={() => setUpdating(null)} onSave={async (amount, status) => { await run({ type: 'updateStock', id: updating.id, amount, status }); setUpdating(null); }} />}
  </>;
}

function StockEditor({ kind, initial, onClose, onSave }: { kind: StockKind; initial?: StockItem; onClose: () => void; onSave: (draft: {
  id: string; name: string; category: string; kind: StockKind; unit: string; trackingMode: TrackingMode; currentAmount: number | null;
  currentStatus: StockLevel | null; replenishThreshold: number | null; foodKind: FoodKind | null; storageLocation: StorageLocation | null;
  expiryDate: string | null; expiryWarningDays: number;
}) => Promise<void> }) {
  const [name, setName] = useState(initial?.name ?? ''), [category, setCategory] = useState(initial?.category ?? '日常');
  const [unit, setUnit] = useState(initial?.unit ?? ''), [mode, setMode] = useState<TrackingMode>(initial?.trackingMode ?? 'QUANTITY');
  const [amount, setAmount] = useState(initial?.currentAmount?.toString() ?? ''), [threshold, setThreshold] = useState(initial?.replenishThreshold?.toString() ?? '');
  const [status, setStatus] = useState<StockLevel>(initial?.currentStatus ?? 'ENOUGH'), [foodKind, setFoodKind] = useState<FoodKind>(initial?.foodKind ?? 'INGREDIENT');
  const [storage, setStorage] = useState<StorageLocation>(initial?.storageLocation ?? 'REFRIGERATED'), [expiry, setExpiry] = useState(initial?.expiryDate ?? '');
  const [warning, setWarning] = useState(String(initial?.expiryWarningDays ?? 3)), [saving, setSaving] = useState(false), [error, setError] = useState('');
  async function submit() {
    const numeric = amount === '' ? null : Number(amount), limit = threshold === '' ? null : Number(threshold);
    if (!name.trim() || !category.trim()) { setError('请填写名称和分类'); return; }
    if (mode !== 'STATUS' && (numeric === null || !Number.isFinite(numeric) || numeric < 0)) { setError('请填写有效余量'); return; }
    if (mode === 'PERCENT' && numeric !== null && numeric > 100) { setError('百分比应在 0–100 之间'); return; }
    setSaving(true);
    try { await onSave({ id: initial?.id ?? crypto.randomUUID(), name: name.trim(), category: category.trim(), kind, unit: unit.trim(), trackingMode: mode,
      currentAmount: mode === 'STATUS' ? null : numeric, currentStatus: mode === 'STATUS' ? status : null, replenishThreshold: mode === 'STATUS' ? null : limit,
      foodKind: kind === 'FOOD' ? foodKind : null, storageLocation: kind === 'FOOD' ? storage : null, expiryDate: kind === 'FOOD' && expiry ? expiry : null,
      expiryWarningDays: warning === '' ? 3 : Number(warning) }); }
    finally { setSaving(false); }
  }
  return <Modal title={initial ? '编辑物品' : '新增物品'} onClose={onClose} wide><form onSubmit={event => { event.preventDefault(); void submit(); }}>
    <div className="form-grid"><label>名称<input autoFocus value={name} onChange={event => setName(event.target.value)} /></label><label>分类<input value={category} onChange={event => setCategory(event.target.value)} /></label></div>
    <label>单位<input value={unit} placeholder="个、瓶、克……" onChange={event => setUnit(event.target.value)} /></label>
    <fieldset><legend>记录方式</legend><div className="choice-grid three">{(Object.keys(modeNames) as TrackingMode[]).map(value => <button type="button" key={value} className={`choice-chip ${mode === value ? 'selected' : ''}`} onClick={() => setMode(value)}>{modeNames[value]}</button>)}</div></fieldset>
    {mode === 'STATUS' ? <fieldset><legend>当前状态</legend><div className="choice-grid four">{(Object.keys(levelNames) as StockLevel[]).map(value => <button type="button" key={value} className={`choice-chip ${status === value ? 'selected' : ''}`} onClick={() => setStatus(value)}>{levelNames[value]}</button>)}</div></fieldset> : <div className="form-grid"><label>当前余量<input type="number" min="0" max={mode === 'PERCENT' ? 100 : undefined} step="any" value={amount} onChange={event => setAmount(event.target.value)} /></label><label>补货阈值<input type="number" min="0" step="any" value={threshold} onChange={event => setThreshold(event.target.value)} /></label></div>}
    {kind === 'FOOD' && <><fieldset><legend>食物类型</legend><div className="choice-grid"><button type="button" className={`choice-chip ${foodKind === 'PREPARED' ? 'selected' : ''}`} onClick={() => setFoodKind('PREPARED')}>熟食</button><button type="button" className={`choice-chip ${foodKind === 'INGREDIENT' ? 'selected' : ''}`} onClick={() => setFoodKind('INGREDIENT')}>食材</button></div></fieldset>
      <fieldset><legend>存放位置</legend><div className="choice-grid four">{(Object.keys(storageNames) as StorageLocation[]).map(value => <button type="button" key={value} className={`choice-chip ${storage === value ? 'selected' : ''}`} onClick={() => setStorage(value)}>{storageNames[value]}</button>)}</div></fieldset>
      <div className="form-grid"><label>保质期<input type="date" value={expiry} onChange={event => setExpiry(event.target.value)} /></label><label>提前提醒天数<input type="number" min="0" max="365" value={warning} onChange={event => setWarning(event.target.value)} /></label></div></>}
    {error && <p className="error-text">{error}</p>}<div className="editor-footer"><button type="button" className="text-button" onClick={onClose}>取消</button><button className="primary" disabled={saving}>{saving ? '保存中…' : '保存'}</button></div>
  </form></Modal>;
}

function StockUpdate({ item, onClose, onSave }: { item: StockItem; onClose: () => void; onSave: (amount: number | null, status: StockLevel | null) => Promise<void> }) {
  const [amount, setAmount] = useState(item.currentAmount?.toString() ?? ''), [status, setStatus] = useState(item.currentStatus ?? 'ENOUGH'), [saving, setSaving] = useState(false);
  return <Modal title={`更新 ${item.name}`} onClose={onClose}>{item.trackingMode === 'STATUS' ? <div className="choice-grid">{(Object.keys(levelNames) as StockLevel[]).map(value => <button key={value} className={`choice-chip ${status === value ? 'selected' : ''}`} onClick={() => setStatus(value)}>{levelNames[value]}</button>)}</div> : <label>{item.trackingMode === 'PERCENT' ? '剩余百分比' : `剩余数量 ${item.unit}`}<input type="number" min="0" max={item.trackingMode === 'PERCENT' ? 100 : undefined} value={amount} onChange={event => setAmount(event.target.value)} /></label>}
    <div className="editor-footer"><button className="text-button" onClick={onClose}>取消</button><button className="primary" disabled={saving || (item.trackingMode !== 'STATUS' && (!amount.trim() || !Number.isFinite(Number(amount))))} onClick={() => { setSaving(true); void onSave(item.trackingMode === 'STATUS' ? null : Number(amount), item.trackingMode === 'STATUS' ? status : null).finally(() => setSaving(false)); }}>{saving ? '保存中…' : '保存'}</button></div>
  </Modal>;
}

export function ShoppingPage({ account, sync, onEditing }: StockPageProps) {
  const entries = materializePlanner(account).shopping.filter(value => value.status === 'ACTIVE').sort((a, b) => a.createdAt - b.createdAt);
  const [adding, setAdding] = useState(false), [purchasing, setPurchasing] = useState<ShoppingEntry | null>(null), [error, setError] = useState('');
  useEffect(() => { onEditing(adding || purchasing !== null); return () => onEditing(false); }, [adding, purchasing, onEditing]);
  async function run(operation: Parameters<typeof enqueuePlanner>[1]) { try { await enqueuePlanner(account.identity.user.id, operation); setError(''); sync(); } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败'); } }
  return <><PageHeading title="统一采购清单" action={<button className="primary" onClick={() => setAdding(true)}>手动添加<span>＋</span></button>} /><Link className="text-button back-link" to="/inventory">← 返回库存</Link>
    {error && <p className="notice error-text">{error}</p>}
    {!entries.length ? <section className="feature-empty"><span>🛒</span><h2>采购清单是空的</h2><p>低库存项目会自动加入，也可以手动添加。</p></section> : <section className="card-list"><SectionHeading title="待采购" count={entries.length} />{entries.map(entry => <article className="content-card shopping-card" key={entry.id}><button className="card-main" onClick={() => setPurchasing(entry)}><strong>{entry.name}</strong><span>{entry.source === 'AUTO' ? '库存自动加入' : '手动添加'}{entry.desiredAmount !== null ? ` · 期望 ${entry.desiredAmount}${entry.unit}` : ''}</span></button><button className="icon-button" aria-label="移除" onClick={() => void run({ type: 'dismissShopping', id: entry.id })}>×</button></article>)}</section>}
    {adding && <ShoppingAdd onClose={() => setAdding(false)} onSave={async (name, unit, desiredAmount) => { await run({ type: 'addShopping', id: crypto.randomUUID(), name, unit, desiredAmount }); setAdding(false); }} />}
    {purchasing && <Purchase entry={purchasing} onClose={() => setPurchasing(null)} onSave={async amount => { await run({ type: 'purchaseShopping', id: purchasing.id, amount }); setPurchasing(null); }} />}
  </>;
}
function ShoppingAdd({ onClose, onSave }: { onClose: () => void; onSave: (name: string, unit: string, amount: number | null) => Promise<void> }) {
  const [name, setName] = useState(''), [unit, setUnit] = useState(''), [amount, setAmount] = useState('');
  return <Modal title="手动添加采购项" onClose={onClose}><label>名称<input autoFocus value={name} onChange={event => setName(event.target.value)} /></label><label>单位<input value={unit} onChange={event => setUnit(event.target.value)} /></label><label>期望数量（可选）<input type="number" min="0" value={amount} onChange={event => setAmount(event.target.value)} /></label><div className="editor-footer"><button className="text-button" onClick={onClose}>取消</button><button className="primary" disabled={!name.trim()} onClick={() => void onSave(name.trim(), unit.trim(), amount ? Number(amount) : null)}>添加</button></div></Modal>;
}
function Purchase({ entry, onClose, onSave }: { entry: ShoppingEntry; onClose: () => void; onSave: (amount: number | null) => Promise<void> }) {
  const [amount, setAmount] = useState('');
  return <Modal title={`已购买 ${entry.name}`} onClose={onClose}><p>填写购入量可同时回写库存；留空则只完成采购项。</p><label>购入量（可选）<input type="number" min="0" value={amount} onChange={event => setAmount(event.target.value)} /></label><div className="editor-footer"><button className="text-button" onClick={onClose}>取消</button><button className="primary" onClick={() => void onSave(amount ? Number(amount) : null)}>完成</button></div></Modal>;
}
