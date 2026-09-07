import { z } from 'zod';
import { dateSchema, statusSchema, type Status } from './contracts';

export type ScheduleSource = 'MANUAL' | 'QUICK_PLAN';
export interface ScheduleBlock {
  id: string; date: string; startMinute: number; endMinute: number; title: string; note: string;
  taskId: string | null; occurrenceDate: string | null; status: Status; completedAt: number | null;
  source: ScheduleSource; quickPlanSlot: string | null; isArchived: boolean; createdBy: string; updatedBy: string; createdAt: number; updatedAt: number;
}
export type DiaryEntryType = 'HAPPY' | 'UNHAPPY';
export interface DiaryEntry { id: string; type: DiaryEntryType; content: string; createdAt: number; updatedAt: number }
export interface DiaryDay { date: string; entries: DiaryEntry[]; text: string; updatedBy: string; updatedAt: number }
export type StockKind = 'FOOD' | 'HOUSEHOLD';
export type TrackingMode = 'QUANTITY' | 'PERCENT' | 'STATUS';
export type StockLevel = 'MISSING' | 'LOW' | 'ENOUGH' | 'EXCESS';
export type FoodKind = 'PREPARED' | 'INGREDIENT';
export type StorageLocation = 'REFRIGERATED' | 'FROZEN' | 'ROOM_TEMPERATURE' | 'OTHER';
export interface StockItem {
  id: string; name: string; category: string; kind: StockKind; unit: string; trackingMode: TrackingMode;
  currentAmount: number | null; currentStatus: StockLevel | null; replenishThreshold: number | null;
  foodKind: FoodKind | null; storageLocation: StorageLocation | null; expiryDate: string | null;
  expiryWarningDays: number; isArchived: boolean; createdBy: string; updatedBy: string; createdAt: number; updatedAt: number;
}
export interface ShoppingEntry {
  id: string; stockItemId: string | null; name: string; unit: string; desiredAmount: number | null;
  source: 'AUTO' | 'MANUAL'; status: 'ACTIVE' | 'PURCHASED' | 'DISMISSED'; createdBy: string;
  createdAt: number; purchasedAt: number | null;
}
export interface PlannerData {
  version: number; schedules: ScheduleBlock[]; diaryDays: DiaryDay[]; stocks: StockItem[]; shopping: ShoppingEntry[];
}

const nullableNumber = z.number().finite().nonnegative().nullable();
const scheduleDraftSchema = z.object({
  id: z.uuid(), date: dateSchema, startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440), title: z.string().trim().min(1).max(200),
  note: z.string().trim().max(10000), taskId: z.uuid().nullable(), occurrenceDate: dateSchema.nullable(),
  source: z.enum(['MANUAL', 'QUICK_PLAN']), quickPlanSlot: z.string().max(100).nullable(),
}).strict().refine(value => value.endMinute > value.startMinute, '结束时间必须晚于开始时间');
const diaryEntryDraftSchema = z.object({
  id: z.uuid(), type: z.enum(['HAPPY', 'UNHAPPY']), content: z.string().trim().min(1).max(2000),
  createdAt: z.number().int().nonnegative(),
}).strict();
const stockDraftSchema = z.object({
  id: z.uuid(), name: z.string().trim().min(1).max(100), category: z.string().trim().min(1).max(100),
  kind: z.enum(['FOOD', 'HOUSEHOLD']), unit: z.string().trim().max(30),
  trackingMode: z.enum(['QUANTITY', 'PERCENT', 'STATUS']), currentAmount: nullableNumber,
  currentStatus: z.enum(['MISSING', 'LOW', 'ENOUGH', 'EXCESS']).nullable(), replenishThreshold: nullableNumber,
  foodKind: z.enum(['PREPARED', 'INGREDIENT']).nullable(),
  storageLocation: z.enum(['REFRIGERATED', 'FROZEN', 'ROOM_TEMPERATURE', 'OTHER']).nullable(),
  expiryDate: dateSchema.nullable(), expiryWarningDays: z.number().int().min(0).max(365),
}).strict();
export const plannerOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('saveSchedule'), draft: scheduleDraftSchema }).strict(),
  z.object({ type: z.literal('scheduleStatus'), id: z.uuid(), status: statusSchema }).strict(),
  z.object({ type: z.literal('archiveSchedule'), id: z.uuid() }).strict(),
  z.object({ type: z.literal('saveDiaryDay'), date: dateSchema, text: z.string().trim().max(20000), entries: z.array(diaryEntryDraftSchema).max(100) }).strict(),
  z.object({ type: z.literal('saveStock'), draft: stockDraftSchema }).strict(),
  z.object({ type: z.literal('updateStock'), id: z.uuid(), amount: nullableNumber, status: z.enum(['MISSING', 'LOW', 'ENOUGH', 'EXCESS']).nullable() }).strict(),
  z.object({ type: z.literal('archiveStock'), id: z.uuid() }).strict(),
  z.object({ type: z.literal('addShopping'), id: z.uuid(), name: z.string().trim().min(1).max(100), unit: z.string().trim().max(30), desiredAmount: nullableNumber }).strict(),
  z.object({ type: z.literal('dismissShopping'), id: z.uuid() }).strict(),
  z.object({ type: z.literal('purchaseShopping'), id: z.uuid(), amount: nullableNumber }).strict(),
]);
export type PlannerOperation = z.infer<typeof plannerOperationSchema>;
export const plannerCommandSchema = z.object({
  mutationId: z.uuid(), expectedVersion: z.number().int().nonnegative(), operation: plannerOperationSchema,
}).strict();
export type PlannerCommand = z.infer<typeof plannerCommandSchema>;

export const emptyPlanner = (): PlannerData => ({ version: 0, schedules: [], diaryDays: [], stocks: [], shopping: [] });
export const needsRestock = (item: StockItem) => item.trackingMode === 'STATUS'
  ? item.currentStatus === 'MISSING' || item.currentStatus === 'LOW'
  : item.currentAmount !== null && item.replenishThreshold !== null && item.currentAmount <= item.replenishThreshold;
function validateStock(value: z.infer<typeof stockDraftSchema>): void {
  if (value.trackingMode === 'QUANTITY' && value.currentAmount === null) throw new Error('请输入当前数量');
  if (value.trackingMode === 'PERCENT' && (value.currentAmount === null || value.currentAmount > 100)) throw new Error('百分比必须为 0 到 100');
  if (value.trackingMode === 'STATUS' && value.currentStatus === null) throw new Error('请选择库存状态');
}

function reconcileShopping(data: PlannerData, actor: string, now: number): void {
  for (const stock of data.stocks) {
    const active = data.shopping.find(entry => entry.stockItemId === stock.id && entry.source === 'AUTO' && entry.status === 'ACTIVE');
    if (!stock.isArchived && needsRestock(stock) && !active) {
      data.shopping.push({ id: crypto.randomUUID(), stockItemId: stock.id, name: stock.name, unit: stock.unit,
        desiredAmount: null, source: 'AUTO', status: 'ACTIVE', createdBy: actor, createdAt: now, purchasedAt: null });
    } else if ((stock.isArchived || !needsRestock(stock)) && active) active.status = 'DISMISSED';
  }
}

export function applyPlannerCommand(current: PlannerData | null, command: PlannerCommand, actor: string, now: number): PlannerData {
  const data = current ? structuredClone(current) : emptyPlanner();
  const op = command.operation;
  switch (op.type) {
    case 'saveSchedule': {
      const previous = data.schedules.find(value => value.id === op.draft.id);
      const next: ScheduleBlock = { ...op.draft, status: previous?.status ?? 'PENDING', completedAt: previous?.completedAt ?? null,
        isArchived: false, createdBy: previous?.createdBy ?? actor, createdAt: previous?.createdAt ?? now, updatedBy: actor, updatedAt: now };
      data.schedules = data.schedules.filter(value => value.id !== next.id).concat(next);
      break;
    }
    case 'scheduleStatus': {
      const block = data.schedules.find(value => value.id === op.id && !value.isArchived);
      if (!block) throw new Error('日程不存在');
      block.status = op.status; block.completedAt = op.status === 'COMPLETED' ? now : null; block.updatedBy = actor; block.updatedAt = now;
      break;
    }
    case 'archiveSchedule': {
      const block = data.schedules.find(value => value.id === op.id);
      if (!block) throw new Error('日程不存在');
      block.isArchived = true; block.updatedBy = actor; block.updatedAt = now;
      break;
    }
    case 'saveDiaryDay': {
      const previous = data.diaryDays.find(value => value.date === op.date);
      const previousEntries = new Map(previous?.entries.map(value => [value.id, value]) ?? []);
      const day: DiaryDay = { date: op.date, text: op.text, updatedBy: actor, updatedAt: now,
        entries: op.entries.map(entry => ({ ...entry, createdAt: previousEntries.get(entry.id)?.createdAt ?? entry.createdAt, updatedAt: now })) };
      data.diaryDays = data.diaryDays.filter(value => value.date !== day.date).concat(day);
      break;
    }
    case 'saveStock': {
      validateStock(op.draft);
      const previous = data.stocks.find(value => value.id === op.draft.id);
      const next: StockItem = { ...op.draft, isArchived: false, createdBy: previous?.createdBy ?? actor,
        createdAt: previous?.createdAt ?? now, updatedBy: actor, updatedAt: now };
      data.stocks = data.stocks.filter(value => value.id !== next.id).concat(next);
      reconcileShopping(data, actor, now);
      break;
    }
    case 'updateStock': {
      const item = data.stocks.find(value => value.id === op.id && !value.isArchived);
      if (!item) throw new Error('库存项目不存在');
      if (item.trackingMode === 'QUANTITY' && op.amount === null) throw new Error('请输入当前数量');
      if (item.trackingMode === 'PERCENT' && (op.amount === null || op.amount > 100)) throw new Error('百分比必须为 0 到 100');
      if (item.trackingMode === 'STATUS' && op.status === null) throw new Error('请选择库存状态');
      item.currentAmount = op.amount; item.currentStatus = op.status; item.updatedBy = actor; item.updatedAt = now;
      reconcileShopping(data, actor, now);
      break;
    }
    case 'archiveStock': {
      const item = data.stocks.find(value => value.id === op.id);
      if (!item) throw new Error('库存项目不存在');
      item.isArchived = true; item.updatedBy = actor; item.updatedAt = now;
      reconcileShopping(data, actor, now);
      break;
    }
    case 'addShopping':
      data.shopping.push({ id: op.id, stockItemId: null, name: op.name, unit: op.unit, desiredAmount: op.desiredAmount,
        source: 'MANUAL', status: 'ACTIVE', createdBy: actor, createdAt: now, purchasedAt: null });
      break;
    case 'dismissShopping': {
      const entry = data.shopping.find(value => value.id === op.id && value.status === 'ACTIVE');
      if (!entry) throw new Error('采购项不存在');
      entry.status = 'DISMISSED';
      break;
    }
    case 'purchaseShopping': {
      const entry = data.shopping.find(value => value.id === op.id && value.status === 'ACTIVE');
      if (!entry) throw new Error('采购项不存在');
      entry.status = 'PURCHASED'; entry.purchasedAt = now;
      if (entry.stockItemId && op.amount !== null) {
        const stock = data.stocks.find(value => value.id === entry.stockItemId && !value.isArchived);
        if (stock) {
          if (stock.trackingMode === 'QUANTITY') stock.currentAmount = Math.max(0, op.amount);
          else if (stock.trackingMode === 'PERCENT') stock.currentAmount = Math.min(100, Math.max(0, op.amount));
          else stock.currentStatus = 'ENOUGH';
          stock.updatedBy = actor; stock.updatedAt = now;
        }
      }
      break;
    }
  }
  data.version = (current?.version ?? 0) + 1;
  return data;
}
