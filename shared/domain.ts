import { Temporal } from '@js-temporal/polyfill';
import type { Command, Occurrence, Operation, Task } from './contracts';

export const today = (zone: string, now = Date.now()) =>
  Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(zone).toPlainDate().toString();
export const addDays = (date: string, days: number) => Temporal.PlainDate.from(date).add({ days }).toString();
export const addMonths = (date: string, months: number) => Temporal.PlainDate.from(date).add({ months }).toString();
export function localDateTime(epoch: number, zone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(epoch).toZonedDateTimeISO(zone)
    .toPlainDateTime().toString({ smallestUnit: 'minute' });
}
export function toEpoch(local: string, zone: string): number {
  return Temporal.PlainDateTime.from(local).toZonedDateTime(zone).epochMilliseconds;
}

// Match Android RecurrenceGenerator: monthly recurrences retain the original day.
export function recurrenceDates(task: Task, start: string, end: string): string[] {
  if (task.isArchived || end < start) return [];
  if (!task.recurrence) return task.recurrenceStart >= start && task.recurrenceStart <= end ? [task.recurrenceStart] : [];
  const anchor = Temporal.PlainDate.from(task.recurrenceStart);
  const lower = Temporal.PlainDate.from(start);
  let step = 0;
  if (start > task.recurrenceStart) {
    step = task.recurrence === 'MONTHLY'
      ? Math.max(0, (lower.year - anchor.year) * 12 + lower.month - anchor.month - 1)
      : Math.max(0, Math.floor(anchor.until(lower).days / (task.recurrence === 'WEEKLY' ? 7 : 1)));
  }
  const dates: string[] = [];
  while (true) {
    const date = (task.recurrence === 'MONTHLY' ? anchor.add({ months: step })
      : anchor.add({ days: step * (task.recurrence === 'WEEKLY' ? 7 : 1) })).toString();
    if (date > end) break;
    if (date >= start) dates.push(date);
    step++;
    if (dates.length > 740) throw new Error('一次最多生成两年的任务实例');
  }
  return dates;
}

function ensure(task: Task, start: string, end: string, zone: string): void {
  if (end < start || Temporal.PlainDate.from(start).until(Temporal.PlainDate.from(end)).days > 740) {
    throw new Error('实例生成范围必须在两年内');
  }
  const existing = new Set(task.occurrences.map(o => o.plannedDate));
  const time = task.dueAt === null ? null : Temporal.Instant.fromEpochMilliseconds(task.dueAt)
    .toZonedDateTimeISO(zone).toPlainTime();
  for (const date of recurrenceDates(task, start, end)) {
    if (existing.has(date)) continue;
    task.occurrences.push({
      id: `${task.id}:${date}`, taskId: task.id, plannedDate: date,
      dueAt: time === null ? null : Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: zone, plainTime: time }).epochMilliseconds,
      status: 'PENDING', completedAt: null,
    });
  }
  task.occurrences.sort((a, b) => a.plannedDate.localeCompare(b.plannedDate));
}

// Both optimistic UI and Worker apply these rules; only the Worker supplies trusted actor/time.
export function applyCommand(current: Task | null, command: Command, actor: string, zone: string, now: number): Task {
  const op = command.operation;
  const task: Task = current ? structuredClone(current) : (() => {
    if (op.type !== 'save') throw new Error('任务不存在');
    return { ...op.draft, id: command.taskId, version: 0, isArchived: false,
      createdBy: actor, updatedBy: actor, createdAt: now, updatedAt: now, occurrences: [] };
  })();
  if (task.isArchived) throw new Error('任务已归档，请保留原记录并新建任务');
  switch (op.type) {
    case 'save':
      Object.assign(task, op.draft);
      if (current) task.occurrences = task.occurrences.filter(o => o.plannedDate < today(zone, now) || o.status !== 'PENDING');
      ensure(task, task.recurrenceStart, addMonths(task.recurrenceStart, 1), zone);
      break;
    case 'pin': task.isPinned = op.pinned; break;
    case 'archive': task.isArchived = true; break;
    case 'status': {
      const occurrence = task.occurrences.find(o => o.plannedDate === op.date);
      if (!occurrence) throw new Error('任务实例已改变，请刷新后重试');
      occurrence.status = op.status;
      occurrence.completedAt = op.status === 'COMPLETED' ? now : null;
      break;
    }
    case 'ensure': ensure(task, op.start, op.end, zone); break;
  }
  task.version = (current?.version ?? 0) + 1;
  if (op.type !== 'ensure') {
    task.updatedBy = actor;
    task.updatedAt = now;
  }
  return task;
}

export function needsEnsure(task: Task, date: string): boolean {
  const existing = new Set(task.occurrences.map(o => o.plannedDate));
  return recurrenceDates(task, addMonths(date, -1), addMonths(date, 1)).some(d => !existing.has(d));
}
export function ensureOperation(date: string): Operation {
  return { type: 'ensure', start: addMonths(date, -1), end: addMonths(date, 1) };
}
export interface TodoItem { task: Task; occurrence?: Occurrence }
export interface Overview { urgent: TodoItem[]; todayPending: TodoItem[]; todayCompleted: TodoItem[]; others: TodoItem[] }
const nullableNumber = (a: number | null | undefined, b: number | null | undefined) =>
  a == null ? (b == null ? 0 : -1) : b == null ? 1 : a - b;

// Same branch priority and null ordering as Android TodoOrganizer.
export function organize(tasks: Task[], date: string, zone: string): Overview {
  const groups: Overview = { urgent: [], todayPending: [], todayCompleted: [], others: [] };
  const urgentEnd = addDays(date, 3);
  for (const task of tasks.filter(t => !t.isArchived).sort((a, b) => b.createdAt - a.createdAt)) {
    const related = task.occurrences;
    const pending = related.filter(o => o.status === 'PENDING');
    const urgent = pending.filter(o => {
      const due = o.dueAt ?? task.dueAt;
      return task.isPinned || (due !== null && today(zone, due) <= urgentEnd);
    }).sort((a, b) => nullableNumber(a.dueAt, b.dueAt) || a.plannedDate.localeCompare(b.plannedDate))[0];
    const pendingToday = pending.find(o => o.plannedDate === date);
    const completedToday = related.find(o => o.plannedDate === date && o.status === 'COMPLETED');
    if (urgent) groups.urgent.push({ task, occurrence: urgent });
    else if (pendingToday) groups.todayPending.push({ task, occurrence: pendingToday });
    else if (completedToday) groups.todayCompleted.push({ task, occurrence: completedToday });
    else groups.others.push({ task, occurrence: pending.find(o => o.plannedDate >= date) ?? pending[0] });
  }
  groups.urgent.sort((a, b) => nullableNumber(a.occurrence?.dueAt ?? a.task.dueAt, b.occurrence?.dueAt ?? b.task.dueAt)
    || (a.task.title < b.task.title ? -1 : a.task.title > b.task.title ? 1 : 0));
  groups.todayPending.sort((a, b) => nullableNumber(a.occurrence?.dueAt, b.occurrence?.dueAt));
  groups.todayCompleted.sort((a, b) => nullableNumber(b.occurrence?.completedAt, a.occurrence?.completedAt));
  groups.others.sort((a, b) => {
    const left = a.occurrence?.plannedDate ?? '', right = b.occurrence?.plannedDate ?? '';
    return left.localeCompare(right) || (a.task.title < b.task.title ? -1 : a.task.title > b.task.title ? 1 : 0);
  });
  return groups;
}
