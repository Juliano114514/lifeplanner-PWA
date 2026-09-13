import { plannerCommandSchema, applyPlannerCommand, emptyPlanner, normalizePlanner, type PlannerData } from '../shared/planner';
import { hash, HttpError, json, readJson, requireOrigin, type Env } from './http';
import type { Identity } from '../shared/contracts';

interface MutationRow { actor_id: string; request_hash: string; result: string }
async function getPlanner(env: Env): Promise<PlannerData> {
  const row = await env.DB.prepare("SELECT data FROM planner_state WHERE space_id = 'shared'").first<{ data: string }>();
  return row ? normalizePlanner(JSON.parse(row.data) as PlannerData) : emptyPlanner();
}
export async function plannerRoute(request: Request, env: Env, actor: Identity): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === '/api/v1/planner/snapshot' && request.method === 'GET') return json({ planner: await getPlanner(env), serverTime: Date.now() });
  if (path !== '/api/v1/planner/commands' || request.method !== 'POST') return null;
  requireOrigin(request, env);
  if (request.headers.get('X-LifePlanner-Actor') !== actor.user.id) throw new HttpError(401, 'ACCOUNT_CHANGED', '账号已改变，请刷新页面后继续');
  const parsed = plannerCommandSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new HttpError(400, 'INVALID_COMMAND', parsed.error.issues[0]?.message ?? '生活记录操作无效');
  const command = parsed.data, fingerprint = await hash(JSON.stringify(command));
  const replay = async (): Promise<Response | null> => {
    const prior = await env.DB.prepare('SELECT actor_id, request_hash, result FROM planner_mutations WHERE id = ?')
      .bind(command.mutationId).first<MutationRow>();
    if (!prior) return null;
    if (prior.actor_id !== actor.user.id || prior.request_hash !== fingerprint) throw new HttpError(409, 'MUTATION_ID_REUSED', '操作标识已经用于其他请求');
    return json({ planner: normalizePlanner(JSON.parse(prior.result) as PlannerData) });
  };
  const prior = await replay();
  if (prior) return prior;
  if (command.operation.type === 'saveWish' && !actor.members.map(member => member.id).includes(command.operation.draft.ownerId)) throw new HttpError(400, 'INVALID_OWNER', '请选择共享成员');
  const current = await getPlanner(env);
  const conflict = () => json({ error: 'VERSION_CONFLICT', message: '共享生活记录已在另一台设备修改，请选择保留的内容', current }, 409);
  if (current.version !== command.expectedVersion) return conflict();
  let next: PlannerData;
  try { next = applyPlannerCommand(current, command, actor.user.id, Date.now()); }
  catch (error) { throw new HttpError(400, 'INVALID_OPERATION', error instanceof Error ? error.message : '生活记录操作无效'); }
  try {
    await env.DB.prepare('INSERT INTO planner_mutations(id, actor_id, request_hash, expected_version, result, created_at) VALUES(?, ?, ?, ?, ?, ?)')
      .bind(command.mutationId, actor.user.id, fingerprint, command.expectedVersion, JSON.stringify(next), Date.now()).run();
  } catch (error) {
    const retried = await replay();
    if (retried) return retried;
    if ((await getPlanner(env)).version !== current.version) return conflict();
    throw error;
  }
  return json({ planner: next });
}
