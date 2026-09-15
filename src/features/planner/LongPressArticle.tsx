import { useEffect, useRef, type ReactNode } from 'react';

export function LongPressArticle({ children, className, enabled, title, onDelete }: {
  children: ReactNode; className: string; enabled: boolean; title: string; onDelete: () => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const fired = useRef(false);
  function cancel() { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; }
  useEffect(() => { return () => { if (timer.current !== null) clearTimeout(timer.current); }; }, [enabled]);
  function confirmDelete() {
    cancel();
    if (!enabled || fired.current) return;
    fired.current = true;
    if (window.confirm(`删除已归档的「${title}」？删除后无法恢复，将同步到其他设备。`)) onDelete();
  }
  return <article className={`${className}${enabled ? ' long-press-delete' : ''}`} tabIndex={enabled ? 0 : undefined}
    aria-label={enabled ? `${title}，长按或按 Delete 删除` : undefined}
    onPointerDown={event => {
      cancel(); fired.current = false;
      if (!enabled || !event.isPrimary || event.button !== 0) return;
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(confirmDelete, 600);
    }}
    onPointerMove={event => { if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 10) cancel(); }}
    onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
    onClickCapture={event => { if (fired.current) { event.preventDefault(); event.stopPropagation(); fired.current = false; } }}
    onContextMenu={event => { if (enabled) { event.preventDefault(); confirmDelete(); } }}
    onKeyDown={event => { if (enabled && event.target === event.currentTarget && event.key === 'Delete' && !event.repeat) { event.preventDefault(); fired.current = false; confirmDelete(); } }}>
    {children}
  </article>;
}
