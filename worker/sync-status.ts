import type { Identity } from '../shared/contracts';
import { config, HttpError, json, requireOrigin, type Env } from './http';

export async function syncStatusRoute(request: Request, env: Env, actor: Identity): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/v1/sync/complete' || request.method !== 'POST') return null;
  requireOrigin(request, env);
  if (request.headers.get('X-LifePlanner-Actor') !== actor.user.id) throw new HttpError(401, 'ACCOUNT_CHANGED', '账号已改变，请刷新页面后继续');
  await env.DB.prepare('INSERT INTO member_sync(user_id, last_sync_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_sync_at = MAX(member_sync.last_sync_at, excluded.last_sync_at)').bind(actor.user.id, Date.now()).run();
  const { results } = await env.DB.prepare('SELECT user_id AS id, last_sync_at AS lastSyncAt FROM member_sync WHERE user_id IN (?, ?)').bind(...config(env).ids).all<{ id: string; lastSyncAt: number }>();
  return json({ members: results });
}
