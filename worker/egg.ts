import type { Identity } from '../shared/contracts';
import { eggSaveSchema, type EggEntry, type EggMedia, type EggSummary } from '../shared/egg';
import { config, hash, HttpError, json, readJson, requireOrigin, type Env } from './http';

interface Row { seq: number; id: string; author_id: string; author_name: string; created_at: number; text: string; media: string; request_hash: string }
type MediaInfo = Record<'image' | 'audio', Omit<EggMedia, 'data'> | null>;
const summary = (row: Row): EggSummary => ({ id: row.id, authorId: row.author_id, authorName: row.author_name, createdAt: row.created_at, text: row.text, imageName: (JSON.parse(row.media) as MediaInfo).image?.name ?? null });
async function entry(env: Env, row: Row): Promise<EggEntry> {
  const meta = JSON.parse(row.media) as MediaInfo;
  const { results } = await env.DB.prepare('SELECT kind, data FROM egg_media WHERE egg_id = ? ORDER BY part').bind(row.id).all<{ kind: 'image' | 'audio'; data: string }>();
  const read = (kind: 'image' | 'audio'): EggMedia | null => meta[kind] ? { ...meta[kind], data: results.filter(value => value.kind === kind).map(value => value.data).join('') } : null;
  return { ...summary(row), image: read('image'), audio: read('audio') };
}
export async function eggRoute(request: Request, env: Env, actor: Identity): Promise<Response | null> {
  const url = new URL(request.url), base = '/api/v1/eggs';
  if (url.pathname !== base && !url.pathname.startsWith(base + '/')) return null;
  if (request.method === 'GET') {
    if (url.pathname === base + '/latest') {
      const owner = url.searchParams.get('owner') ?? actor.user.id;
      if (!config(env).ids.includes(owner)) throw new HttpError(400, 'INVALID_OWNER', '成员无效');
      const row = await env.DB.prepare('SELECT * FROM eggs WHERE author_id = ? ORDER BY seq DESC LIMIT 1').bind(owner).first<Row>();
      return json({ entry: row ? await entry(env, row) : null });
    }
    if (url.pathname === base) {
      const before = url.searchParams.get('before'), cursor = before === null ? Number.MAX_SAFE_INTEGER : Number(before);
      if (!Number.isSafeInteger(cursor) || cursor < 1) throw new HttpError(400, 'INVALID_CURSOR', '历史页码无效');
      const { results } = await env.DB.prepare('SELECT * FROM eggs WHERE seq < ? ORDER BY seq DESC LIMIT 31').bind(cursor).all<Row>();
      return json({ entries: results.slice(0, 30).map(summary), nextCursor: results.length > 30 ? results[29].seq : null });
    }
    const row = await env.DB.prepare('SELECT * FROM eggs WHERE id = ?').bind(url.pathname.slice(base.length + 1)).first<Row>();
    if (!row) throw new HttpError(404, 'NOT_FOUND', '彩蛋记录不存在');
    return json({ entry: await entry(env, row) });
  }
  if (request.method !== 'POST' || url.pathname !== base) throw new HttpError(405, 'METHOD_NOT_ALLOWED', '不支持此操作');
  requireOrigin(request, env);
  if (request.headers.get('X-LifePlanner-Actor') !== actor.user.id) throw new HttpError(401, 'ACCOUNT_CHANGED', '账号已改变，请刷新页面后继续');
  const parsed = eggSaveSchema.safeParse(await readJson(request, 4300000));
  if (!parsed.success) throw new HttpError(400, 'INVALID_EGG', '请检查文案、图片格式和大小、录音内容');
  const { id, draft } = parsed.data, digest = await hash(JSON.stringify(draft));
  async function previous() {
    const row = await env.DB.prepare('SELECT * FROM eggs WHERE id = ?').bind(id).first<Row>();
    if (row && (row.author_id !== actor.user.id || row.request_hash !== digest)) throw new HttpError(409, 'SAVE_CONFLICT', '保存编号已使用，请重新打开编辑器');
    return row;
  }
  const saved = await previous();
  if (saved) return json({ entry: await entry(env, saved) });
  const meta: MediaInfo = { image: null, audio: null };
  const parts: D1PreparedStatement[] = [];
  for (const kind of ['image', 'audio'] as const) {
    const value = draft[kind];
    if (!value) continue;
    meta[kind] = { name: value.name, mime: value.mime };
    for (let offset = 0; offset < value.data.length; offset += 262144) parts.push(env.DB.prepare('INSERT INTO egg_media(egg_id, kind, part, data) VALUES (?, ?, ?, ?)').bind(id, kind, offset / 262144, value.data.slice(offset, offset + 262144)));
  }
  const createdAt = Date.now();
  try {
    await env.DB.batch([env.DB.prepare('INSERT INTO eggs(id, author_id, author_name, created_at, text, media, request_hash) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, actor.user.id, actor.user.name, createdAt, draft.text, JSON.stringify(meta), digest), ...parts]);
  } catch (error) {
    const retry = await previous();
    if (retry) return json({ entry: await entry(env, retry) });
    throw error;
  }
  return json({ entry: { id, authorId: actor.user.id, authorName: actor.user.name, createdAt, ...draft, imageName: draft.image?.name ?? null } satisfies EggEntry });
}
