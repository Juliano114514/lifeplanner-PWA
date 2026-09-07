# LifePlanner PWA

面向两个固定用户的中文生活计划本。React PWA 提供 iPhone 主屏幕入口，Cloudflare Workers 提供同域 API，D1 保存共享任务，IndexedDB 保存本机数据、编辑草稿和待同步操作。

**当前交付：五个导航入口 + 完整任务模块。** 日程、日记、菜品、库存页面明确显示尚未实现。Android 仍为本地应用，本仓库尚未使 Android 自动联网或同步。

## 最短开始

需要 Node.js 24.2+、npm。首次检出后：

```powershell
cd C:\Users\liangjiayin\AndroidStudioProjects\lifeplanner\lifeplanner-PWA
npm ci
npm run db:local
Copy-Item .dev.vars.example .dev.vars
npm run dev
```

打开 <http://127.0.0.1:5173>。未配置认证时可看到页面、五个导航入口及配置提示；不会出现虚假数据，也没有绕过认证的开发身份。

完整登录需要在 `.dev.vars` 填入独立的开发 GitHub OAuth App 配置：

```dotenv
APP_ORIGIN=http://127.0.0.1:5173
GITHUB_CLIENT_ID=你的开发应用ClientID
GITHUB_CLIENT_SECRET=你的开发应用ClientSecret
ALLOWED_GITHUB_IDS=第一个数字ID,第二个数字ID
APP_TIME_ZONE=Asia/Shanghai
```

开发 OAuth 回调必须为 `http://127.0.0.1:5173/api/auth/github/callback`，不要混用 localhost 与 127.0.0.1。修改配置后重启开发服务。`.dev.vars` 已忽略，不能上传 Git。

开发服务使用本地 D1（`.wrangler/state`），不会访问生产数据库。Service Worker 只在生产构建中注册；`npm run dev` 不代表已经验证离线安装。

## 当前功能与数据

- 两人都能查看、编辑、置顶、完成、跳过、恢复待办、归档及转交任务。
- 新建任务默认归属本人；任务分别记录归属人、不可变创建人、最后修改人。
- 对齐 Android 的任务分组、三天内截止提醒、每日/每周/月末重复规则及未来待办重建行为。
- “全部 / 我的 / 对方的”筛选；每条任务的“操作与记录”内可恢复已完成或已跳过的实例。
- 编辑页自动保存草稿。关闭编辑页保留草稿；点击“保存任务”才形成待同步操作。
- 修改与队列同事务持久化。已登录设备可离线编辑，回到前台或网络恢复后同步，前台在线每 30 秒刷新一次。
- 冲突展示本机与云端内容，由用户决定。重提本机修改使用新操作 ID 和云端最新版本，仍可能再次冲突；归档记录不会被旧设备复活。
- 退出登录注销服务端会话，移除本机自动打开账号的指针，但保留按账号隔离的草稿与队列，供同一账号重新登录后继续。

输入包含标题、备注、开始日期、可选截止时间、重复频率和归属人。数据只有一个共享空间，归属不是访问控制；两位用户权限相同。改变白名单、时区或清空本地存储不是普通数据操作，已有数据需要单独考虑迁移。

## 部署到 Cloudflare

选择 **Workers + Static Assets + D1**，无需单独创建 Pages 项目，也无需 R2、KV、容器或服务器。

### 1. 登录并创建数据库

```powershell
npx wrangler login
npx wrangler d1 create lifeplanner --config wrangler.jsonc
```

把输出的数据库 UUID 写入 `wrangler.jsonc` 的 `d1_databases[0].database_id`，保留 binding 名称 `DB`。默认的全零 UUID 仅用于初始化本地工程，不是可发布的生产配置。

在 Cloudflare 控制台 Workers & Pages 中确认你的 `workers.dev` 子域名。默认 Worker 名称是 `lifeplanner-pwa`，正式地址对应：

```text
https://lifeplanner-pwa.<你的子域名>.workers.dev
```

也可使用自己的域名；此时先完成域名绑定并统一使用它作为正式地址。不要在两个不同域名间来回登录，它们的 Cookie、IndexedDB 和安装实例互不共享。

### 2. 创建生产 GitHub OAuth App

GitHub → Settings → Developer settings → OAuth Apps → New OAuth App：

| 字段 | 值 |
| --- | --- |
| Application name | LifePlanner |
| Homepage URL | 正式站点地址 |
| Authorization callback URL | `https://<正式域名>/api/auth/github/callback` |

生产和本地开发使用两个独立 OAuth App。登录只读取公开个人资料，不申请仓库权限。

取得两人的固定数字 ID，可以执行：

```powershell
$firstMember = Invoke-RestMethod 'https://api.github.com/users/第一个用户名'
$secondMember = Invoke-RestMethod 'https://api.github.com/users/第二个用户名'
$firstMember.id
$secondMember.id
```

在 `wrangler.jsonc` 的 `vars` 填写：

```json
{
  "APP_ORIGIN": "https://lifeplanner-pwa.<你的子域名>.workers.dev",
  "GITHUB_CLIENT_ID": "生产OAuth应用的ClientID",
  "ALLOWED_GITHUB_IDS": "数字ID1,数字ID2",
  "APP_TIME_ZONE": "Asia/Shanghai"
}
```

`APP_ORIGIN` 不能有末尾斜杠。白名单必须正好包含两个不同的数字 ID，**不要写用户名**。尚未登录的第二位成员会显示“成员 2（尚未登录）”；对方首次登录后会更新名称。

### 3. 保存生产密钥

```powershell
npx wrangler secret put GITHUB_CLIENT_SECRET --config wrangler.jsonc
```

按终端提示输入生产 Client Secret。若 Worker 尚不存在，Wrangler 可能询问是否创建对应 Worker。密钥只保存在 Cloudflare；不要写进 `wrangler.jsonc`、前端 `VITE_*` 变量或 Git。

### 4. 迁移并部署

```powershell
npm run db:remote
npm run check
npm run lint
npm run check:sql
npm run build
npx wrangler deploy
```

数据库命令显式指定源 `wrangler.jsonc`，避免 Vite 的旧构建配置指向错误数据库。每次修改生产配置后都必须重新构建，再执行部署。前端与 Worker 一次发布，`/api/*` 优先进入 Worker，其余路径支持 SPA 回退。

产物在 `dist/client` 和 `dist/lifeplanner_pwa`。`dist/client/sw.js` 自动列举本次构建的 JS/CSS 和安装图标。不要手工修改生成文件。以后可执行 `npm run deploy` 重新构建并发布；新增 SQL 迁移需先运行 `npm run db:remote`。

### 5. 验证正式站点与 iPhone 安装

1. 访问 `/api/health`：应为 `200`，这只证明 Worker 存活，不证明数据库、认证或同步正常。
2. 用两个指定 GitHub 账号分别登录；第三个账号必须被拒绝。
3. 一端新建、转交、完成任务，另一端同步后应看到相同内容与修改人。
4. 用 iPhone Safari 打开正式站点 → 分享 → 添加到主屏幕 → 从图标启动；必要时在主屏幕实例中重新登录。
5. 成功在线打开并完成缓存后断网，验证重开、编辑、重连上传及重复提交。
6. 两台设备同时编辑同一任务，确认出现冲突提示；具体清单见 [验收记录](docs/verification.md)。

PWA 的后台运行由系统管理，本应用不承诺关闭后持续同步。首次登录、会话续期、退出和上传需要网络。请勿在尚有未同步内容时清除站点数据；IndexedDB 不等于云端备份。

### 故障定位与回退

| 现象 | 检查 |
| --- | --- |
| 显示“请先配置…” / API 503 | 正式 origin、Client ID/Secret、两个数字 ID、有效时区；改配置后重新构建 |
| GitHub 回调失败 | OAuth App 的回调地址、Cookie、开发/生产 Client Secret 是否混用 |
| API 500 | `DB` binding 是否正确、目标 D1 是否执行迁移；不粘贴原始任务或认证载荷到日志 |
| 来源被拒绝 / 403 | 当前访问域名是否与 `APP_ORIGIN` 完全一致 |
| 401 / 登录过期 | 使用同一账号重新登录；队列保留，其他账号不会代为上传 |
| 页面能打开但离线失败 | 确认 HTTPS、生产构建、Service Worker 已安装、不是首次离线打开 |

发布前使用 D1 export 保存数据库备份。只回退 Worker 版本不会回退数据库；本版初始迁移无破坏性操作，后续迁移应先保持旧版本兼容。不要为回退删除 `mutations` 幂等记录或用户数据。

## 代码入口与后续工作

```text
src/app/             应用布局、登录状态、路由、同步触发、应用更新
src/features/tasks/  任务列表、编辑、归属筛选、冲突展示
src/data/            API、IndexedDB、离线队列、同步协调
src/ui/              样式与 UI token
shared/              请求校验、公共类型、前后端共用任务规则
worker/              OAuth、会话、任务 API
migrations/          D1 版本迁移
docs/                API、Android 接入及验收说明
```

API 和 Android 字段映射见 [同步契约](docs/sync-contract.md)。先接入 Android 登录与任务同步、旧数据上传，再依次实现日程/快速安排、日记、菜品、库存与采购。现有 Android 仓库本轮没有修改。

参考：[Cloudflare React 部署](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/)、[D1 命令](https://developers.cloudflare.com/d1/wrangler-commands/)、[GitHub OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)、[WebKit 存储策略](https://webkit.org/blog/14403/updates-to-storage-policy/)。
