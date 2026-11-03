# 合同与架构审计记录 (Audit Findings)

日期：2026-11-03
阶段：Phase 2 集成修复与本地 Cloudflare 运行时验收

## 1. 规范与合同一致性检查

经对照 `docs/api.md` 与 `docs/openapi.yaml` (版本 1.0.0)：

- **端点与方法**：`/api/health`、`/api/v1/addresses/random`、`/api/v1/mailboxes/{name}/messages` (GET & DELETE)、`/api/v1/messages/{id}` (GET & DELETE) 路径与方法一致。
- **时间与边界**：
  - `serverTime`、`since`、`before`、`receivedAt`、`expiresAt` 统一采用 Unix 毫秒整数（非负且 `<= Number.MAX_SAFE_INTEGER`）。
  - `since` 具有包含边界（`receivedAt >= since`）。
  - `before` 具有排他边界（`receivedAt < before`），且显式传入时必须 `<= serverTime`。
  - 单封邮件从接收时刻起严格保留 7 天（`expiresAt = receivedAt + 604800000`），未到期判定为 `expiresAt > serverTime`，到期邮件立即不可读。
- **排序与游标**：
  - 固定排序规则：`receivedAt DESC, id DESC`。
  - 游标使用 base64url 编码，长度不超过 1024 字符，结构内严格绑定 `name`、`since`、`fromDomain`、`subject`、`dmarcPass` 以及锚点 `lastReceivedAt` 和 `lastId`；请求条件不匹配时返回 400 `invalid_cursor`。
- **校验与错误**：
  - 邮箱名格式 `^(?!.*\.\.)[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$`，输入接受 ASCII 大写并规范化为小写。
  - 邮件 ID 严格为小写 UUID v4。
  - 统一错误格式 `{ error, message, details, requestId, serverTime }`，`details` 为空时返回 `[]`，不超过 10 项。
  - 统一应用响应头包含 `Cache-Control: no-store`、`Access-Control-Allow-Origin: *`、`Access-Control-Expose-Headers: Retry-After, X-Request-Id`、`X-Request-Id`、`X-Content-Type-Options: nosniff`。

## 2. 集成修复审计记录 (逐项排查与实施)

### A. 部署结构与全栈可执行性 (P0)

1. **Pages 全栈构建输出目录与 Functions 统一**：
   - **问题**：`apps/web` 独立构建至 `apps/web/dist`，而 `apps/api/wrangler.toml` 的 `pages_build_output_dir = "dist"` 缺少对应静态资源；Pages Functions 位于 `apps/api/functions`。且 Wrangler Pages 不支持通过 `--config` 指定非标准根配置。
   - **修复**：建立全栈自动同步构建流程。`apps/api/build.js` 将 `apps/web/dist` 的静态文件及 `_headers` 复制至 `apps/api/dist`，并调用 `wrangler pages functions build` 验证 Functions 打包。
   - **验证**：运行 `pnpm build`，`apps/api/dist` 成功生成完整的静态资源与 Functions 编译校验，本地 `wrangler pages dev` 无缝挂载。

2. **锁定版 Wrangler 与脚本补齐**：
   - **修复**：根工作区引入 Node 24 兼容的稳定锁定版 `wrangler@4.156.2`。
   - **脚本补齐**：根 `package.json` 提供 `build`, `check`, `test`, `test:all`, `pages:dev`, `worker:dev`, `deploy:pages`, `deploy:worker`, `db:migrate:local`, `db:migrate:remote`。

3. **生产 `database_id` 占位符拦截**：
   - **问题**：占位符 `database_id` 若未加防范可能被意外推送到线上导致运行时崩溃。
   - **修复**：创建 `scripts/validate-d1-env.js`、`deploy-pages.js`、`deploy-worker.js` 与 `migrate-remote.js`。在远程部署与迁移命令执行前，严格检查 `CLOUDFLARE_D1_DATABASE_ID` 是否为有效标准 UUID，若为缺失或占位符立即阻断退出（exit code 1），绝不静默部署占位符。

4. **唯一 Canonical SQL 与 D1 本地迁移**：
   - **修复**：全仓唯一的迁移文件固定为 `packages/db/migrations/0001_initial.sql`。在 `apps/api/wrangler.toml` 与 `apps/inbound-worker/wrangler.toml` 的 `[[d1_databases]]` 中配置 `migrations_dir = "../../packages/db/migrations"`，并统一本地开发 ID 为 `easytmp-mail-local-id`，使 Pages Functions 与 Email Worker 在本地开发时共享持久化数据库。

5. **Pages 安全配置 `_headers`**：
   - **修复**：在 `apps/web/public/_headers` 增加安全配置（Vite 构建时自动拷贝至 `dist/_headers`）：
     - `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-src 'self' about:; frame-ancestors 'none'; base-uri 'self'; form-action 'self';`
     - `X-Content-Type-Options: nosniff`
     - `Referrer-Policy: strict-origin-when-cross-origin`
   - 验证本地 Pages 启动后，根路径 `/` 响应头 100% 包含上述安全标头，且 `frame-src 'self' about:` 确保沙箱 `srcdoc` iframe 正常渲染。

### B. 共享层安全与正确性 (P0 / P1)

1. **严格 DMARC 认证与防伪造统一**：
   - **问题**：原 `packages/shared/src/mime/parser.ts` 循环扫描所有头，若发件人伪造注入第二个 `Authentication-Results` 或非 Cloudflare 认证头，会误判为 pass。
   - **修复**：将严格 DMARC 校验逻辑提取至 `packages/shared/src/mime/dmarc.ts` 并由 `inbound-worker` 共享。仅提取邮件头边界（`\r\n\r\n` / `\n\n`）之前的 RFC 5322 标头；仅检验首个 `Authentication-Results` 标头；验证 `authserv-id` 必须为 Cloudflare Email Routing 生产实际 MTA 标识（严格匹配 `/^mx\.cloudflare\.net$/i`）；正文伪造串严格忽略。
   - **新增测试**：在 `packages/shared/test/mime.test.ts` 补充 4 项攻击测试：首头伪造 pass、Cloudflare fail 后伪造 pass、正文注入伪造头、合法 Cloudflare pass，全部严格通过。

2. **严格 Cursor 结构解码**：
   - **修复**：在 `packages/shared/src/cursor/index.ts` 实施严格白名单属性检验，拒绝任何未知扩展字段；对可选字段 `since`（非负安全整数）、`fromDomain`（合规小写域名）、`subject`（1~200码点）、`dmarcPass`（严格布尔值）进行强制类型检查，并在 `packages/shared/test/cursor.test.ts` 增加完整攻击测试。

3. **均匀随机邮箱无模偏差**：
   - **修复**：在 `packages/shared/src/validation/mailbox.ts` 的 `generateRandomMailbox` 中采用 252 模截断丢弃法（Rejection Sampling，`36 * 7 = 252`，丢弃 `>= 252` 的字节），彻底消除 256 对 36 字符集的模偏差，生成完全均匀的 16 位随机字符。

4. **D1 Schema 7 天不可变 CHECK 约束**：
   - **修复**：在 `packages/db/migrations/0001_initial.sql` 中为 `messages` 表添加 `CHECK (expires_at = received_at + 604800000)`。同步调整测试 mock 数据的时间计算，并成功通过本地 D1 migration 执行验证。

### C. UI 合同与生命周期修正 (P1)

1. **手动输入与旧邮箱回看全量邮件**：
   - **问题**：原切换邮箱时将 `since` 设置为本地 `Date.now()`，导致旧邮箱中已存在的未过期邮件被错误隐藏。
   - **修复**：`switchMailbox` 默认设置 `taskSince: null`、`showAllMessages: true`，API 查询时不附带 `since` 参数，保证拉取该邮箱所有未过期的历史邮件。

2. **基线起始时间统一使用服务端权威时间**：
   - **修复**：任何需要重置任务开始时间的场景（`manualRefresh`、`resetTaskSince`）均先调用 `apiClient.getHealth()` 获取服务端 `serverTime` 作为基准，彻底杜绝客户端本地时钟漂移的影响。

3. **首页轮询与服务端权威集合对账**：
   - **修复**：在 `useMailbox.ts` 中重构第一页消息合并逻辑为权威对账（`reconcileMessages`）。当服务端权威集合不再包含某封邮件时（已被外部删除或自然到期），前端立即从列表中剔除，并在结果中按 `receivedAt DESC, id DESC` 重新排序，防止删除/过期邮件永久残留。

4. **单封删除确认去重**：
   - **修复**：从 `useMailbox.deleteSingleMessage` 中移除了冗余的 `window.confirm`，由 `MessageDetail` 弹窗统一负责单次确认，杜绝弹窗两次的体验问题。

5. **iframe CSP 与沙箱安全**：
   - **修复**：`SandboxIframe` 保持严格沙箱 `sandbox="allow-popups allow-popups-to-escape-sandbox"`（无 `allow-scripts`, 无 `allow-same-origin`, 无 `allow-forms`, 无 `allow-top-navigation`）；内联 CSP 允许清洗后的 HTML 排版与链接在新标签页打开，严格阻止脚本执行与外部资源请求。

6. **页面可见性与轮询并发控制**：
   - **修复**：引入 `isPollingInFlightRef` 防止异步轮询并发重叠；页面切换至后台（`hidden`）时彻底清除定时器；恢复前台（`visible`）时先触发一次后台对账再接续 3 秒轮询链条，轮询全程保持 `since` 固定不变。

7. **用户交互模型修正 (首屏不自动生成)**：
   - **要求**：首屏不得自动生成随机邮箱，必须支持直接手动输入邮箱名并查看。
   - **修复**：移除 `useMailbox` 挂载时的自动 `generateRandomMailbox` 调用，初始状态置为待命（`name: ''`, `isLoading: false`, 零初始 API 请求）；`AddressBar` 增加常驻的邮箱前缀输入框与“查看”按钮；`MessageList` 在未选择邮箱时展示友好的输入引导，且仅在用户主动点击“随机生成”时才调用随机接口。
   - **新增测试**：测试断言挂载时零请求、手动输入点击“查看”后拉取全部邮件、随机生成仅在点击按钮后触发。

## 3. 本地运行时验收结果 (真实命令与输出)

### 3.1 全仓依赖、类型、代码检查与测试

```sh
# 依赖完整性安装
pnpm install --frozen-lockfile
# 输出：Scope: all 6 workspace projects, Already up to date

# 全局全量生产构建
pnpm build
# 输出：
# packages/shared build: Done
# packages/db build: Done
# apps/web build: Done (dist/index.html, dist/assets, _headers)
# apps/api build: Done (Copied web assets to apps/api/dist, Wrangler compiled Pages Functions worker successfully)
# apps/inbound-worker build: Done (wrangler deploy --dry-run: Total Upload 516.41 KiB, exiting now)

# 静态检查
pnpm check
# 输出：TypeScript 0 errors, ESLint 0 errors, Prettier formatting all matched

# 自动化单元与集成测试
pnpm test:all
# 输出：19 test files passed, 169 tests passed, 0 failures
```

### 3.2 本地 D1 迁移与 Pages 运行时集成验证

本地启动 Pages 运行时（端口 8795，本地 D1 持久化路径 `.wrangler/state`）：

1. **应用 D1 本地迁移**：
   `pnpm db:migrate:local` 执行成功，4 条 SQL 指令（创建表、CHECK 约束、两处索引）应用完成。
2. **验证静态资源与安全标头 (`GET /`)**：
   `HTTP/1.1 200 OK`，返回完整 HTML，响应头包含：
   - `content-security-policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-src 'self' about:; frame-ancestors 'none'; base-uri 'self'; form-action 'self';`
   - `referrer-policy: strict-origin-when-cross-origin`
   - `x-content-type-options: nosniff`
3. **验证健康检查 (`GET /api/health`)**：
   `HTTP/1.1 200 OK`，`{"status":"ok","service":"easytmp-mail","apiVersion":"1","serverTime":...}`，包含 `Cache-Control: no-store` 与 `X-Request-Id`。
4. **验证随机生成 (`GET /api/v1/addresses/random`)**：
   `HTTP/1.1 200 OK`，返回符合 16 位小写字母数字的随机地址。
5. **验证空邮箱列表 (`GET /api/v1/mailboxes/testuser/messages`)**：
   `HTTP/1.1 200 OK`，返回 `messages: []`，`pagination: { limit: 20, nextCursor: null }`。
6. **验证数据写入、读取与删除完整生命周期**：
   - 向本地 D1 插入测试邮件（符合 `CHECK (expires_at = received_at + 604800000)`）。
   - 调用 `GET /api/v1/mailboxes/testuser/messages`，成功读取包含验证码候选、清洗后 HTML 标记及发件人信息的邮件。
   - 调用 `GET /api/v1/messages/{id}`，成功读取邮件详细正文。
   - 调用 `DELETE /api/v1/messages/{id}`，返回 `{"id":"...","deleted":true}`。
   - 再次调用 `GET /api/v1/messages/{id}`，确认返回 404 `message_not_found`。

## 4. 产物路径与未在线执行项说明

- **前端静态产物路径**：`apps/web/dist/`（包含 `index.html`, `assets/`, `_headers`）。
- **Pages 全栈交付产物路径**：`apps/api/dist/`（静态资源与安全标头）、`apps/api/functions/`（Hono Pages Functions）。
- **Email Worker 源码与配置**：`apps/inbound-worker/src/index.ts`、`apps/inbound-worker/wrangler.toml`。
- **数据库 Migration**：`packages/db/migrations/0001_initial.sql`。
- **无云端账号凭据无法在线执行的项**：
  1. 真实 Cloudflare D1 生产实例创建（`wrangler d1 create easytmp-mail`）。
  2. 真实线上数据库迁移与 Worker / Pages 远程发布（`pnpm db:migrate:remote`, `pnpm deploy:pages`, `pnpm deploy:worker`）。
  3. `cottage.dpdns.org` 域名的线上 MX 记录、Catch-all 邮件路由配置与旧 Worker 销毁。

## 5. Phase 3 生产部署自动化与上线验收审计记录

日期：2026-11-03
阶段：Phase 3 生产部署自动化、路由配置编排与上线验收设计
状态：**全部代码已完成并通过单元与集成测试（28个测试套件，215项测试 100% 通过）。未连接云端真实账户，未修改任何线上资源。**

### 5.1 部署级缺口排查与修复实施 (逐项核对)

1. **Cloudflare Email Routing Catch-all 自动化部署 (`scripts/configure-email-routing.js`)**：
   - **依据官方文档**：`GET /zones/{zone_id}/email/routing`、`GET /zones/{zone_id}/email/routing/rules/catch_all`、`PUT /zones/{zone_id}/email/routing/rules/catch_all`。
   - **实现与行为**：通过官方 REST API 读取 Zone、邮件路由状态、现有 Catch-all 规则与目标 Worker (`easytmp-mail-inbound`) 部署状态。若当前规则已正确指向目标 Worker 则直接判定幂等，不执行无用请求；若规则需要调整，对比输出前后差异。
   - **备份与脱敏**：在 `--apply` 修改前自动调用 `scripts/lib/backup.js`，将当前配置与规则以脱敏 JSON（自动抹除 Token、密码、密钥）备份至被 git 忽略的 `.wrangler/backups/email-routing-backup-*.json` 并打印摘要。
   - **安全防御**：内置域名强隔离，若传入 Zone ID 对应域名为 `roiding.dpdns.org` 或非 `cottage.dpdns.org`，立即抛出 `[SECURITY_REFUSAL]` 强行阻断。默认启用 `--dry-run`，只有显式传入 `--apply` 时才调用 PUT。

2. **旧服务清单生成与安全清理脚本 (`scripts/cleanup-old-service.js`)**：
   - **依据官方文档**：`GET /zones/{zone_id}/dns_records`、`PATCH /zones/{zone_id}/email/routing/dns`、`DELETE /zones/{zone_id}/email/routing/dns`、`DELETE /accounts/{account_id}/workers/scripts/{script_name}`。
   - **清单与备份**：在执行任何变更前，汇总 `cottage.dpdns.org` 现有的 MX 记录、SPF TXT 记录、Email Routing 设置与规则、旧 Worker 候选，并生成脱敏备份。
   - **锁定记录合规处理**：针对 Cloudflare Email Routing 托管的锁定 MX 记录（`locked: true`），优先通过官方 PATCH 解锁或停用 Email Routing DNS 处理，绝不尝试对锁定记录执行直接删除。
   - **旧 Worker 销毁安全防线**：
     - 支持 `--old-worker <name>` 或从 Catch-all 现有引用提取。若无法明确识别，抛出 `[SAFETY_BLOCK]` 阻断退出，绝不猜测。
     - 若旧 Worker 名称等于新服务 `easytmp-mail-inbound`，强行阻断退出。
     - 明确记录并验证：删除 Worker 脚本仅销毁计算代码及触发器，**绝对不会连带删除 D1 数据库、KV 命名空间或 R2 存储桶**。
   - **阶段控制**：划分 `preflight`（只读备份）、`switch`（路由切换）、`cleanup`（显式清理）阶段，要求必须在新服务部署验证完毕后由人工显式触发。

3. **Email Worker 绑定官方规范与 Pages 自定义域名 (`scripts/configure-pages-domain.js`)**：
   - **规则规范**：以 Cloudflare 官方规则结构为准：`actions: [{ type: "worker", value: ["easytmp-mail-inbound"] }], matchers: [{ type: "all" }]`。
   - **Pages 自定义域名绑定**：通过 `GET /accounts/{account_id}/pages/projects/easytmp-mail/domains` 探测现有绑定。若 `inbox.cottage.dpdns.org` 尚未绑定且处于 `--apply` 模式，通过 `POST` 发起绑定并自动输出 CNAME 解析指引（`inbox.cottage.dpdns.org -> easytmp-mail.pages.dev`）；限制仅操作 exact hostname `inbox.cottage.dpdns.org`。

4. **防止执行顺序错误与动态配置生成 (`scripts/orchestrate-deployment.js`, `scripts/lib/temp-config.js`)**：
   - **顺序固化**：`validate config -> build/check -> D1 migrate -> deploy Worker -> configure catch-all -> Pages deploy/bind -> smoke test -> verify -> cleanup`。
   - **杜绝重写版本控制文件**：彻底摒弃在原 `wrangler.toml` 上做临时写回的机制。通过 `scripts/lib/temp-config.js` 在被 git 忽略的 `.wrangler/tmp/` 目录下生成包含真实生产 `database_id` 与绝对路径的临时配置，并通过 `-c <temp-config>` 或 `--cwd <temp-dir>` 传递给 Wrangler；进程退出或异常中断时自动清理临时文件，确保工作区 `git status` 始终 100% 干净，杜绝生产 ID 泄漏入 git 提交。

5. **冒烟测试与验收脚本 (`scripts/smoke-test.js`)**：
   - 自动检测静态页面返回、CSP 沙箱标头（`frame-src self about:`）、`nosniff`。
   - 自动检测 `GET /api/health`、`GET /api/v1/addresses/random`、`GET /api/v1/mailboxes/{name}/messages`。
   - 输出完整的端到端真实发信验证与 7 天到期验收操作指引。

6. **全套自动化测试验证**：
   - 新增 9 套测试文件于 `scripts/test/`（环境校验、备份脱敏、API 客户端、Catch-all 编排、旧服务清理、Pages 域名、临时配置生成、冒烟测试、编排安全防线）。
   - 所有网络请求与外部子进程均支持依赖注入与 Vitest Mock，未向真实 Cloudflare 账户发送任何网络请求。
   - 全仓 28 个测试套件、215 项测试全部通过（0 失败）。

### 5.2 生产操作安全与责任界限声明

- **已完成**：所有部署自动化脚本、边界校验、安全防线、回退备份、冒烟测试及本地验收。
- **未在线执行**：本项目从未访问真实云端环境，未创建任何生产资源，未切换任何真实邮件路由，未删除任何线上 Worker 或 MX 记录。真实上线须由运维人员配置有效云端凭据后，显式运行各阶段命令。
