# EasyTmp Mail agent 上线与运维手册

本文件面向其他编码 agent、运维 agent 和接入方。目标是让执行者在没有本项目历史上下文时，仍能完成以下两件事：

1. 只修改根目录 `easytmp.config.json` 中的域名，使用一个 Cloudflare OAuth 登录完成上线。
2. 按 [API v1 合同](api.md) 和 [OpenAPI 3.1](openapi.yaml) 对接公开临时邮箱，不读取 D1、不依赖页面内部实现。

所有命令均从仓库根目录执行。不要凭记忆改 DNS、D1、Pages 或 Worker；以配置和脚本的实际输出为准。

## 1. 上线前结论

标准成功路径为：

```sh
pnpm install --frozen-lockfile
npx wrangler login
pnpm onboard --dry-run
pnpm onboard
```

`pnpm onboard --dry-run` 只做配置校验、OAuth 发现、资源清单、构建、测试和拟变更预览，不应修改 Cloudflare。

`pnpm onboard` 无参数执行正式上线：发现账户与 Zone，创建或复用 D1、Pages 项目和 Worker，执行 D1 migration，部署 Worker、Pages Functions 和静态网页，绑定自定义域名，配置 Email Routing Catch-all，并运行 HTTP 冒烟测试。

现有分阶段入口 `pnpm deploy:orchestrate --stage=switch --apply` 继续兼容，但它不是新用户的首选。新环境优先使用 `pnpm onboard`，避免执行者手工拼接环境变量。

真正需要执行者提供的业务信息只有域名。Cloudflare OAuth 是当前机器上的授权状态；D1 UUID、Pages 项目名和 Worker 名可以由 `onboard` 创建或派生，也可以从配置中显式固定。

## 2. 唯一根配置

根目录 [easytmp.config.json](../easytmp.config.json) 是域名和资源命名的唯一来源。

最小配置：

```json
{
  "mailDomain": "example.com"
}
```

默认派生结果：

| 项目 | 派生值 |
| --- | --- |
| 收件域名 | `example.com` |
| 网页及同源 API | `inbox.example.com` |
| Pages 项目 | `easytmp-example`（取域名主标签并加 `easytmp-` 前缀） |
| Email Worker | `easytmp-example-worker` |
| D1 数据库 | `easytmp-example` |

完整可选配置如下。以下字段使用配置模块的扁平结构；未填写时可自动派生的字段不需要手写。

```json
{
  "mailDomain": "example.com",
  "webHostname": "inbox.example.com",
  "accountId": "可选；留空则从 OAuth 可访问账户中自动发现",
  "zoneId": "可选；留空则按 mailDomain 自动发现",
  "projectName": "可选；Pages 项目名",
  "workerName": "可选；Email Worker 名称",
  "d1DatabaseName": "可选；D1 名称",
  "d1DatabaseId": "可选；已有 D1 UUID；留空则创建或按名称发现"
}
```

约束：

- `mailDomain` 必填，必须是 Cloudflare 账户下已存在且处于 active 状态的 Zone；不要在脚本里创建或切换 NS。
- `webHostname` 可省略，默认 `inbox.<mailDomain>`，并且必须是 `mailDomain` 的子域。
- 资源名只能使用 1–63 位小写字母、数字和连字符，首尾必须为字母或数字。
- 若要部署到已有域名上的临时邮箱，确认该域允许 Catch-all 指向 Worker，并了解替换 Catch-all 会影响现有收件规则。
- 该服务完全公开，同名邮箱共享邮件，任何人都能读取或删除。不得把项目域名用于高价值账户、密码重置、财务或含敏感个人信息的业务。

修改域名后运行一次：

```sh
pnpm onboard --dry-run
```

输出中的收件域名、网页域名、账户、Zone、D1、Pages、Worker 和 Catch-all 提案必须与目标一致。只要有一个不一致，就停止正式执行。

## 3. OAuth 登录与权限

浏览器交互使用本机已有的 Chrome 登录态：

```sh
npx wrangler login
npx wrangler whoami
```

只允许用户在 Chrome 中完成 Cloudflare 授权。不要改用内置浏览器代替用户的登录态，不要把 OAuth token、refresh token 或 API token 写入仓库、命令输出、日志或文档。

上线所需的 Wrangler OAuth scopes 至少包括：

- `workers` / `workers_scripts` 写权限：部署收件 Worker 和 Cron Trigger。
- `d1` 写权限：创建或查询 D1 并执行 migration。
- `pages` 写权限：创建 Pages 项目、部署 Functions 与静态资源、绑定域名。
- `email_routing` 写权限：配置 Catch-all 并读取 Email Routing 状态。
- `dns_records:read` / `dns_records:edit`：核对 Email Routing 所需 DNS；仅在脚本明确要求时修改 DNS。
- `zone:read`、`account:read`：发现并校验目标 Zone 与账号。

`npx wrangler whoami` 必须显示目标账户，且以上相关权限已经出现。Wrangler 提示“缺少其他产品 scope”时，并不自动表示本项目失败；以 onboarding 实际调用及错误为准。遇到需要新增权限或重新授权时，让用户在 Chrome 完成 OAuth，不要要求用户发 Token。

`wrangler auth token` 仅供程序在进程内使用，禁止展示或落盘。正常 onboarding 应直接复用 Wrangler 的 OAuth 会话。

## 4. 正式执行顺序

### 4.1 只读预检

```sh
pnpm install --frozen-lockfile
pnpm onboard --dry-run
```

预检必须至少确认：

- 配置文件可解析，`mailDomain` 是合法域名。
- OAuth 已登录，`accountId` / `zoneId` 可发现并指向预期资源。
- `mailDomain` 的 Zone 处于可使用状态，网页主机名属于该 Zone。
- D1 已存在时其 UUID 与名称匹配；不存在时给出创建提案。
- Pages 项目与 Worker 名称已存在时复用，不存在时给出创建提案。
- 仓库类型检查、测试、构建和 Function/Worker dry-run 通过。
- Catch-all 当前规则会被备份，目标 Worker 为本次配置的 Worker。
- 拟绑定的网页域名没有错误地指向另一个 Pages 项目。

预检失败时不要绕过检查，也不要手工强推某个资源；先修正配置或 OAuth 权限。

### 4.2 正式上线

只有预检目标与业务目标一致，才运行：

```sh
pnpm onboard
```

脚本应按下面的幂等顺序执行；重复运行应复用已有资源，并只改必要配置：

1. 读取 `easytmp.config.json`，发现或校验 Account、Zone、D1、Pages、Worker。
2. 缺失时创建 D1、Pages 项目或所需资源；已有 D1 不重建，已有 Worker 采用新版本覆盖。
3. 执行 remote D1 migrations，保留 `messages` 表、索引和 7 天 CHECK 约束。
4. 构建 shared、db、web、Pages Functions 与 Email Worker；Functions 必须随 Pages 部署。
5. 为 Worker 和 Pages Functions 绑定同一个 D1 UUID；注入 `MAIL_DOMAIN=<mailDomain>`，收件默认保留 `REQUIRE_DMARC_PASS=true`。
6. 部署收件 Worker，保留每 10 分钟运行的过期清理 Cron。
7. 发布 Pages 静态网页与同源 `/api/*` Functions。
8. 启用/核对 Email Routing，保留 Cloudflare 平台 MX、SPF 和 DKIM，将 Catch-all 指向本次 Worker。
9. 绑定 `webHostname` 到 Pages，等待 HTTPS/DNS 生效。
10. 对网页、安全响应头、`/api/health`、随机邮箱和空邮箱查询做 smoke test。

正式脚本应在修改 Email Routing 或自定义域名前将脱敏配置写入 `.wrangler/backups/`。备份中不得包含 OAuth 或 API token。

### 4.3 真实邮件验收

HTTP 冒烟测试不能证明收信链路。正式上线后必须做一次真实投递：

```sh
mailbox=onboard-check-$(date +%s)
printf 'Mailbox: %s@%s\n' "$mailbox" "<mailDomain>" 
```

从外部邮箱向该地址发送一封包含以下内容的邮件：

```text
Subject: EasyTmp 上线验收

验证码：439271
链接：https://example.com/easytmp-test
```

用脚本输出的 `webHostname` 替换下面的 `BASE_URL`，轮询：

```sh
export BASE_URL='https://inbox.example.com'
export MAILBOX='onboard-check-...'  # 上一步生成的名称

curl -fsS "$BASE_URL/api/health"
curl -fsS "$BASE_URL/api/v1/mailboxes/$MAILBOX/messages?limit=20"
```

验收条件：

- 邮件在数秒内出现，标题、发件人和正文正确。
- `dmarcPass=true`。
- `codeCandidates` 识别出验证码，且前导零不会被吞掉。
- `receivedAt + 604800000 === expiresAt`。
- 详情页的 `htmlBody` 不含 `<script`、事件处理器或 `javascript:` 链接。
- 相同邮箱名可在正式网页输入并查看未删除、未过期邮件。

详情请求：

```sh
curl -fsS "$BASE_URL/api/v1/messages/<messageId>"
```

邮件被 SMTP 拒绝时，读取退信中的 Cloudflare MTA 原因。若提示 DMARC 失败，先检查 Worker 是否接受 Cloudflare 官方 `Authentication-Results: mx.cloudflare.net`，不要关闭 DMARC 或改成信任任意发件头。QQ 等发件域还要自行满足其发信域的 DKIM/DMARC；这不是临时邮箱服务器可以替发件域修复的问题。

### 4.4 兼容的显式切换方式

已有环境或需要按阶段执行时可使用旧入口：

```sh
pnpm deploy:orchestrate --stage=preflight
pnpm deploy:orchestrate --stage=switch --dry-run
pnpm deploy:orchestrate --stage=switch --apply
```

该入口仍从根配置读取域名和资源名。使用前确认它支持自动发现或创建的资源；如果它要求预先提供 D1 UUID、Account ID 或 Zone ID，按脚本提示补齐，仍不要在文档或 PR 中暴露 token。

## 5. 上线后检查

最小只读核对：

```sh
curl -fsS "$BASE_URL/api/health"
curl -fsS "$BASE_URL/api/v1/addresses/random"
curl -fsS "$BASE_URL/api/v1/mailboxes/smoke-test/messages?limit=20"

dig +short MX "<mailDomain>"
dig +short TXT "<mailDomain>"
```

还应在 Cloudflare 侧确认：

- Catch-all 启用，目标为配置中的 Worker。
- Email Routing 状态为 ready/enabled。
- Worker 存在 `email` 和 `scheduled` 两个 handler。
- Pages 项目 `webHostname` 状态为 active，HTTPS 有效。
- Pages 与 Worker 绑定同一 D1 UUID。
- MX 指向 Cloudflare route 主机，SPF 和 DKIM 未被误删。
- Cron 为 `*/10 * * * *`。
- `/` 有 CSP、`nosniff` 和 Referrer-Policy；API 响应有 `Cache-Control: no-store` 和公开 CORS 头。

如需要清理旧 Worker，必须先确认新 Catch-all 已接管且真实邮件验收通过。只删除明确核对的旧 Worker，保留共享 D1、KV、R2、平台 MX、SPF 和 DKIM。不要把“删除旧 MX”当作普通升级步骤；当前架构在新旧服务之间共享 Cloudflare Email Routing 平台 MX。

## 6. API 对接快速卡

当前生产示例：

```text
BASE_URL=https://inbox.cottage.dpdns.org
MAIL_DOMAIN=cottage.dpdns.org
```

自建环境：

```text
BASE_URL=https://<webHostname>
MAIL_DOMAIN=<mailDomain>
```

所有业务请求公开、无 Cookie、无 Authorization、无 API Key。`Access-Control-Allow-Origin: *`，但不启用凭据。

端点：

| 方法 | 端点 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | API 存活与 `serverTime` |
| GET | `/api/v1/addresses/random` | 生成不预留、不过期的随机地址 |
| GET | `/api/v1/mailboxes/{name}/messages` | 按邮箱名查询、筛选、分页 |
| DELETE | `/api/v1/mailboxes/{name}/messages?before=<ms>` | 清空该时间前的可读邮件 |
| GET | `/api/v1/messages/{id}` | 邮件详情、正文和链接 |
| DELETE | `/api/v1/messages/{id}` | 幂等删除单封邮件 |

列表查询参数：

| 参数 | 规则 |
| --- | --- |
| `since` | Unix 毫秒；`receivedAt >= since`；任务期间保持固定 |
| `fromDomain` | From 头域名的精确匹配，ASCII 大小写不敏感 |
| `subject` | 1–200 码点的字面子串；不支持通配符 |
| `dmarcPass` | 严格 `true` 或 `false` |
| `limit` | 1–100，默认 20 |
| `cursor` | 原样传回 `nextCursor`，绑定邮箱和筛选条件 |

`{name}` 是 local part，不是完整邮箱地址。允许 1–64 位 ASCII 字母、数字、`.`、`_`、`-`，首尾必须是字母或数字，不允许连续点或 `+`；输入会转小写。路径参数使用 `encodeURIComponent`。

标准接码流程：

```ts
const base = new URL('https://inbox.example.com');
const health = await fetch(new URL('/api/health', base)).then((r) => r.json());
const random = await fetch(new URL('/api/v1/addresses/random', base)).then((r) => r.json());

// 将 random.address 交给发信表单。任务期间的 since 固定为 random.serverTime。
const query = new URLSearchParams({
  since: String(random.serverTime),
  fromDomain: 'example.com',
  dmarcPass: 'true',
  limit: '20',
});

const listUrl = new URL(`/api/v1/mailboxes/${encodeURIComponent(random.name)}/messages`, base);
listUrl.search = query.toString();
const page = await fetch(listUrl).then((r) => r.json());
```

每轮从不带 `cursor` 的第一页重新查询，保留固定 `since` 和相同筛选条件，以邮件 `id` 去重。不要把 `since` 推进到最新 `serverTime`。如果要读取更多页，只把返回的 `nextCursor` 原样传回；新邮件不会补充到已翻过的页。

没有匹配邮件时返回 `200` 和空 `messages`。`GET /api/v1/messages/{id}` 对不存在、已删除或已过期邮件返回 `404 message_not_found`；`DELETE` 对同样情况仍返回 `200` 和 `deleted: false`。应用自身的 `503` 带 `Retry-After`；Cloudflare 前置层产生的 `429` 若带该头也应按其退避。网络错误和 `500` 使用有上限的重试。所有时间都是毫秒，不自动把秒转成毫秒。

完整字段、示例、错误格式和最小 TypeScript 客户端见 [api.md](api.md)。机器可读合同见 [openapi.yaml](openapi.yaml)。

## 7. 排障

### `easytmp.config.json` 缺失或校验失败

脚本必须停止。只在根目录修复配置；不要通过 shell 环境变量覆盖域名来绕开校验。域名变更后重新运行 `pnpm onboard --dry-run`。

### OAuth 提示无凭据或过期

让用户在 Chrome 中执行 `npx wrangler login`，随后运行 `npx wrangler whoami`。不要复制 token 到聊天、日志或仓库。

### D1 已存在同名但无法确认

停止并核对 account、Zone 和数据库名称、UUID。已有数据库应优先复用；除非明确确认是丢弃数据，否则不要删除或重建。

### Pages 域名 pending

确认 `webHostname` 是 `mailDomain` 的子域，并且 Page 自定义域名与所需 CNAME 已由 Cloudflare 自动处理。轮询 HTTPS 端点，而不是只看控制台状态。

### Email Routing 非 ready 或 Catch-all 未指向 Worker

保留平台 MX/SPF/DKIM，先检查 Worker 是否存在，再读取 Email Routing 与 Catch-all 现状。脚本必须更新 Catch-all 到本次 Worker；回退时恢复备份中的原规则，不要擅自改变其他 Zone。

### 合法发件人被拒

检查认证头是否为 Cloudflare 注入的 `mx.cloudflare.net`，且它是第一个 `Authentication-Results`。不要接受任意域名、后续伪造头或正文中的伪头。若 Cloudflare 改变官方 authserv-id，应更新严格白名单和测试后再上线。

### 邮件未显示

依次检查：目标域名是否为配置的 `mailDomain`；邮箱名是否符合规则；Email Routing 是否 ready；Worker 是否有 `email` handler 和 D1 binding；D1 是否有记录；查询的 `since` 是否保留为任务开始时间。真实投递测试与 HTTP API 测试是两项独立验收。

### 页面能打开但 API 失败

检查 Pages Functions 是否随静态站一起部署、`/api/*` 是否绑定 D1，以及网页和 API 是否同源。未知 `/api/*` 应返回 JSON `route_not_found`，不能回退到 SPA 的 HTML。

## 8. 安全与失败边界

- 临时邮箱完全公开，同名地址无所有权隔离。使用随机名称降低碰撞，但不能把它当作访问控制。
- 删除接口同样公开；任何知道邮箱名和邮件 ID 的调用者都可以删除邮件。
- 不自动打开或执行邮件中的链接、脚本、表单和远程图片。`htmlBody` 虽然清洗过，客户端仍应放进隔离沙箱展示。
- 不向日志打印正文、验证码、完整邮件链接、OAuth token、API token、Cookie 或 Authorization。
- 生产保留期固定为 7 天。修改文案不应声称邮箱地址会过期；实际上只有邮件过期，邮箱名可以继续接收新邮件。
- 容量与速率限制可能由部署配置或 Cloudflare 前置层决定；客户端必须处理 `429`、`503`、超时和部分失败。
- 上线后如果真实收信验收失败，保留旧 Catch-all 备份，先修复或恢复；不要删除旧 Worker、D1 或其他仍在使用的资源。
