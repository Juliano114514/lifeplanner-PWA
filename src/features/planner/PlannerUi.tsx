import { useEffect, useRef, type ReactNode } from 'react';
import { addDays, today } from '../../../shared/domain';

export const formatMinute = (minute: number) => `${Math.floor(minute / 60).toString().padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`;
export const dateLabel = (date: string) => new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${date}T12:00:00`));
export function PageHeading({ title, action }: { title: string; action?: ReactNode }) {
  return <header className="page-heading"><div><p className="eyebrow">LIFEPLANNER</p><h1>{title}</h1></div>{action}</header>;
}
export function DateNavigator({ date, zone, recorded, onChange }: { date: string; zone: string; recorded?: Set<string>; onChange: (date: string) => void }) {
  const values = [-2, -1, 0, 1, 2].map(offset => addDays(date, offset));
  const current = today(zone);
  return <div className="date-navigator"><div className="date-strip">{values.map(value => {
    const parsed = new Date(`${value}T12:00:00`);
    return <button key={value} className={`${value === date ? 'selected' : ''} ${value === current ? 'today' : ''}`} onClick={() => onChange(value)} aria-current={value === date ? 'date' : undefined}>
      <small>{parsed.toLocaleDateString('zh-CN', { month: 'short' })}</small><strong>{parsed.getDate()}</strong><span>{parsed.toLocaleDateString('zh-CN', { weekday: 'short' })}</span><i className={recorded?.has(value) ? 'recorded' : ''} />
    </button>;
  })}</div><div className="date-nav-actions"><button className="text-button" onClick={() => onChange(current)}>回今天</button><label>选择日期<input aria-label="选择日期" type="date" value={date} onChange={event => event.target.value && onChange(event.target.value)} /></label></div></div>;
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
