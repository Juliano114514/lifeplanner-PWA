import { z } from 'zod';
import type { Identity } from '../shared/contracts';
import { placeSchema, type Place } from '../shared/wish';
import { hash, HttpError, json, readJson, requireOrigin, type Env } from './http';

const searchSchema = z.object({ query: z.string().trim().min(2).max(200) }).strict();
const upstreamSchema = z.array(z.object({ display_name: z.string(), lat: z.string(), lon: z.string() })).max(5);
export async function placesRoute(request: Request, env: Env, actor: Identity): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/v1/places/search' || request.method !== 'POST') return null;
  requireOrigin(request, env);
  if (request.headers.get('X-LifePlanner-Actor') !== actor.user.id) throw new HttpError(401, 'ACCOUNT_CHANGED', '账号已改变，请刷新页面');
  if (env.PLACE_SEARCH_ENABLED !== 'true') throw new HttpError(503, 'SEARCH_DISABLED', '地点搜索未启用，请手填地址');
  const parsed = searchSchema.safeParse(await readJson(request, 2048));
  if (!parsed.success) throw new HttpError(400, 'INVALID_QUERY', '请输入 2–200 字的公开地点');
  const endpoint = new URL(env.PLACE_SEARCH_URL ?? 'https://nominatim.openstreetmap.org/search');
  if (endpoint.protocol !== 'https:') throw new HttpError(503, 'SEARCH_CONFIG', '地点搜索配置无效，请手填地址');
  const query = parsed.data.query.replace(/\s+/g, ' ');
  const key = await hash(`${endpoint.href}:zh-CN:${query}`), now = Date.now();
  const cached = await env.DB.prepare('SELECT results FROM place_search_cache WHERE query_key = ? AND expires_at > ?').bind(key, now).first<{ results: string }>();
  if (cached) return json({ places: z.array(placeSchema).parse(JSON.parse(cached.results)) });
  const lease = crypto.randomUUID();
  const acquired = await env.DB.prepare('UPDATE place_search_gate SET available_at = ?, lease = ? WHERE id = 1 AND available_at <= ? RETURNING id')
    .bind(now + 30000, lease, now).first();
  if (!acquired) throw new HttpError(429, 'SEARCH_BUSY', '搜索繁忙，请稍后手动重试，也可以手填地址');
  let places: Place[];
  try {
    endpoint.searchParams.set('q', query); endpoint.searchParams.set('format', 'jsonv2');
    endpoint.searchParams.set('limit', '5'); endpoint.searchParams.set('accept-language', 'zh-CN');
    const response = await fetch(endpoint, { headers: { 'User-Agent': `LifePlanner/1.0 (${env.APP_ORIGIN})`, Accept: 'application/json' }, signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (!response.ok) throw new Error('Search unavailable');
    const results = upstreamSchema.parse(await response.json());
    places = results.map(value => placeSchema.parse({ address: value.display_name, latitude: Number(value.lat), longitude: Number(value.lon) }));
    await env.DB.batch([
      env.DB.prepare('DELETE FROM place_search_cache WHERE expires_at <= ?').bind(Date.now()),
      env.DB.prepare('INSERT OR REPLACE INTO place_search_cache(query_key, results, created_at, expires_at) VALUES(?, ?, ?, ?)')
        .bind(key, JSON.stringify(places), Date.now(), Date.now() + 86400000),
    ]);
  } catch { throw new HttpError(503, 'SEARCH_UNAVAILABLE', '地点搜索暂不可用，请手填地址或稍后手动重试'); }
  finally {
    await env.DB.prepare('UPDATE place_search_gate SET available_at = ?, lease = ? WHERE id = 1 AND lease = ?').bind(Date.now() + 1000, '', lease).run();
  }
  return json({ places });
}
