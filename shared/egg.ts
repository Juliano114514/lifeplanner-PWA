import { z } from 'zod';

export const IMAGE_LIMIT = 2 * 1024 * 1024;
export const AUDIO_LIMIT = 1024 * 1024;
const media = (limit: number, mime: RegExp) => z.object({
  name: z.string().trim().min(1).max(200), mime: z.string().regex(mime),
  data: z.string().max(4 * Math.ceil(limit / 3)).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
    .refine(value => value.length > 0 && value.length * 3 / 4 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0) <= limit),
}).strict();
export const eggDraftSchema = z.object({
  text: z.string().trim().max(10000),
  image: media(IMAGE_LIMIT, /^image\/(png|jpeg|gif|webp)$/).nullable(),
  audio: media(AUDIO_LIMIT, /^audio\/(webm|ogg|mp4|wav)(?:;codecs=[\w.,-]+)?$/).nullable(),
}).strict().refine(value => !!(value.text || value.image || value.audio), '请至少填写一项内容');
export const eggSaveSchema = z.object({ id: z.uuid(), draft: eggDraftSchema }).strict();
export type EggDraft = z.infer<typeof eggDraftSchema>;
export type EggMedia = NonNullable<EggDraft['image']>;
export interface EggSummary { id: string; authorId: string; authorName: string; createdAt: number; text: string; imageName: string | null }
export interface EggEntry extends EggSummary { image: EggMedia | null; audio: EggMedia | null }
export interface EggHistory { entries: EggSummary[]; nextCursor: number | null }
