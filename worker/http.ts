export interface Env {
  DB: D1Database;
  APP_ORIGIN: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  ALLOWED_GITHUB_IDS: string;
  APP_TIME_ZONE: string;
}
export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  } });
}
export function config(env: Env): { ids: string[]; origin: string; zone: string } {
  const ids = env.ALLOWED_GITHUB_IDS?.split(',').map(v => v.trim()) ?? [];
  try {
    const url = new URL(env.APP_ORIGIN);
    if (url.origin !== env.APP_ORIGIN || url.hostname.includes('YOUR-SUBDOMAIN')) throw new Error();
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error();
    if (ids.length !== 2 || new Set(ids).size !== 2 || ids.some(id => !/^\d+$/.test(id))) throw new Error();
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) throw new Error();
    new Intl.DateTimeFormat('en', { timeZone: env.APP_TIME_ZONE }).format();
    return { ids, origin: url.origin, zone: env.APP_TIME_ZONE };
  } catch { throw new HttpError(503, 'NOT_CONFIGURED', '请先配置 Cloudflare 数据库、GitHub 登录及两个成员 ID'); }
}
export function requireOrigin(request: Request, env: Env): void {
  if (request.headers.get('Origin') !== config(env).origin) throw new HttpError(403, 'ORIGIN_REJECTED', '请求来源无效');
}
export async function readJson(request: Request, maxBytes = 65536): Promise<unknown> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, 'JSON_REQUIRED', '请求必须使用 JSON');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'EMPTY_BODY', '缺少请求内容');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) { await reader.cancel(); throw new HttpError(413, 'TOO_LARGE', '请求过大'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new HttpError(400, 'INVALID_JSON', 'JSON 格式无效'); }
}
export async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
}
export function cookie(request: Request, name: string): string | null {
  return request.headers.get('Cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
}
export function cookieHeader(name: string, value: string, seconds: number, env: Env): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${env.APP_ORIGIN.startsWith('https:') ? '; Secure' : ''}`;
}
