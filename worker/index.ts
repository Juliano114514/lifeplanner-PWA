import { authRoute, identity } from './auth';
import { config, HttpError, json, type Env } from './http';
import { tasksRoute } from './tasks';
import { plannerRoute } from './planner';
import { profileRoute } from './profile';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/api/health' && request.method === 'GET') return json({ ok: true, service: 'lifeplanner', apiVersion: 1 });
      config(env);
      const auth = await authRoute(request, env);
      if (auth) return auth;
      const person = await identity(request, env);
      if (path === '/api/v1/me' && request.method === 'GET') return json(person);
      return await profileRoute(request, env, person) ?? await tasksRoute(request, env, person) ?? await plannerRoute(request, env, person) ?? json({ error: 'NOT_FOUND', message: '接口不存在' }, 404);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.code, message: error.message }, error.status);
      // Never log OAuth payloads, session tokens, diary/task content or raw D1 errors.
      return json({ error: 'SERVER_ERROR', message: '服务暂时不可用，请稍后重试或检查数据库迁移' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
