# Cloudflare EasyTmp Mail

完全公开、免密使用的临时接码邮箱。采用 Cloudflare Pages 托管静态网页与同源 Pages Functions (`/api/*`)、Email Worker 接收邮件并定时清理，两端通过 Cloudflare D1 数据库持久化并共享数据。邮箱无需预先创建，Web UI 和 HTTP API 均支持指定邮箱名或由用户主动点击生成随机邮箱名；每封邮件自服务接收起保留 7 天。

> **当前部署状态**：所有代码、构建流程与本地运行时验收均已在本地完成，**未执行任何线上云端部署，未调用真实 Cloudflare 线上 API，未改动任何线上资源**。

- [架构设计](docs/architecture.md)
- [API v1 接口文档](docs/api.md)：字段定义、`since` 筛选、游标分页、删除与统一错误格式
- [OpenAPI 3.1 规范](docs/openapi.yaml)：版本 1.0.0，可导入接口工具或生成客户端
- [审计记录](AUDIT_FINDINGS.md)：集成修复与运行时验收记录
- 邮件域名：`cottage.dpdns.org`
- 网页和 API 域名：`inbox.cottage.dpdns.org`（已规划）
- 公开免密：无需注册、登录、密钥或 Token
- 交互模型：首页进入为待命状态（不自动请求随机邮箱、零初始 API 请求），提供始终可见的邮箱名前缀输入框与“查看”按钮；用户主动点击“随机生成”时才调用随机接口。

## 项目结构 (pnpm workspace)

```text
cloudflare-easytmp-mail/
├── packages/
│   ├── shared/         # 纯业务工具：API 类型、邮箱/ID/Query 校验、严格 Cursor 编解码、HTML 清洗、提取器、严格 DMARC 验证
│   └── db/             # D1 Repository、SQL 查询构建器、0001 初始 Schema 迁移 (7天 CHECK 约束) 与测试 Mock
├── apps/
│   ├── api/            # Cloudflare Pages Functions (/api/*) 与全栈静态产物构建入口
│   ├── inbound-worker/ # Cloudflare Email Worker 与 Cron Trigger scheduled() 定时清理
│   └── web/            # React + Vite 静态网页（深色操作区、浅色收件箱、安全沙箱 iframe、支持直接输入查看）
├── scripts/            # 生产部署安全检查脚本（严格校验 CLOUDFLARE_D1_DATABASE_ID，拦截占位符）
├── docs/               # 架构与 OpenAPI 规范
└── .dev.vars.example   # 本地开发环境变量模板
```

## 开发与集成验收命令

```sh
# 依赖安装（使用已锁定的 lockfile）
pnpm install --frozen-lockfile

# 全仓生产构建（按序构建 shared、db、web、api 静态同步与 Functions 打包验证、inbound-worker dry-run）
pnpm build

# 全局类型检查、ESLint 代码检查与 Prettier 格式化检查
pnpm check

# 运行全套 169 项自动化测试（覆盖 API 语义、D1 Repository、DMARC 攻击、严格游标、UI 轮询对账）
pnpm test:all

# 本地启动 Pages 全栈开发服务器（端口 8788，绑定本地 D1 并挂载 /api/* 与静态资源，支持 _headers 安全策略）
pnpm pages:dev

# 本地启动 Inbound Email Worker
pnpm worker:dev

# 本地 D1 数据库执行迁移（读取唯一 canonical SQL packages/db/migrations/0001_initial.sql）
pnpm db:migrate:local
```

## 生产部署前命令与必需环境变量

所有生产操作均内置安全前置检查脚本，**严禁将占位符 `database_id` 部署到生产环境**，所有操作**默认启用 `--dry-run` 安全模拟模式**，必须显式附加 `--apply` 才会执行修改。部署过程中**绝对不修改仓库内受版本控制的 `wrangler.toml` 文件**（均通过 `.wrangler/tmp` 动态临时配置注入并在进程退出时自动销毁）。

### 环境变量矩阵

| 环境变量名                  | 是否必需                        | 说明                                                                                                                                          |
| --------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_D1_DATABASE_ID` | **必需** (部署/迁移时)          | 生产 Cloudflare D1 真实 UUID (格式 `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`)。若缺失或为占位符立即阻断。                                        |
| `CLOUDFLARE_API_TOKEN`      | **必需** (路由/域名/清理时)     | 具备 Email Routing、Workers、Pages、DNS 操作权限的官方 API Token。**Token 严禁打印且不保存在任何备份中**。                                    |
| `CLOUDFLARE_ACCOUNT_ID`     | **必需** (API/Worker/Pages)     | 32 位十六进制 Cloudflare Account ID。                                                                                                         |
| `CLOUDFLARE_ZONE_ID`        | **必需** (Zone 操作时)          | 32 位十六进制 Cloudflare Zone ID。脚本**强制核验 Zone 名称必须为 `cottage.dpdns.org`，若匹配到 `roiding.dpdns.org` 或其他域名立即安全拒决**。 |
| `MAIL_DOMAIN`               | 可选 (默认 `cottage.dpdns.org`) | 收信域名，必须为 `cottage.dpdns.org`。严禁指向 `roiding.dpdns.org`。                                                                          |
| `OLD_WORKER_NAME`           | 可选 (清理阶段)                 | 旧临时邮箱 Worker 脚本名称。若未提供且无法从现有 Catch-all 明确推断，清理脚本将**安全阻断而非猜测**。                                         |
| `REQUIRE_DMARC_PASS`        | 可选 (默认 `"true"`)            | Inbound Email Worker 收信是否强制要求 DMARC pass。                                                                                            |

### 官方 Cloudflare API 端点基准

本项目自动化脚本严格基于 Cloudflare 官方 REST API（v4）实现，杜绝伪造 API 端点：

- **Email Routing Settings**: `GET /zones/{zone_id}/email/routing` ([官方文档](https://developers.cloudflare.com/api/resources/email_routing/methods/get/))
- **Email Routing Catch-all GET**: `GET /zones/{zone_id}/email/routing/rules/catch_all` ([官方文档](https://developers.cloudflare.com/api/resources/email_routing/subresources/rules/subresources/catch_alls/methods/get/))
- **Email Routing Catch-all PUT**: `PUT /zones/{zone_id}/email/routing/rules/catch_all` ([官方文档](https://developers.cloudflare.com/api/resources/email_routing/subresources/rules/subresources/catch_alls/methods/update/))
- **Email Routing DNS status**: `GET /zones/{zone_id}/email/routing/dns` ([官方文档](https://developers.cloudflare.com/api/resources/email_routing/subresources/dns/methods/get/))
- **Pages Custom Domains List**: `GET /accounts/{account_id}/pages/projects/{project_name}/domains` ([官方文档](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/domains/methods/list/))
- **Pages Custom Domains Create**: `POST /accounts/{account_id}/pages/projects/{project_name}/domains` ([官方文档](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/domains/methods/create/))
- **Worker Scripts GET/DELETE**: `GET / DELETE /accounts/{account_id}/workers/scripts/{script_name}` ([官方文档](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/delete/))

---

### 分阶段部署与编排操作指南

为防止执行顺序错误，自动化编排严格划分为三阶段：`preflight` (前置校验与构建) -> `switch` (生产部署与路由切换) -> `cleanup` (旧服务核对与清理)。

```sh
# 0. 配置生产环境变量
export CLOUDFLARE_D1_DATABASE_ID="你的-d1-数据库-uuid"
export CLOUDFLARE_API_TOKEN="你的-cloudflare-api-token"
export CLOUDFLARE_ACCOUNT_ID="你的-32位-account-id"
export CLOUDFLARE_ZONE_ID="你的-32位-cottage-zone-id"

# 阶段一：前置核验 (Preflight - 纯 Dry-Run，校验环境、核对域名、跑通全套测试与构建)
pnpm deploy:orchestrate --stage=preflight

# 阶段二：生产发布与切换 (Switch)
# 默认干跑预览：
pnpm deploy:orchestrate --stage=switch --dry-run
# 确认无误后执行正式发布（D1迁移 -> Worker部署 -> Catch-all配置 -> Pages发布 -> 自定义域名绑定 -> 冒烟测试）：
pnpm deploy:orchestrate --stage=switch --apply

# 阶段三：旧服务安全清理 (Cleanup - 独立显式阶段)
# 生成旧 MX / Email Routing / 旧 Worker 资源清单并备份到 .wrangler/backups：
pnpm cleanup:check
# 确认新服务验收无误后，执行旧服务解绑与销毁（支持指定 --old-worker <name>）：
pnpm cleanup:apply --old-worker="旧Worker脚本名称"
```

### 专项自动化脚本一览

所有脚本均默认 `--dry-run`，只有附加 `--apply` 时才进行实际变更，并在执行修改前自动保存凭据脱敏后的 JSON 备份至 `.wrangler/backups/...`：

```sh
# 1. Cloudflare Email Routing Catch-all 规则配置 (定向至 easytmp-mail-inbound)
pnpm email-routing:check                  # 只读检查当前规则并打印 diff
pnpm email-routing:apply                  # 保存备份并更新 Catch-all 规则

# 2. Pages 自定义域名 inbox.cottage.dpdns.org 绑定与探测
pnpm pages:domain:check                   # 探测当前绑定状态
pnpm pages:domain:apply                   # 发起域名绑定并输出 DNS/CNAME 指引

# 3. 生产服务部署 (自动使用临时配置，不修改 git 跟踪的 wrangler.toml)
pnpm db:migrate:remote                    # 远程 D1 数据库迁移检查/执行
pnpm deploy:worker                        # Inbound Email Worker 打包部署
pnpm deploy:pages                         # Pages 静态资源与 Functions 打包部署

# 4. 上线后冒烟测试 (Static UI, CSP Headers, Health, Random Address, Mailbox Query)
pnpm smoke-test                           # 默认探测 https://inbox.cottage.dpdns.org
pnpm smoke-test --url http://localhost:8788  # 针对本地开发实例探测
```

## 旧服务清理与迁移安全规范 (`cottage.dpdns.org`)

根据架构规范与迁移要求，上线时需在 `cottage.dpdns.org` 域名执行替换迁移（`roiding.dpdns.org` 绝对不在操作范围）：

1. **绝对隔离保护**：任何涉及 Zone 或 DNS 的脚本均强制校验 `zone.name === "cottage.dpdns.org"`，若检测到目标为 `roiding.dpdns.org` 或任何其他域名立即抛出 `[SECURITY_REFUSAL]` 强行终止。
2. **保留邮件路由基础设施**：新服务继续使用同一收件域上的 Cloudflare Email Routing，托管 MX/SPF 是新服务接信所需的共享基础设施。清理脚本只备份、核对，不删除或解除这些记录；切换 catch-all 到新 Worker 后即可完成服务替换。
3. **清理顺序硬性拦截**：只有确认 catch-all 已指向 `easytmp-mail-inbound` 后才允许删除旧 Worker。若旧 Worker 仍是当前投递目标，脚本立即安全阻断，避免先删掉仍在接信的服务。
4. **旧 Worker 销毁安全防线**：
   - 严禁猜测 Worker 名称：旧 Worker 删除须依据用户提供的 `--old-worker` / `OLD_WORKER_NAME` 或从现有 Catch-all 规则提取；若无法安全识别则抛出 `[SAFETY_BLOCK]` 退出。
   - 保护新服务：若传入或推断出的旧 Worker 名称等于 `easytmp-mail-inbound`，脚本强行阻断。
   - 数据资源隔离：删除 Worker 脚本仅销毁计算代码及触发器，**绝对不会连带删除 D1 数据库、KV 命名空间或 R2 存储桶**。
5. **顺序硬性保障**：编排脚本将清理作为完全独立的最后阶段，必须在新服务完成构建、D1 迁移、新 Worker 部署、邮件路由更新、Pages 部署及验证通过后，方可由操作员显式触发清理。

## 业务与核心安全规则

- **7 天不可变保留**：数据库 schema 强制实施 `CHECK (expires_at = received_at + 604800000)`，查询层与删除层严格校验 `expires_at > serverTime`，到期即不可读。
- **严格 DMARC 认证**：只信任 Cloudflare Email Routing MTA 注入的首个 `Authentication-Results` 头且严格验证其 `authserv-id` 为 `mx.cloudflare.net`（`/^mx\.cloudflare\.net$/i`），任何来自发件人伪造的后续头、正文伪造头或非 Cloudflare 验证结果均判定为未通过。
- **游标防御**：解码时严格拒绝包含未知字段的 JSON 结构，严格校验 `since`、`fromDomain`、`subject`、`dmarcPass` 类型与范围，必须与查询过滤条件严格对齐。
- **均匀随机邮箱**：采用 252 模截断丢弃法（Rejection Sampling），消除 256 对 36 字符集的模偏差，生成绝对均匀的 16 位密码学安全随机地址。
- **权威对账与生命周期**：前端轮询每 3 秒获取最新页并与服务器集合对账，自动移除外部已删除或过期的邮件；页面不可见时彻底挂起定时器，恢复可见时立即刷新；单封删除仅在弹窗处确认一次，杜绝重复二次确认。
- **Pages 安全标头**：通过 `_headers` 配置静态资源 CSP（严格限制 `frame-src 'self' about:` 以安全运行 `srcdoc` 沙箱 iframe，阻止脚本与远程图片）、`nosniff`、`frame-ancestors 'none'`、`Referrer-Policy`。
