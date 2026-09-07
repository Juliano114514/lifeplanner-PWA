import { commandSchema, type Identity, type Task } from '../shared/contracts';
import { applyCommand } from '../shared/domain';
import { hash, HttpError, json, readJson, requireOrigin, type Env } from './http';

interface MutationRow { actor_id: string; request_hash: string; result: string }
async function getTask(env: Env, id: string): Promise<Task | null> {
  const row = await env.DB.prepare('SELECT data FROM tasks WHERE id = ?').bind(id).first<{ data: string }>();
  return row ? JSON.parse(row.data) as Task : null;
}
export async function tasksRoute(request: Request, env: Env, actor: Identity): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === '/api/v1/tasks/snapshot' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT data FROM tasks ORDER BY id').all<{ data: string }>();
    return json({ tasks: results.map(row => JSON.parse(row.data) as Task), serverTime: Date.now() });
  }
  if (path !== '/api/v1/tasks/commands' || request.method !== 'POST') return null;
  requireOrigin(request, env);
  if (request.headers.get('X-LifePlanner-Actor') !== actor.user.id) {
    throw new HttpError(401, 'ACCOUNT_CHANGED', '账号已改变，请刷新页面后继续');
  }
  const parsed = commandSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new HttpError(400, 'INVALID_COMMAND', parsed.error.issues[0]?.message ?? '任务操作无效');
  const command = parsed.data, fingerprint = await hash(JSON.stringify(command));
  const replay = async (): Promise<Response | null> => {
    const prior = await env.DB.prepare('SELECT actor_id, request_hash, result FROM mutations WHERE id = ?')
      .bind(command.mutationId).first<MutationRow>();
    if (!prior) return null;
    if (prior.actor_id !== actor.user.id || prior.request_hash !== fingerprint) {
      throw new HttpError(409, 'MUTATION_ID_REUSED', '操作标识已经用于其他请求');
    }
    return json({ task: JSON.parse(prior.result) as Task });
  };
  const previousResponse = await replay();
  if (previousResponse) return previousResponse;
  const conflict = async () => json({ error: 'VERSION_CONFLICT', message: '此任务已被修改，请选择保留的内容', current: await getTask(env, command.taskId) }, 409);
  const current = await getTask(env, command.taskId);
  if ((current?.version ?? 0) !== command.expectedVersion) return conflict();
  if (command.operation.type === 'save') {
    // Ownership is checked against the server's fixed member list, never a client list.
    const ownerId = command.operation.draft.ownerId;
    if (!actor.members.some(m => m.id === ownerId)) throw new HttpError(400, 'INVALID_OWNER', '归属人必须是共享空间成员');
  }
  let next: Task;
  try { next = applyCommand(current, command, actor.user.id, actor.timeZone, Date.now()); }
  catch (error) { throw new HttpError(400, 'INVALID_OPERATION', error instanceof Error ? error.message : '任务操作无效'); }
  try {
    await env.DB.prepare('INSERT INTO mutations(id, actor_id, request_hash, task_id, expected_version, result, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)')
      .bind(command.mutationId, actor.user.id, fingerprint, command.taskId, command.expectedVersion, JSON.stringify(next), Date.now()).run();
  } catch (error) {
    const retried = await replay();
    if (retried) return retried;
    if ((await getTask(env, command.taskId))?.version !== current?.version) return conflict();
    throw error;
  }
  return json({ task: next });
}
