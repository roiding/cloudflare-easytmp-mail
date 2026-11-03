# AI Agent 启动与任务提示词库 (AI Prompts)

本文件汇总了面向 **Claude Code**、**OpenAI Codex** 以及 **CPA (gemini-3.8-flash)** 等自主编码 Agent 的标准提示词。所有提示词均经过严格工程打磨，内置了零凭据泄露、执行前审计、资源零破坏与状态机收敛等核心安全护栏。

---

## 1. 通用 Agent 安全前置约束（不可妥协原则）

无论使用何种 Agent 工具，在下发任务时，Agent 必须遵循以下红线：

```text
[AGENT_SAFETY_GUARDRAILS]
1. 绝对零凭据打印：绝不以任何形式在终端、日志、消息或代码中打印 OAuth 令牌、Refresh Token 或 API Token。
2. 授权交互规则：若检测到 Cloudflare Wrangler 未登录，严禁尝试反向破解凭据，只引导用户在本地浏览器（Chrome）中执行 `pnpm exec wrangler login`。
3. 历史资源保护：严禁删除任何非本任务声明的既有 Cloudflare 资源。官方生产域 cottage.dpdns.org 上的历史旧 Worker 已安全删除，自建环境默认跳过删除。严禁删除 D1 数据库及托管 MX/SPF 记录。
4. 强制执行前审计：修改文件前必须完整阅读 easytmp.config.json 和 docs/AGENT_RUNBOOK.md。
5. 优先 Dry-Run：先运行 `pnpm onboard` 确认资源探测无误，再使用 `pnpm onboard --apply` 正式发布。
```

---

## 2. Claude Code 专属提示词

### 提示词 2.1：从零新域名 5 分钟自动化部署

适用于使用 Anthropic `claude` 终端工具进行自动化部署：

```markdown
你现在是 Cloudflare EasyTmp Mail 自动化部署工程师。
目标：将当前项目部署上线至我的自定义域名。

执行规范与步骤：
1. 阅读根目录 `easytmp.config.json` 和 `docs/AGENT_RUNBOOK.md`，理解上线状态机。
2. 将 `easytmp.config.json` 中的 `mailDomain` 修改为我的目标域名："<YOUR_DOMAIN.COM>"。
3. 执行 `npx wrangler whoami --json` 检查登录态。如果未登录，请暂停并提示我在 Chrome 浏览器中运行 `pnpm exec wrangler login`；如果已登录且有多个账户，请协助确认 Account ID。
4. 运行 `pnpm onboard` 执行 Dry-Run 预检，确认 Zone 探测无误、D1 与 Pages 状态清晰，且无阻断错误。
5. 运行 `pnpm onboard --apply` 执行全自动构建、Schema 迁移、Worker 部署、Email Routing 绑定及 Pages 发布。
6. 运行 `pnpm smoke-test --url https://inbox.<YOUR_DOMAIN.COM>` 进行线上端点验收。
7. 提供从外部邮箱发送真实邮件并进行接口查验的具体 curl 命令。

安全准则：
- 严禁打印任何 OAuth Token 或密钥。
- 严禁删除任何现有 D1 数据库或平台托管的 DNS MX/SPF 记录。
- 绝不回滚工作区现有的其他未提交改动。
```

### 提示词 2.2：构建自动化业务接码客户端

适用于让 Claude Code 基于本项目 API 实现业务对接：

```markdown
你现在是业务对接工程师。
目标：基于 Cloudflare EasyTmp Mail 的官方 API v1 合同，编写一个健壮的自动化接码客户端。

参考规范：
- 请完整阅读 `docs/api.md` 和 `docs/openapi.yaml`。
- 服务 Base URL：https://inbox.cottage.dpdns.org （支持通过参数传入自定义地址）。

实现需求：
1. 语言：TypeScript (Node.js 20+ / ESM)。
2. 功能链路：
   a. 获取 `/api/health` 取得权威服务时间 `serverTime` 作为接码任务的时间下界 `since`。
   b. 调用 `/api/v1/addresses/random` 取得一个干净的随机邮箱地址。
   c. 模拟或等待外部邮件发送。
   d. 以 3 秒间隔轮询 `/api/v1/mailboxes/{name}/messages`，固定 `since`，并按 `id` 进行去重。
   e. 从返回的 `codeCandidates` 数组中高优先级提取验证码（保留前导零字符串）。
   f. 获取详情验证 `dmarcPass === true`。
3. 异常处理：
   - 遵守 HTTP 规范，GET 请求绝对不发送任何请求体。
   - 正确处理 `503` 的 `Retry-After` 退避标头。
   - 严禁在代码中写死硬编码凭据，本系统为公开免密设计。
```

---

## 3. OpenAI Codex 专属提示词

### 提示词 3.1：项目部署、代码门禁与冒烟测试

适用于在 Codex 环境中推进自动化交付与健康验证：

```markdown
你是 Codex，负责 Cloudflare EasyTmp Mail 项目的完整上线与交付验收。

请执行以下连续任务流：
1. 审计当前仓库状态：
   - 阅读 `easytmp.config.json`、`scripts/onboard.js` 与 `docs/AGENT_RUNBOOK.md`。
   - 检查当前环境是否满足 Node.js 20+ 与 pnpm。
2. 运行本地质量门禁：
   - 执行 `pnpm build` 确认所有 workspace 包与 Pages Functions 编译正常。
3. 检查 Cloudflare 授权：
   - 调用 `npx wrangler whoami --json`。若尚未授权，向我说明需要在 Chrome 终端中执行 `pnpm exec wrangler login`。
4. 模拟与部署执行：
   - 先执行 `pnpm onboard` 观察资源发现日志。
   - 确认无误后执行 `pnpm onboard --apply`。
   - 检查回写到 `easytmp.config.json` 的 `accountId`, `zoneId`, `d1DatabaseId` 是否格式合规，确保没有密钥被写入。
5. 交付汇报：
   - 汇报自动化部署日志摘要。
   - 运行冒烟测试并提供第一封真实邮件验证指南。
```

### 提示词 3.2：API 功能扩展与单元测试编写

适用于需要为本项目扩展新接口或业务字段：

```markdown
你是 Codex，负责为 EasyTmp Mail 增加一个 API 功能。
需求：<描述你的新功能，例如：在 GET /api/v1/mailboxes/{name}/messages 增加发件人关键词搜索过滤>。

实现约束：
1. 保持单一事实源与跨端解耦：
   - 先在 `packages/shared/src/types/index.ts` 定义数据结构。
   - 在 `packages/shared/src/validation/` 补充严格的参数校验逻辑。
   - 在 `apps/api/functions/api/[[route]].ts` 实现路由处理，确保使用 `c.get('serverTime')` 和 `c.get('requestId')`。
   - 在 `packages/db/src/repository.ts` 补充 D1 SQL 构建，强制携带 `expires_at > serverTime`。
2. 遵循 HTTP 安全边界：
   - 未声明的 query 必须返回 400 `invalid_query`。
   - 严禁接受 GET 请求体。
3. 补充测试并同步文档：
   - 在 `apps/api/test/` 增加 Vitest 测试用例。
   - 同步更新 `docs/openapi.yaml` 与 `docs/api.md`。
   - 运行 `pnpm test:all` 与 `pnpm check` 确保门禁通过。
```

---

## 4. CPA (Cloudflare Partner Assistant / Gemini 3.8 Flash) 专属提示词

### 提示词 4.1：Cloudflare 无服务器资源检查与上线审计

适用于在 Cloudflare 生态系统集成或审查环境中运行：

```markdown
Role: Cloudflare Architecture and Security Auditor
Model: CPA (gemini-3.8-flash)
Project: Cloudflare EasyTmp Mail (Pages + Functions + Email Worker + D1)

Task:
Perform a comprehensive readiness and security audit on the current Cloudflare temporary email setup before traffic cutover.

Audit Focus:
1. Email Routing Catch-all Rule:
   - Ensure the catch-all matcher is enabled and exclusively routes to Worker `easytmp-mail-inbound` (or configured workerName).
   - Confirm Cloudflare Email Routing platform MX records (`route1/2/3.mx.cloudflare.net`) and SPF record are untouched and active.
2. DMARC Authentication Defense:
   - Verify `apps/inbound-worker/src/dmarc.ts` strictly checks the first `Authentication-Results` header injected by Cloudflare MTA (`mx.cloudflare.net`).
   - Confirm spoofed sender headers or headers in body are rejected.
3. D1 Database & Retention:
   - Check `packages/db/migrations/0001_initial.sql` for the mandatory `CHECK (expires_at = received_at + 604800000)` constraint.
   - Confirm the scheduled Cron Trigger in `wrangler.toml` runs every 10 minutes (`*/10 * * * *`) with bounded batch deletion.
4. Edge Security & Privacy:
   - Confirm no authorization tokens, passwords, or PII are logged or stored.
   - Confirm CSP headers on Pages enforce sandbox iframe protection (`frame-src 'self' about:`).

Output:
Provide a concise Markdown audit report highlighting PASS / WARN / FAIL for each category.
```

### 提示词 4.2：生产收信故障排查与路由诊断

适用于收信异常时的自动化诊断：

```markdown
Role: Cloudflare Troubleshooting Specialist
Project: Cloudflare EasyTmp Mail

Situation:
External emails sent to `<test>@<mailDomain>` are not appearing in the inbox API (`/api/v1/mailboxes/<test>/messages`).

Diagnostic Protocol:
1. Zone & Email Routing Status:
   - Run diagnostic commands via Cloudflare Client to check `GET /zones/{zone_id}/email/routing`. Status must be `ready` and `enabled: true`.
2. Catch-all Configuration:
   - Verify `GET /zones/{zone_id}/email/routing/rules/catch_all` points to the deployed Inbound Worker.
   - Inspect `.wrangler/backups/` for previous route states if a rollback is needed.
3. Inbound Worker Logs:
   - Check Cloudflare Worker tail logs. Did the email hit the worker? Was it rejected by size limits (max 1MB) or failed DMARC?
4. D1 Binding & Queries:
   - Verify Pages Functions has the `DB` D1 binding configured in `wrangler.toml` and Pages settings.
   - Check if the query `since` timestamp in client requests is accidentally set into the future.
```
