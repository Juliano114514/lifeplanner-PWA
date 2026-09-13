import { z } from 'zod';

export const wishKinds = { GO: '想要去', EAT: '想要吃', BUY: '想要买' };
export const wishHorizons = { FORTNIGHT: '这半个月内', QUARTER: '一个季度内', HALF_YEAR: '半年内', SOMEDAY: '将来一定' };
export type WishKind = keyof typeof wishKinds;
export type WishHorizon = keyof typeof wishHorizons;
export const placeSchema = z.object({
  address: z.string().trim().min(1).max(1000),
  latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
}).strict();
export type Place = z.infer<typeof placeSchema>;
export const wishDraftSchema = z.object({
  id: z.uuid(), name: z.string().trim().min(1).max(200), kind: z.enum(['GO', 'EAT', 'BUY']),
  ownerId: z.string().min(1), horizon: z.enum(['FORTNIGHT', 'QUARTER', 'HALF_YEAR', 'SOMEDAY']),
  budget: z.number().finite().nonnegative().max(999999999.99).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001, '预算最多两位小数').nullable(),
  address: z.string().trim().max(1000), coordinates: placeSchema.omit({ address: true }).nullable(),
  note: z.string().trim().max(10000),
}).strict().refine(value => !value.coordinates || !!value.address, '地图位置需要地址');
export type WishDraft = z.infer<typeof wishDraftSchema>;
export interface Wish extends WishDraft {
  isPinned: boolean; isArchived: boolean; status: 'PENDING' | 'COMPLETED'; completedAt: number | null;
  createdBy: string; updatedBy: string; createdAt: number; updatedAt: number;
  history: { id: string; status: 'PENDING' | 'COMPLETED'; actor: string; at: number }[];
}
