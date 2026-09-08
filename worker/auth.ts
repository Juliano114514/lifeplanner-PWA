import type { Identity, Member, UserProfile } from '../shared/contracts';
import { config, cookie, cookieHeader, hash, HttpError, json, randomToken, requireOrigin, type Env } from './http';

const SESSION_SECONDS = 60 * 60 * 24 * 30;
export async function identity(request: Request, env: Env): Promise<Identity> {
  const { ids, zone } = config(env);
  const token = cookie(request, 'lp_session');
  if (!token) throw new HttpError(401, 'UNAUTHENTICATED', '请使用 GitHub 登录');
  const user = await env.DB.prepare(`SELECT m.id, m.login, m.name FROM sessions s
    JOIN members m ON m.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`)
    .bind(await hash(token), Date.now()).first<Member>();
  if (!user || !ids.includes(user.id)) throw new HttpError(401, 'UNAUTHENTICATED', '登录已过期，请重新登录');
  const { results } = await env.DB.prepare('SELECT id, login, name FROM members WHERE id IN (?, ?)').bind(...ids).all<Member>();
  const profiles = await env.DB.prepare('SELECT user_id, data FROM profiles WHERE user_id IN (?, ?)')
    .bind(...ids).all<{ user_id: string; data: string }>();
  const members = ids.map((id, index) => {
    const member = results.find(m => m.id === id) ?? { id, login: '', name: `成员 ${index + 1}（尚未登录）` };
    const row = profiles.results.find(value => value.user_id === id);
    if (!row) return member;
    const profile = JSON.parse(row.data) as UserProfile;
    return { ...member, name: profile.name, profile };
  });
  return { user: members.find(member => member.id === user.id)!, timeZone: zone, members };
}

function redirect(path: string, env: Env, setCookie?: string): Response {
  return new Response(null, { status: 302, headers: {
    Location: path.startsWith('https://github.com/') ? path : `${config(env).origin}${path}`,
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    ...(setCookie ? { 'Set-Cookie': setCookie } : {}),
  } });
}

export async function authRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const { origin, ids } = config(env);
  if (url.pathname === '/api/auth/github/login' && request.method === 'GET') {
    const state = randomToken(), verifier = randomToken(), now = Date.now();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM oauth_states WHERE expires_at < ?').bind(now),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
      env.DB.prepare('INSERT INTO oauth_states VALUES (?, ?, ?)').bind(await hash(state), verifier, now + 600000),
    ]);
    const target = new URL('https://github.com/login/oauth/authorize');
    target.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID,
      redirect_uri: `${origin}/api/auth/github/callback`, state,
      code_challenge: await hash(verifier), code_challenge_method: 'S256', scope: '' }).toString();
    return redirect(target.toString(), env, cookieHeader('lp_oauth', state, 600, env));
  }
  if (url.pathname === '/api/auth/github/callback' && request.method === 'GET') {
    const state = url.searchParams.get('state'), code = url.searchParams.get('code');
    const fail = (reason: string) => redirect(`/tasks?authError=${reason}`, env, cookieHeader('lp_oauth', '', 0, env));
    if (!state || state !== cookie(request, 'lp_oauth') || !code || code.length > 1024) return fail('oauth');
    const row = await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash = ? AND expires_at > ? RETURNING verifier')
      .bind(await hash(state), Date.now()).first<{ verifier: string }>();
    if (!row) return fail('oauth');
    try {
      const response = await fetch('https://github.com/login/oauth/access_token', { method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET,
          code, code_verifier: row.verifier, redirect_uri: `${origin}/api/auth/github/callback` }),
        signal: AbortSignal.timeout(15000),
      });
      const token: { access_token?: string } = await response.json();
      if (!response.ok || !token.access_token) return fail('oauth');
      const profile = await fetch('https://api.github.com/user', { headers: {
        Authorization: `Bearer ${token.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'LifePlanner-PWA',
      }, signal: AbortSignal.timeout(15000) });
      const person: { id?: number; login?: string; name?: string | null } = await profile.json();
      if (!profile.ok || !person.id || !person.login) return fail('oauth');
      const id = String(person.id);
      if (!ids.includes(id)) return fail('forbidden');
      const session = randomToken(), previous = cookie(request, 'lp_session');
      await env.DB.batch([
        env.DB.prepare('INSERT INTO members(id, login, name) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET login=excluded.login, name=excluded.name')
          .bind(id, person.login, person.name || person.login),
        env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hash(previous ?? '')),
        env.DB.prepare('INSERT INTO sessions VALUES(?, ?, ?)').bind(await hash(session), id, Date.now() + SESSION_SECONDS * 1000),
      ]);
      const result = redirect('/tasks', env, cookieHeader('lp_session', session, SESSION_SECONDS, env));
      result.headers.append('Set-Cookie', cookieHeader('lp_oauth', '', 0, env));
      return result;
    } catch { return fail('oauth'); }
  }
  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    requireOrigin(request, env);
    const session = cookie(request, 'lp_session');
    if (session) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hash(session)).run();
    const response = json({ ok: true });
    response.headers.set('Set-Cookie', cookieHeader('lp_session', '', 0, env));
    return response;
  }
  return null;
}
