import { useEffect, useRef, useState, type ReactNode } from 'react';
import { addDays, addMonths, today } from '../../../shared/domain';

export const formatMinute = (minute: number) => `${Math.floor(minute / 60).toString().padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`;
export const dateLabel = (date: string) => new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${date}T12:00:00`));
export function PageHeading({ title, action }: { title: string; action?: ReactNode }) {
  return <header className="page-heading"><div><p className="eyebrow">LIFEPLANNER</p><h1>{title}</h1></div>{action}</header>;
}
export function DateNavigator({ date, zone, recorded, onChange }: { date: string; zone: string; recorded?: Set<string>; onChange: (date: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [month, setMonth] = useState(date.slice(0, 7) + '-01');
  const start = addDays(month, -(new Date(`${month}T12:00:00`).getDay() + 6) % 7);
  const values = [-2, -1, 0, 1, 2].map(offset => addDays(date, offset));
  const current = today(zone);
  return <div className="date-navigator"><div className="date-strip">{values.map(value => {
    const parsed = new Date(`${value}T12:00:00`);
    return <button key={value} className={`${value === date ? 'selected' : ''} ${value === current ? 'today' : ''}`} onClick={() => { onChange(value); setMonth(value.slice(0, 7) + '-01'); }} aria-current={value === date ? 'date' : undefined}>
      <small>{parsed.toLocaleDateString('zh-CN', { month: 'short' })}</small><strong>{parsed.getDate()}</strong><span>{parsed.toLocaleDateString('zh-CN', { weekday: 'short' })}</span><i className={recorded?.has(value) ? 'recorded' : ''} />
    </button>;
  })}</div><div className="date-nav-actions"><button className="text-button" onClick={() => { onChange(current); setMonth(current.slice(0, 7) + '-01'); }}>回今天</button><button className="text-button" aria-expanded={expanded} onClick={() => { setMonth(date.slice(0, 7) + '-01'); setExpanded(!expanded); }}>{expanded ? '收起日历' : '展开完整日历'}</button><label>选择日期<input aria-label="选择日期" type="date" value={date} onChange={event => { if (event.target.value) { onChange(event.target.value); setMonth(event.target.value.slice(0, 7) + '-01'); } }} /></label></div>
    {expanded && <section className="month-calendar" aria-label="完整日历"><div className="section-heading"><button className="icon-button" aria-label="上个月" onClick={() => setMonth(addMonths(month, -1))}>‹</button><strong>{month.slice(0, 7).replace('-', '年')}月</strong><button className="icon-button" aria-label="下个月" onClick={() => setMonth(addMonths(month, 1))}>›</button></div><div className="month-grid">
      {['一', '二', '三', '四', '五', '六', '日'].map(day => <span key={day}>{day}</span>)}
      {Array.from({ length: 42 }, (_, index) => addDays(start, index)).map(value => <button key={value} className={`${value === date ? 'selected' : ''} ${value.slice(0, 7) !== month.slice(0, 7) ? 'outside-month' : ''}`} aria-label={`${value}${recorded?.has(value) ? '，有记录' : ''}`} aria-pressed={value === date} aria-current={value === current ? 'date' : undefined} onClick={() => { onChange(value); setMonth(value.slice(0, 7) + '-01'); }}>{Number(value.slice(-2))}<i className={recorded?.has(value) ? 'recorded' : ''} /></button>)}
    </div></section>}</div>;
}
export function SectionHeading({ title, count }: { title: string; count?: number }) {
  return <div className="section-heading"><h2>{title}</h2>{count !== undefined && <span>{count}</span>}</div>;
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'error' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={`editor planner-dialog ${wide ? 'wide' : ''}`} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="section-heading"><h2>{title}</h2><button className="icon-button" aria-label="关闭" onClick={onClose}>×</button></div>{children}
  </dialog>;
}
