import { profileSchema, type Identity } from '../shared/contracts';
import { HttpError, json, readJson, requireOrigin, type Env } from './http';

export async function profileRoute(request: Request, env: Env, actor: Identity): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/v1/profile' || request.method !== 'POST') return null;
  requireOrigin(request, env);
  if (request.headers.get('X-LifePlanner-Actor') !== actor.user.id) {
    throw new HttpError(401, 'ACCOUNT_CHANGED', '账号已改变，请刷新页面后继续');
  }
  const parsed = profileSchema.safeParse(await readJson(request, 410000));
  if (!parsed.success) throw new HttpError(400, 'INVALID_PROFILE', '个人资料无效，请检查名称、简介和头像大小');
  // Each member can only replace their own profile. The last received save wins.
  await env.DB.prepare('INSERT INTO profiles(user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data')
    .bind(actor.user.id, JSON.stringify(parsed.data)).run();
  return json({ profile: parsed.data });
}
