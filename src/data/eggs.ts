import type { EggEntry, EggHistory } from '../../shared/egg';
import { api } from './api';

type EggResponse = EggHistory | { entry: EggEntry | null };
const MAX_AGE = 15000, MAX_ENTRIES = 12, MAX_BYTES = 12 * 1024 * 1024;
const cache = new Map<string, { value: EggResponse; expires: number; bytes: number }>();
const pending = new Map<string, Promise<EggResponse>>();
let generation = 0;
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('lifeplanner-eggs');

export function invalidateEggs(): void {
  generation++;
  cache.clear();
  pending.clear();
}
channel?.addEventListener('message', invalidateEggs);
window.addEventListener('online', invalidateEggs);
window.addEventListener('offline', invalidateEggs);
document.addEventListener('visibilitychange', invalidateEggs);

function remember(key: string, value: EggResponse): void {
  const now = performance.now();
  for (const [id, item] of cache) if (item.expires <= now) cache.delete(id);
  // Count UTF-16 payload bytes, including base64 media, rather than only entry count.
  const bytes = JSON.stringify(value).length * 2;
  if (bytes > MAX_BYTES) return;
  cache.delete(key);
  let total = bytes;
  for (const item of cache.values()) total += item.bytes;
  while (cache.size && (cache.size >= MAX_ENTRIES || total > MAX_BYTES)) {
    const oldest = cache.keys().next().value!;
    total -= cache.get(oldest)!.bytes;
    cache.delete(oldest);
  }
  cache.set(key, { value, expires: now + MAX_AGE, bytes });
}

async function read<T extends EggResponse>(actorId: string, path: string): Promise<T> {
  const key = JSON.stringify([actorId, path]);
  const cached = cache.get(key);
  if (cached && cached.expires > performance.now() && navigator.onLine) {
    cache.delete(key);
    cache.set(key, cached);
    return structuredClone(cached.value) as T;
  }
  cache.delete(key);
  let request = pending.get(key);
  if (!request) {
    const started = generation;
    request = api<T>(path).then(value => {
      // A write or refresh may finish while this older GET is still in flight.
      if (started === generation) remember(key, value);
      return value;
    }).finally(() => {
      if (pending.get(key) === request) pending.delete(key);
    });
    pending.set(key, request);
  }
  // Keep callers from changing cached data or another reader's result.
  return structuredClone(await request) as T;
}

export const readEggHistory = (actorId: string, before?: number) =>
  read<EggHistory>(actorId, `/api/v1/eggs${before === undefined ? '' : `?before=${before}`}`);
export const readEgg = (actorId: string, ownerId?: string, entryId?: string) =>
  read<{ entry: EggEntry | null }>(actorId, entryId ? `/api/v1/eggs/${encodeURIComponent(entryId)}` : `/api/v1/eggs/latest?owner=${encodeURIComponent(ownerId ?? actorId)}`);

export async function writeEgg<T>(actorId: string, path: string, body: unknown): Promise<T> {
  const invalidate = () => { invalidateEggs(); channel?.postMessage('changed'); };
  invalidate();
  try { return await api<T>(path, body, actorId); }
  // Also invalidate uncertain writes: the server may have committed before a timeout.
  finally { invalidate(); }
}
