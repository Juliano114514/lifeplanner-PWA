import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Status, Task } from '../../../shared/contracts';
import { addDays, localDateTime, today } from '../../../shared/domain';
import type { ScheduleBlock } from '../../../shared/planner';
import { enqueue, enqueuePlanner, materialize, materializePlanner, type Account } from '../../data/store';
import { Badge, dateLabel, DateNavigator, formatMinute, Modal, PageHeading } from '../planner/PlannerUi';

interface Draft { id: string; title: string; note: string; startMinute: number; endMinute: number; taskId: string | null; occurrenceDate: string | null; source: 'MANUAL' | 'QUICK_PLAN'; quickPlanSlot: string | null }
const emptyDraft = (_date: string, startMinute = 9 * 60): Draft => ({ id: crypto.randomUUID(), title: '', note: '', startMinute, endMinute: Math.min(startMinute + 60, 1440), taskId: null, occurrenceDate: null, source: 'MANUAL', quickPlanSlot: null });
const toDraft = (block: ScheduleBlock): Draft => ({ id: block.id, title: block.title, note: block.note, startMinute: block.startMinute, endMinute: block.endMinute, taskId: block.taskId, occurrenceDate: block.occurrenceDate, source: block.source, quickPlanSlot: block.quickPlanSlot });

export function SchedulePage({ account, sync, onEditing }: { account: Account; sync: () => void; onEditing: (value: boolean) => void }) {
  const zone = account.identity.timeZone;
  const [search, setSearch] = useSearchParams();
  const [date, setDate] = useState(() => search.get('date') ?? today(zone));
  const [editor, setEditor] = useState<Draft | null>(() => {
    const taskId = search.get('task');
    if (!taskId) return null;
    const task = materialize(account).find(value => value.id === taskId);
    return task ? { ...emptyDraft(search.get('date') ?? today(zone)), title: task.title, note: task.note, taskId, occurrenceDate: search.get('date') ?? today(zone) } : null;
  });
  const [wizard, setWizard] = useState(false);
  const [planChoice, setPlanChoice] = useState<string | null>(null);
  const [error, setError] = useState('');
  const planner = materializePlanner(account);
  const tasks = materialize(account);
  const blocks = planner.schedules.filter(value => value.date === date && !value.isArchived).sort((a, b) => a.startMinute - b.startMinute);
  const recorded = new Set(planner.schedules.filter(value => !value.isArchived).map(value => value.date));
  const conflicts = useMemo(() => new Set(blocks.filter((block, index) => blocks.some((other, otherIndex) => index !== otherIndex && block.startMinute < other.endMinute && other.startMinute < block.endMinute)).map(value => value.id)), [blocks]);
  useEffect(() => { onEditing(editor !== null || wizard || planChoice !== null); return () => onEditing(false); }, [editor, wizard, planChoice, onEditing]);
  function startPlan(target: string) {
    setDate(target); setSearch({ date: target }, { replace: true }); setPlanChoice(null); setWizard(true);
  }
  function quickPlan() {
    const now = Date.now(), current = today(zone, now);
    const hour = Number(localDateTime(now, zone).slice(11, 13));
    if (hour >= 18) startPlan(addDays(current, 1));
    else if (hour >= 12) setPlanChoice(current);
    else startPlan(current);
  }
  function beginEdit(value: Draft | null) { setEditor(value); }
  async function run(operation: Parameters<typeof enqueuePlanner>[1]) {
    try { await enqueuePlanner(account.identity.user.id, operation); setError(''); sync(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败'); }
  }
  async function toggle(block: ScheduleBlock) {
    const status: Status = block.status === 'COMPLETED' ? 'PENDING' : 'COMPLETED';
    await run({ type: 'scheduleStatus', id: block.id, status });
    if (block.taskId && block.occurrenceDate) {
      try { await enqueue(account.identity.user.id, block.taskId, { type: 'status', date: block.occurrenceDate, status }); sync(); }
      catch (reason) { setError(reason instanceof Error ? `日程已更新，但任务同步失败：${reason.message}` : '关联任务同步失败'); }
    }
  }
  const linkedTask = (block: ScheduleBlock) => block.taskId ? tasks.find(value => value.id === block.taskId) : undefined;
  return <>
    <PageHeading title="一日安排" action={<button className="primary" onClick={() => beginEdit(emptyDraft(date))}>新增日程<span>＋</span></button>} />
    <DateNavigator date={date} zone={zone} recorded={recorded} onChange={value => { setDate(value); setSearch({ date: value }, { replace: true }); }} />
    <div className="page-actions"><button className="secondary" onClick={quickPlan}>✦ 快速规划</button></div>
    {planChoice && <Modal title="是否是规划明日计划？" onClose={() => setPlanChoice(null)}><div className="plan-date-actions"><button className="primary" onClick={() => startPlan(addDays(planChoice, 1))}>规划明天（{dateLabel(addDays(planChoice, 1))}）</button><button className="secondary" onClick={() => startPlan(planChoice)}>规划今天（{dateLabel(planChoice)}）</button></div></Modal>}
    {error && <p className="notice error-text" role="alert">{error}</p>}
    <section className="timeline" aria-label={`${date} 日程时间轴`}>{Array.from({ length: 24 }, (_, hour) => {
      const hourBlocks = blocks.filter(value => Math.floor(value.startMinute / 60) === hour);
      return <div className="timeline-row" key={hour}><time>{hour.toString().padStart(2, '0')}:00</time><div className="timeline-slot">
        {!hourBlocks.length && <button className="timeline-empty" aria-label={`新增 ${hour}:00 日程`} onClick={() => beginEdit(emptyDraft(date, hour * 60))} />}
        {hourBlocks.map(block => <article className={`schedule-card ${block.status === 'COMPLETED' ? 'is-done' : ''}`} key={block.id} onDoubleClick={() => beginEdit(toDraft(block))}>
          <button className="completion compact" onClick={() => void toggle(block)} aria-label={block.status === 'COMPLETED' ? '恢复日程' : '完成日程'}>{block.status === 'COMPLETED' ? '✓' : ''}</button>
          <button className="schedule-body" onClick={() => beginEdit(toDraft(block))}><strong>{block.title}</strong><span>{formatMinute(block.startMinute)}–{formatMinute(block.endMinute)}{block.note ? ` · ${block.note}` : ''}</span></button>
          <div className="badge-row">{block.taskId && <Badge>任务</Badge>}{block.source === 'QUICK_PLAN' && <Badge>快速安排</Badge>}{conflicts.has(block.id) && <Badge tone="error">时间冲突</Badge>}</div>
          {linkedTask(block)?.isArchived && <Badge tone="warning">关联任务已归档</Badge>}
        </article>)}
      </div></div>;
    })}</section>
    {editor && <ScheduleEditor date={date} draft={editor} linkedTask={editor.taskId ? tasks.find(value => value.id === editor.taskId) : undefined} onClose={() => { beginEdit(null); setSearch({ date }, { replace: true }); }} onSave={async draft => {
      await run({ type: 'saveSchedule', draft: { ...draft, date } }); beginEdit(null); setSearch({ date }, { replace: true });
    }} onDelete={planner.schedules.some(value => value.id === editor.id) ? async () => { await run({ type: 'archiveSchedule', id: editor.id }); beginEdit(null); } : undefined} />}
    {wizard && <QuickPlanWizard date={date} account={account} existing={blocks.filter(value => value.source === 'QUICK_PLAN')} onClose={() => setWizard(false)} onSave={async (drafts, todoTitle) => {
      const existing = planner.schedules.filter(value => value.date === date && value.source === 'QUICK_PLAN' && !value.isArchived);
      const slots = new Set(drafts.map(value => value.quickPlanSlot));
      for (const block of existing.filter(value => !slots.has(value.quickPlanSlot))) await enqueuePlanner(account.identity.user.id, { type: 'archiveSchedule', id: block.id });
      for (const draft of drafts) {
        const previous = existing.find(value => value.quickPlanSlot === draft.quickPlanSlot);
        await enqueuePlanner(account.identity.user.id, { type: 'saveSchedule', draft: { ...draft, id: previous?.id ?? draft.id } });
      }
      if (todoTitle) await enqueue(account.identity.user.id, crypto.randomUUID(), { type: 'save', draft: { title: todoTitle, note: '', dueAt: null, isPinned: false, recurrence: null, recurrenceStart: date, ownerId: account.identity.user.id } }, 0);
      setWizard(false); sync();
    }} />}
  </>;
}

function ScheduleEditor({ date, draft: initial, linkedTask, onClose, onSave, onDelete }: { date: string; draft: Draft; linkedTask?: Task; onClose: () => void; onSave: (draft: Draft) => Promise<void>; onDelete?: () => Promise<void> }) {
  const [draft, setDraft] = useState(initial), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const change = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }));
  return <Modal title={onDelete ? '编辑日程' : '新增日程'} onClose={onClose}><form onSubmit={event => { event.preventDefault(); if (draft.endMinute <= draft.startMinute) { setError('结束时间必须晚于开始时间'); return; } setSaving(true); void onSave(draft).finally(() => setSaving(false)); }}>
    <label>标题<input required maxLength={200} value={draft.title} disabled={!!linkedTask} onChange={event => change('title', event.target.value)} /></label>
    <label>备注<textarea rows={3} maxLength={10000} value={draft.note} disabled={!!linkedTask} onChange={event => change('note', event.target.value)} /></label>
    <div className="form-grid"><label>开始时间<input type="time" required value={formatMinute(draft.startMinute)} onChange={event => change('startMinute', timeToMinute(event.target.value))} /></label>
      <label>结束时间<input type="time" required value={formatMinute(draft.endMinute === 1440 ? 1439 : draft.endMinute)} onChange={event => change('endMinute', timeToMinute(event.target.value))} /></label></div>
    {linkedTask && <p className="hint">任务标题和备注请在任务中修改；保存后会安排到 {date}，完成状态与任务同步。</p>}
    {error && <p className="error-text">{error}</p>}
    <div className="editor-footer">{onDelete ? <button type="button" className="danger-text" onClick={() => void onDelete()}>删除日程</button> : <span />}
      <div className="actions"><button type="button" className="text-button" onClick={onClose}>取消</button><button className="primary" disabled={saving}>{saving ? '保存中…' : '保存'}</button></div></div>
  </form></Modal>;
}
const timeToMinute = (value: string) => { const [hour, minute] = value.split(':').map(Number); return hour * 60 + minute; };

const cards = ['事项安排', '出门安排', '早餐', '午餐', '晚餐', '晚上回家', '健身', '其他'] as const;
const options: Record<string, string[]> = {
  '事项安排': ['学习', '工作', '实验', '写作', '开会', '休息'], '出门安排': ['出去玩', '出去办事', '出去团建'],
  '早餐': ['自己做', '出去吃', '外卖', '不吃'], '午餐': ['自己做', '出去吃', '外卖', '不吃'], '晚餐': ['自己做', '出去吃', '外卖', '不吃'],
  '健身': ['早上', '下午', '晚上', '今日练休'],
};
interface PeriodAnswer { included: boolean; tag: string; text: string; location: string }
interface WizardAnswer { selected: string[]; note: string; hour: number; periods: Record<string, PeriodAnswer> }
function wizardAnswers(existing: ScheduleBlock[]): Record<string, WizardAnswer> {
  const result = Object.fromEntries(cards.map(value => [value, { selected: [], note: '', hour: value === '晚上回家' ? 20 : 9,
    periods: Object.fromEntries(['早上', '下午', '晚上'].map(period => [period, { included: value !== '出门安排', tag: '', text: '', location: '' }])) }])) as Record<string, WizardAnswer>;
  for (const block of existing) {
    const slot = block.quickPlanSlot;
    if (!slot) continue;
    const [card, period] = slot.split(':');
    if ((card === '事项安排' || card === '出门安排') && period && result[card]?.periods[period]) {
      result[card].periods[period] = { included: true, tag: '', text: block.title, location: block.note.split(' · ').at(-1) ?? '' };
    } else if (['早餐', '午餐', '晚餐'].includes(card)) {
      result[card].selected = [block.note.split(' · ')[0] || '自己做']; result[card].note = block.note.split(' · ').slice(1).join(' · ');
    } else if (card === '晚上回家') {
      result[card].selected = ['已设置']; result[card].hour = block.endMinute === 1440 ? 0 : Math.floor(block.endMinute / 60); result[card].note = block.note;
    } else if (card === '健身' && period) {
      result[card].selected.push(period); result[card].note = block.note;
    }
  }
  return result;
}
function QuickPlanWizard({ date, account, existing, onClose, onSave }: { date: string; account: Account; existing: ScheduleBlock[]; onClose: () => void; onSave: (drafts: Array<Draft & { date: string }>, todoTitle: string) => Promise<void> }) {
  const [index, setIndex] = useState(0), [saving, setSaving] = useState(false);
  const [answers, setAnswers] = useState<Record<string, WizardAnswer>>(() => wizardAnswers(existing));
  const card = cards[index], answer = answers[card];
  const update = (value: Partial<WizardAnswer>) => setAnswers(current => ({ ...current, [card]: { ...current[card], ...value } }));
  const updatePeriod = (period: string, value: Partial<PeriodAnswer>) => update({ periods: { ...answer.periods, [period]: { ...answer.periods[period], ...value } } });
  const toggle = (value: string) => update({ selected: answer.selected.includes(value) ? answer.selected.filter(item => item !== value) : (['早餐', '午餐', '晚餐'].includes(card) || value === '今日练休' ? [value] : answer.selected.filter(item => item !== '今日练休').concat(value)) });
  async function finish() {
    const slots: Record<string, [number, number]> = { '早餐': [450, 480], '午餐': [720, 780], '晚餐': [1080, 1140] };
    const drafts: Array<Draft & { date: string }> = [];
    for (const [title, value] of Object.entries(answers)) {
      if (title === '事项安排' || title === '出门安排') {
        const periodSlots: Record<string, [number, number]> = title === '事项安排'
          ? { '早上': [540, 720], '下午': [840, 1050], '晚上': [1140, 1260] }
          : { '早上': [540, 690], '下午': [840, 1020], '晚上': [1140, 1260] };
        for (const [period, entry] of Object.entries(value.periods)) {
          const activity = entry.text.trim() || entry.tag;
          if (!entry.included || !activity) continue;
          const slot = periodSlots[period];
          drafts.push({ ...emptyDraft(date, slot[0]), endMinute: slot[1], title: activity,
            note: [entry.text.trim() && entry.tag, entry.location].filter(Boolean).join(' · '), date, source: 'QUICK_PLAN', quickPlanSlot: `${title}:${period}` });
        }
      } else if (title === '晚上回家' && value.selected.length) {
        const end = value.hour === 0 ? 1440 : value.hour * 60;
        drafts.push({ ...emptyDraft(date, end - 30), endMinute: end, title: '回家', note: value.note.trim(), date, source: 'QUICK_PLAN', quickPlanSlot: title });
      }
      else if (title === '其他') continue;
      else if (title === '健身') {
        const fitness: Record<string, [number, number]> = { '早上': [420, 480], '下午': [1020, 1080], '晚上': [1200, 1260] };
        for (const selected of value.selected) {
          const slot = fitness[selected];
          if (slot) drafts.push({ ...emptyDraft(date, slot[0]), endMinute: slot[1], title: '健身', note: value.note.trim(), date, source: 'QUICK_PLAN', quickPlanSlot: `${title}:${selected}` });
        }
      }
      else if (value.selected.length && !value.selected.includes('不吃') && !value.selected.includes('今日练休')) {
        const slot = slots[title];
        drafts.push({ ...emptyDraft(date, slot[0]), endMinute: slot[1], title, note: [value.selected[0], value.note.trim()].filter(Boolean).join(' · '), date, source: 'QUICK_PLAN', quickPlanSlot: title });
      }
    }
    setSaving(true);
    try { await onSave(drafts, answers['其他'].note.trim()); }
    finally { setSaving(false); }
  }
  return <Modal title={`快速安排 · ${date}`} onClose={onClose} wide><div className="wizard-progress"><span style={{ width: `${((index + 1) / cards.length) * 100}%` }} /></div>
    <p className="eyebrow">第 {index + 1} / {cards.length} 步</p><h2 className="wizard-title">{card}</h2>
    {(card === '事项安排' || card === '出门安排') ? <div className="period-planner">{['早上', '下午', '晚上'].map(period => { const entry = answer.periods[period]; return <article key={period}><label className="period-toggle"><input type="checkbox" checked={entry.included} onChange={event => updatePeriod(period, { included: event.target.checked })} />{period}</label>{entry.included && <>
      <div className="choice-grid three">{options[card].map(value => <button key={value} className={`choice-chip ${entry.tag === value ? 'selected' : ''}`} onClick={() => updatePeriod(period, { tag: entry.tag === value ? '' : value, location: value === '休息' ? '' : entry.location })}>{entry.tag === value ? '✓ ' : ''}{value}</button>)}</div>
      <input value={entry.text} placeholder="具体做什么（可选）" onChange={event => updatePeriod(period, { text: event.target.value })} />
      {card === '事项安排' && entry.tag !== '休息' && <div className="choice-grid four">{['在家', '北区', '研究生部', '出差'].map(value => <button key={value} className={`choice-chip ${entry.location === value ? 'selected' : ''}`} onClick={() => updatePeriod(period, { location: entry.location === value ? '' : value })}>{value}</button>)}</div>}
    </>}</article>; })}</div> : options[card] && <div className="choice-grid">{options[card].map(value => <button key={value} className={`choice-chip ${answer.selected.includes(value) ? 'selected' : ''}`} onClick={() => toggle(value)}>{answer.selected.includes(value) ? '✓ ' : ''}{value}</button>)}</div>}
    {card === '晚上回家' && <label>预计时间 <strong>{answer.hour}:00</strong><input type="range" min="0" max="23" value={answer.hour} onChange={event => update({ hour: Number(event.target.value), selected: ['已设置'] })} /></label>}
    <label>{card === '其他' || card === '晚上回家' ? '具体事项' : '补充说明（可选）'}<input value={answer.note} placeholder={card === '其他' ? '还想安排什么？这会创建当日待办' : '地点、细节或提醒'} onChange={event => update({ note: event.target.value, ...(card === '晚上回家' && event.target.value ? { selected: ['已设置'] } : {}) })} /></label>
    {['早餐', '午餐', '晚餐'].includes(card) && answer.selected.includes('自己做') && <p className="notice">怎么做：有菜了 / 要去买菜 / 要外卖点菜。可在菜品与采购清单继续细化。</p>}
    <div className="editor-footer"><button className="text-button" onClick={() => index ? setIndex(index - 1) : onClose()}>{index ? '上一步' : '取消'}</button><div className="actions">
      {index < cards.length - 1 && <button className="text-button" onClick={() => { update({ selected: [], note: '', periods: Object.fromEntries(['早上', '下午', '晚上'].map(period => [period, { included: false, tag: '', text: '', location: '' }])) }); setIndex(index + 1); }}>跳过</button>}
      <button className="primary" disabled={saving} onClick={() => index === cards.length - 1 ? void finish() : setIndex(index + 1)}>{index === cards.length - 1 ? (saving ? '生成中…' : '生成安排') : '下一步'}<span>→</span></button>
    </div></div><p className="hint">向导生成日程后仍可逐项调整。共享成员：{account.identity.members.map(value => value.name).join('、')}</p>
  </Modal>;
}
