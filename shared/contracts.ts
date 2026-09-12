import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  try { return Temporal.PlainDate.from(value).toString() === value; } catch { return false; }
}, '日期无效');
export const statusSchema = z.enum(['PENDING', 'COMPLETED', 'SKIPPED']);
export const draftSchema = z.object({
  title: z.string().trim().min(1, '请输入任务标题').max(200),
  note: z.string().trim().max(10000),
  dueAt: z.number().int().min(0).max(253402214400000).nullable(),
  isPinned: z.boolean(),
  recurrence: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']).nullable(),
  recurrenceStart: dateSchema,
  ownerId: z.string().regex(/^\d+$/),
}).strict();
export const operationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('save'), draft: draftSchema }).strict(),
  z.object({ type: z.literal('pin'), pinned: z.boolean() }).strict(),
  z.object({ type: z.literal('archive') }).strict(),
  z.object({ type: z.literal('status'), date: dateSchema, status: statusSchema }).strict(),
  z.object({ type: z.literal('ensure'), start: dateSchema, end: dateSchema }).strict(),
]);
export const commandSchema = z.object({
  mutationId: z.uuid(), taskId: z.uuid(), expectedVersion: z.number().int().nonnegative(),
  operation: operationSchema,
}).strict();
export type TaskDraft = z.infer<typeof draftSchema>;
export type Operation = z.infer<typeof operationSchema>;
export type Command = z.infer<typeof commandSchema>;
export type Status = z.infer<typeof statusSchema>;
export interface Occurrence {
  id: string; taskId: string; plannedDate: string; dueAt: number | null;
  status: Status; completedAt: number | null;
}
export interface Task extends TaskDraft {
  id: string; version: number; isArchived: boolean;
  createdBy: string; updatedBy: string; createdAt: number; updatedAt: number;
  occurrences: Occurrence[];
}
export const profileSchema = z.object({
  name: z.string().trim().min(1, '请输入名称').max(40),
  avatar: z.string().max(400000).regex(/^(?:data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2})?$/),
  bio: z.string().trim().max(300),
}).strict();
export type UserProfile = z.infer<typeof profileSchema>;
export interface Member { id: string; name: string; login: string; profile?: UserProfile; lastSyncAt?: number | null }
export interface Identity { user: Member; members: Member[]; timeZone: string }
export interface Snapshot { tasks: Task[]; serverTime: number }
export interface ApiError { error: string; message: string; current?: Task | null }
