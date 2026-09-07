import type { ApiError } from '../../shared/contracts';

export class ApiFailure extends Error {
  constructor(public status: number, public detail: ApiError) { super(detail.message); }
}
export async function api<T>(path: string, body?: unknown, actorId?: string): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000),
    ...(body === undefined ? {} : { method: 'POST', headers: {
      'Content-Type': 'application/json', ...(actorId ? { 'X-LifePlanner-Actor': actorId } : {}),
    }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    let detail: ApiError;
    try { detail = await response.json() as ApiError; }
    catch { detail = { error: 'NETWORK_ERROR', message: `服务返回错误（${response.status}）` }; }
    throw new ApiFailure(response.status, detail);
  }
  return response.json() as Promise<T>;
}
