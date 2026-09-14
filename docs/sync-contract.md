# API v1 与 Android 接入契约

本文件描述已实现的 PWA/Worker 契约。Android 接入、数据导入和原生登录尚未实现；不要直接把 Room 文件覆盖到云端。

## 身份与权限

单个固定共享空间。`GET /api/v1/me` 返回：

```json
{
  "user": { "id": "123", "name": "成员甲", "login": "user-a" },
  "members": [
    { "id": "123", "name": "成员甲", "login": "user-a" },
    { "id": "456", "name": "成员乙", "login": "user-b" }
  ],
  "timeZone": "Asia/Shanghai"
}
```

上述 ID 仅为文档示例，不是可用身份。白名单在每次请求时校验。两位用户具有相同的读写权限，`ownerId` 只是归属。

`GET /api/auth/github/login` → GitHub → `GET /api/auth/github/callback`。OAuth state 绑定 HttpOnly Cookie 和一次性数据库记录，有效期 10 分钟；使用 S256 PKCE。成功回调写入 30 天有效的随机会话，数据库只保存会话 token 的 SHA-256。GitHub access token 仅用于本次查询身份，不下发给客户端或存储。

`POST /api/auth/logout` 注销当前会话。所有写 API 要求 `Origin` 等于 `APP_ORIGIN`；任务与生活数据写请求还要求 `X-LifePlanner-Actor` 等于当前登录用户 ID，用于阻止浏览器账号切换竞态。生产 Cookie 为 Secure、HttpOnly、SameSite=Lax，作用域 `/`。HTTP 只允许本地开发 origin。

## 任务模型

`Task` 字段：

| 字段 | 类型 / 语义 |
| --- | --- |
| id | 客户端生成 UUID |
| version | 服务端聚合版本，创建后为 1，每次接受操作递增 |
| title / note | 字符串；标题去空白后 1–200 字符，备注最多 10000 字符 |
| dueAt | UTC 毫秒或 null，表示任务模板截止时间 |
| isPinned / isArchived | 布尔值；归档保留同步数据，不硬删除 |
| recurrence | `DAILY` / `WEEKLY` / `MONTHLY` / null |
| recurrenceStart | `YYYY-MM-DD` |
| ownerId / createdBy / updatedBy | GitHub 数字 ID 的字符串表示 |
| createdAt / updatedAt | 服务端 UTC 毫秒时间 |
| occurrences | 此任务的实例数组 |

实例字段：`id`（`${taskId}:${plannedDate}`）、`taskId`、`plannedDate`、`dueAt`、`status`（PENDING / COMPLETED / SKIPPED）、`completedAt`（UTC 毫秒或 null）。任务与日期组合唯一。实例采用任务模板在共享时区中的截止“时刻”，移到对应计划日期。

服务端共享时区决定“今天”和重复任务的日期语义，不能跟随每台设备自行变化。JSON 日期字符串不要通过 `new Date('YYYY-MM-DD')` 转成本地日期；前后端使用 Temporal 做日历计算。

## 快照与写操作

`GET /api/v1/tasks/snapshot` 返回 `{ tasks: Task[], serverTime: number }`，包括全部归档任务及实例。当前数据规模使用完整快照，不分页，不清理幂等记录。

`POST /api/v1/tasks/commands`，Content-Type 为 `application/json`，最多 64 KiB：

```json
{
  "mutationId": "9d89b2a1-f99b-46ac-9d63-0e1ba4ed6f27",
  "taskId": "aa679bc3-3760-4e7b-b029-f1f41916d7db",
  "expectedVersion": 0,
  "operation": {
    "type": "save",
    "draft": {
      "title": "一起散步",
      "note": "晚饭后",
      "dueAt": null,
      "isPinned": false,
      "recurrence": "DAILY",
      "recurrenceStart": "2026-09-07",
      "ownerId": "123"
    }
  }
}
```

操作类型：

| type | 其他字段 | 行为 |
| --- | --- | --- |
| save | draft | 创建或修改模板；创建版本为 0，更新必须带当前版本 |
| pin | pinned: boolean | 修改置顶 |
| archive | 无 | 保留记录并归档；已归档任务不能继续修改 |
| status | date, status | 更新已有实例，COMPLETED 写入服务端完成时间，其他状态清空完成时间 |
| ensure | start, end | 生成缺少的实例，范围最多相差 740 天，已有实例不变 |

保存任务先保留今天之前和已完成/已跳过的实例，移除今天起的待办实例，再生成模板开始日起一个月的实例。查看日期时另生成选定日期前后各一个月。月重复从原始日期计算，例如 1 月 31 日 → 2 月末 → 3 月 31 日。

成功返回 `200 { task: Task }`。自动生成实例会递增版本，但不改写用户可见的最后修改人/时间。同一 `mutationId`、同一用户和相同规范化请求重复提交，返回第一次接受的结果，即使当前任务已经有更新。不得拿同一 mutation ID 修改 expectedVersion 后重试。

`409 VERSION_CONFLICT` 返回 `{ error, message, current: Task | null }`。`expectedVersion` 对整个任务及其实例生效，某个实例变化也会造成模板旧版本冲突。

D1 中 `mutations` INSERT 触发版本校验和任务 UPSERT；该语句失败时所有写入一起回滚。不会出现先写任务、后记幂等结果的中间状态。并发失败后重新检查幂等结果与当前版本。

其他错误：`400 INVALID_COMMAND / INVALID_OPERATION / INVALID_OWNER`、`401 UNAUTHENTICATED / ACCOUNT_CHANGED`、`403 ORIGIN_REJECTED`、`409 MUTATION_ID_REUSED`、`413 TOO_LARGE`、`415 JSON_REQUIRED`、`503 NOT_CONFIGURED`、`500 SERVER_ERROR`。错误不包含原始 SQL、密钥或 GitHub 载荷。API 响应均 `Cache-Control: no-store`。

## 日程、日记、库存与采购聚合

日记 `diaryDays[].entries[].createdBy` 为不可变的条目作者，由服务端根据当前身份设置，客户端不能指定。`diaryDays[].texts` 保存 `{ ownerId, content, createdAt, updatedAt }`，每个日期每个用户至多一篇。`saveDiaryDay.text` 仅更新请求用户的正文，空白删除该用户的条目；其他用户的正文始终保留。旧快照字段 `text` 保留为空字符串以兼容旧客户端结构。开心/不开心条目仍整页保存且允许双方修改，保留原作者。迁移 `0007_diary_owners.sql` 从历史命令快照恢复归属并提升版本；历史命令与幂等记录保持不变。

`GET /api/v1/planner/snapshot` 返回 `{ planner, serverTime }`。`planner` 包含 `version`、`schedules`、`diaryDays`、`stocks` 和 `shopping`。这些数据属于一个共享聚合，以保证一次库存购买可同时更新采购状态和库存余量、一次日记保存可同时更新条目和正文。

`POST /api/v1/planner/commands` 接受 `{ mutationId, expectedVersion, operation }`。操作包括日程保存/完成/归档、整日日记保存、库存保存/更新/归档、采购添加/移除/完成。成功返回 `{ planner }`；版本冲突返回当前完整聚合。D1 的 `planner_mutations` INSERT 通过触发器校验版本并原子更新 `planner_state`，幂等语义与任务命令一致。

生活数据使用整聚合版本，因此不同设备同时修改不同生活模块也可能冲突。这是当前小规模双人空间的保守一致性选择；冲突页会整体采用云端，或在云端最新版本上按序重放本机命令。任务仍使用独立的逐任务版本，不被生活数据冲突阻塞。

## 离线与冲突

IndexedDB 的 account 分区分别保存任务与生活数据的服务端基线、按序命令、每条命令的本机预览、冲突及最后同步时间；任务编辑草稿另存并保留编辑开始时的版本。保存表单使用编辑开始时的旧版本做校验，不会因后台拉取较新数据而自动取得覆盖权限。新增命令与预览保存于同一事务。

网络同步先确认当前身份，再按序上传当前队列快照。浏览器 Web Locks 协调多个页签；服务端版本和幂等检查仍为最终保护。确认响应后移除对应命令，未知结果或网络错误保留原 mutation ID 重试。

快照不覆盖有待同步命令的任务；无待同步命令时也不回退已知版本。冲突阻止该任务的后续上传，其他任务继续同步。采用云端会丢弃该任务的本机队列；重提本机操作用新 mutation ID，从最新云端版本重新应用。云端已归档或不存在时可把本机模板另存为新任务，其历史实例不搬到新任务。

若新云端结构使某个旧实例操作无效，本机预览保留；提示采用云端后重新编辑。客户端不会伪造成功或静默删除待同步操作。

## 个人资料

`POST /api/v1/profile` 接受 `{ name, avatar, bio }`，只能修改当前会话账号，校验 Origin 和 `X-LifePlanner-Actor`。资料保存在 `0003_profiles.sql` 创建的独立 `profiles` 表中，GitHub 登录更新 `members` 不会覆盖资料。`GET /api/v1/me` 返回两位成员的资料，并将 `Member.name` 统一解析为个人资料名称，未设置时回退到 GitHub 名称。

本机待同步资料优先覆盖自身的 `identity.user` 和 `identity.members`，因此各处成员标签立即一致。同步成功仅清除对应保存标记，上传期间新保存的内容仍保留；旧版仅本地保存的资料自动转为待同步。无待同步修改时采用云端资料。此处采用最后到达服务端的整份资料覆盖规则（包括网络重试），不使用任务或生活记录的版本冲突协议。资料上传失败保留本机内容；任务和生活记录在资料上传前完成同步。

## 后续 Android 实施顺序

1. 保留现有 Room v8 的 Long 主键。新增任务本地 ID ↔ UUID 映射表，并给实例建立 task UUID + 日期的映射；不要将 JavaScript 不安全的 Long 值作为云端数字主键。
2. 在一次 Room 事务中保存本地业务变更与 outbox，使用当前服务端版本建立命令；DAO/Entity 仍只留在 database 层，Feature 继续通过 Repository 访问。
3. 先让用户登录并确认本机旧数据归属。为旧任务分配一次性 UUID，持久化映射后逐条幂等上传；不能每次重试重新生成 UUID。
4. 本版 `save` 不支持直接导入历史已完成/跳过实例。正式迁移前需增加受认证、带迁移标识的原子导入接口及对应校验，才能保留完整历史；不能用任务模板导入冒充全量迁移。
5. 原生端应使用系统浏览器 OAuth 和单次兑换的登录交接机制；本轮只实现浏览器 Cookie 会话，尚未实现 Android 回跳或 Bearer token 发行。GitHub Client Secret 绝不能打进 APK。
6. 对齐共享时区后再迁移 dueAt 和计划日期；旧安卓数据按设备时区保存，迁移前必须明确原设备时区，避免跨日。
7. 执行同账号 Android ↔ iOS 与双账号并发验收，再扩展日程、日记等模型。后续日程外键引用稳定实例标识时，需单独处理模板重建与关联保留，不能直接沿用无关联任务表删除逻辑。
