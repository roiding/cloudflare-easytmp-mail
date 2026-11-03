# Cloudflare EasyTmp Mail 架构设计

状态：v1 已生产上线。采用 Cloudflare Pages + Pages Functions + Email Worker + D1；当前生产实例为 inbox.cottage.dpdns.org，代码与部署脚本支持通过根配置替换域名。
日期：2026-11-03
当前生产邮件域名：`cottage.dpdns.org`
当前生产网页和 API：`inbox.cottage.dpdns.org`
自建配置入口：根目录 `easytmp.config.json`（`mailDomain` 必填，网页主机名默认 `inbox.<mailDomain>`）

已确认：网页和 API 完全公开，无需登录、密钥或 Token；邮箱地址无需创建或激活；Web UI 和 API 都支持指定邮箱名或随机生成；任何人都可按邮箱名读取未删除、未过期的邮件；每封邮件自接收起保留 7 天，地址本身不过期。

首页流程已确认：打开自动生成随机邮箱，顶部可修改邮箱名、重新随机和复制地址，下方自动刷新邮件，验证码可直接复制。

邮件详情已确认：保留原邮件的基本排版和验证按钮。实现方案为保存清洗后的 HTML 并隔离展示，同时保留纯文本用于 API 读取、验证码提取和展示回退。

页面参考：[Temp Mail 中文站](https://temp-mail.org/zh/)。实际部署采用 Cloudflare Pages + Pages Functions + Email Worker + D1。

部署方式：运行 `pnpm onboard --dry-run` 只读预检，再运行 `pnpm onboard` 完成 OAuth 资源发现、D1 migration、Worker/Pages 部署、Email Routing、自定义域名与冒烟测试。运维与替换域名步骤见 [agent 上线手册](AGENT_RUNBOOK.md)。

API v1 已上线：[接口说明](api.md)与 [OpenAPI 3.1 规范](openapi.yaml)包含完整参数、JSON 字段、时间筛选、分页、删除和错误格式。当前生产实例已通过真实收信、D1、DMARC、7 天保留、HTML 清洗和 Web UI 验收。

## 1. 目标

提供一个公开、免密、低维护成本的临时接码邮箱，支持网页使用和程序化读取：

- Web UI 打开即生成随机邮箱，支持修改邮箱名、重新随机和复制地址，自动刷新邮件并提供验证码快捷复制。
- 邮件详情保留基本排版和验证按钮，用户可点击链接完成验证。
- 通过 HTTP API 按邮箱名读取和轮询邮件，也可获取随机邮箱名，无需预先创建地址。
- 只接收邮件，不发送邮件。
- 网页和 API 全部公开，按邮箱名直接访问，不要求任何访问凭据。
- 不提供用户注册、登录、套餐、组织或多租户账户体系。
- 每封邮件接收 7 天后自动过期，并定期清理 D1 数据；邮箱名可持续使用。
- 与 `proxyscrape-registration-machine` 等业务项目解耦，只暴露稳定 API。

## 2. 非目标

首版明确不做：

- SMTP、IMAP、POP3 服务。
- 出站邮件或自动回复。
- 附件下载、预览、保存或大文件存储（已确认）。
- 用户账户、登录系统和后台角色权限。
- 自动点击邮件链接、自动提交第三方表单或绕过人机验证。
- 邮件长期归档。邮箱名可持续复用，邮件只保留 7 天。

参考项目 `dreamhunter2333/cloudflare_temp_email` 包含独立账户、附件、收发件等完整能力。本项目聚焦公开临时接码和短期收件，减少使用步骤和数据占用。

## 3. 推荐架构

```text
浏览器 ──────► Cloudflare Pages
               ├── /*        静态网页（Vite 构建产物）
API 客户端 ──► └── /api/*    Pages Functions（Hono）
                                  │ 查询 / 删除
                                  ▼
                                 D1
                                  ▲
                                  │ 写入 / 过期清理
外部邮件 ──► Email Routing ──► Email Worker
            <mailDomain>          ├── email()      接收、解析并保存邮件
Cron Trigger ────────────────────►└── scheduled()  清理过期邮件
```

### 3.1 Pages 与 Email Worker 分工

网页不必和收信处理放进同一个 Worker。当前推荐：

- **Cloudflare Pages**：部署 React + Vite 的静态网页，绑定配置的 `webHostname`；当前生产为 `inbox.cottage.dpdns.org`。
- **Pages Functions**：在同一站点的 `/api/*` 提供 HTTP API，使用 Hono 和 D1 Binding。
- **Email Worker**：提供 `email()` 邮件入口和 `scheduled()` 定时清理入口。
- **D1**：Pages Functions 和 Email Worker 绑定同一个生产数据库，共享邮件 schema 与查询规则。

这仍然保持网页与 API 同源，无需另设 API 域名。Pages Functions 处理 HTTP 请求，Email Routing 与 Cron 分别调用独立 Worker 的邮件和定时事件入口。

实现时将静态资源排除在 Pages Functions 调用之外，只为 `/api/*` 配置动态路由；API 错误返回 JSON，不能回退到 SPA 首页。静态页头与 Functions 响应头分别配置，API 自行返回 CORS 和 `Cache-Control: no-store`。

采用两个部署单元，各有构建与部署配置；共享类型、地址规范化和 D1 数据访问代码，预览/测试环境使用独立数据库。单 Worker + Static Assets 仍是可行备选，但不再作为项目限制。

2026-11-03 核对的官方文档：

- [Pages Functions 绑定 D1](https://developers.cloudflare.com/pages/functions/bindings/#d1-databases)
- [Worker 的 email() 入口](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/)
- [Worker Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

### 3.2 域名

- 邮件地址域：配置的 `mailDomain`；当前生产为 `@cottage.dpdns.org`
- 网页和 API：配置的 `https://<webHostname>`；当前生产为 `https://inbox.cottage.dpdns.org`
- Web UI 与 API 同源部署；公开 API 同时允许无凭据跨域调用。

2026-11-03 只读 DNS 查询确认：

- 当前生产域 `cottage.dpdns.org` 使用 Cloudflare Email Routing 的 `route1`、`route2`、`route3.mx.cloudflare.net`；新部署按根配置中的 `mailDomain` 自动核定，不操作无关 Zone。
- MX 只能确认邮件交给 Cloudflare，不能据此识别内部 Email Routing 规则或 Worker 名称。
- 当前生产域 `cottage.dpdns.org` 的旧临时邮箱与新服务迁移已完成；部署时核对精确账户与 Zone，不操作其他域名。
- `pnpm onboard` 在正式修改前检查目标域的 Email Routing、MX、SPF、DKIM、现有 Catch-all 与 Worker 清单，再按配置完成切换。

### 3.3 技术栈

| 层            | 推荐选择                                      | 原因                                           |
| ------------- | --------------------------------------------- | ---------------------------------------------- |
| HTTP API      | TypeScript + Hono on Pages Functions          | `/api/*` 与网页同源，可直接绑定 D1             |
| 数据访问      | D1                                            | 原生 Cloudflare 集成，按地址查询和清理短期邮件 |
| 邮件解析      | `postal-mime`                                 | 支持 MIME 和 multipart                         |
| HTML 文本化   | `htmlparser2`                                 | 提取正文文本，供验证码识别和纯文本读取使用     |
| HTML/CSS 清洗 | 兼容 Workers 的白名单清洗器，具体库待选型验证 | 保留排版和链接按钮，配合沙箱 iframe 展示       |
| Web UI        | React + Vite + TypeScript on Pages            | 静态构建产物由 Pages 托管                      |
| 收信与清理    | TypeScript Email Worker                       | 承接 `email()` 和 Cron 的 `scheduled()`        |
| 参数校验      | Zod                                           | API 校验与前端类型可共享                       |
| API 描述      | OpenAPI 3.1                                   | 业务项目可生成客户端或按合同集成               |
| Worker 测试   | Vitest + Cloudflare plugin                    | 在接近生产的运行时验证 D1 和 Worker            |
| UI E2E        | Playwright                                    | 验证指定/随机邮箱名、收件、复制和删除邮件      |

## 4. 公开访问模型

已确认：整个临时邮箱服务公开、免密使用。不设置账户、登录页、Admin Token、Mailbox Token、统一访问密钥或 Cloudflare Access。

### 4.1 按邮箱名共享收件箱

- 邮箱名用于定位收件地址，不需要注册、创建或激活。
- 任何访客在 Web UI 或 API 使用相同邮箱名时，查看同一组尚未删除、尚未过期的邮件。
- 邮箱没有所有者，也不与浏览器、会话或设备绑定。
- 尚未收到邮件的邮箱名也可直接查询，返回空列表。

### 4.2 网页和 API

- 网页打开即生成随机邮箱，可直接使用，也可输入邮箱名或重新随机，无解锁步骤。
- API 直接调用，不要求 `Authorization` 请求头、API Key 或 Cookie。
- 不建立身份会话，不存储或签发访问凭据。
- API 使用 `Access-Control-Allow-Origin: *`，支持无凭据跨域调用。

### 4.3 删除与自动清理

- API v1 的删除单封邮件和清空指定邮箱采用免密公开操作，与读取使用同一访问模型。
- 删除对所有查看该邮箱名的访客生效；地址本身仍可接收新邮件。
- 7 天过期邮件由 Cron 自动清理，首版无需独立的全局管理清理 API。

## 5. 数据模型

### 5.1 地址即查询标识

首版不需要 `mailboxes` 表，也不保存邮箱创建时间、邮箱有效期或邮箱专属 Token。邮件直接关联规范化的收件地址。

`address` 规范化为小写，域必须是当前部署配置的 `mailDomain`。邮箱名（local part）为 1–64 个 ASCII 字符，允许字母、数字、点、下划线和连字符，首尾必须是字母或数字，不允许连续点；ASCII 大写转小写，不支持 `+` 子地址。Web UI 和 API 使用固定域名补全地址，收信和查询采用相同规则，详见 [API 邮箱名约定](api.md#2-邮箱名与-id)。

随机功能使用密码学随机源生成 16 位小写字母/数字邮箱名，不注册、占用或独占地址。再次使用同一邮箱名会进入同一收件箱。

### 5.2 `messages`

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  envelope_from TEXT,
  from_name TEXT NOT NULL DEFAULT '',
  from_address TEXT,
  from_domain TEXT,
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  text_truncated INTEGER NOT NULL DEFAULT 0 CHECK (text_truncated IN (0, 1)),
  html_body TEXT,
  html_status TEXT NOT NULL CHECK (html_status IN ('available', 'not_present', 'too_large', 'unavailable')),
  code_candidates_json TEXT NOT NULL,
  links_json TEXT NOT NULL,
  dmarc_pass INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
```

时间戳统一使用 Unix 毫秒。`received_at` 为服务接收邮件的时间，不采用发件人可设置的 `Date` 头；`expires_at = received_at + 604800000`，即接收后 7 × 24 小时。查看邮件、重新输入邮箱名或收到新邮件均不延长保留期。手动删除直接移除对应可读邮件记录，已过期邮件交由 Cron 清理。

`from_name`、`from_address`、`from_domain` 在入库时从首个可解析的 From 头邮箱提取，供 API 返回及 `fromDomain` 筛选；无法解析时名称为 `''`，地址和域名为 `NULL`。`envelope_from` 独立保存 SMTP envelope 发件地址，空反向路径为 `NULL`。邮件 ID 使用小写 UUID v4。

首版保存标题、规范化纯文本、清洗后的 HTML、验证码候选和 HTTPS 链接：

- `text_body`：优先取邮件的纯文本部分，没有时由 HTML 提取；用于验证码识别、API 读取和纯文本展示。
- `text_truncated`：标记纯文本是否因长度上限截断；API 返回布尔值 `textTruncated`。
- `html_body`：保存清洗后的 HTML，保留基本排版、允许的文字样式、表格和验证链接按钮；纯文本邮件为 `NULL`。
- HTML 清洗失败或结果超出大小上限时，保留可用的纯文本、验证码候选和链接，`html_body` 为 `NULL`；不直接截断 HTML 后渲染。
- `html_status`：区分 `available`、`not_present`、`too_large`、`unavailable`，与 API 的 `htmlStatus` 对应；只有 `available` 时 `html_body` 为非空字符串，其他情况为 `NULL`。
- HTML 和纯文本属于同一封邮件，共用 7 天过期时间和删除操作。

`code_candidates_json` 存储最多 10 个 `{value, source, context}` 对象，验证码按字符串保留前导零；`links_json` 存储最多 20 个 `{url, text, host}` 对象。排序、去重和字段长度遵循 [API v1](api.md)。列表的 `preview` 由纯文本派生，`hasHtml` 由 HTML 状态派生。

以下内容不入库：

- 原始 MIME。
- 未经清洗的原始 HTML。
- 附件内容。
- 邮件内联图片。

已确认不提供附件下载、预览或保存，无需为附件引入 R2。带附件的邮件在满足整封邮件大小等接收条件时，仍提取并保存正文、验证码和验证链接，附件部分不入库。

### 5.3 索引

- `messages(address, received_at DESC, id DESC)`：按邮箱地址读取最新邮件。
- `messages(expires_at)`：清理过期邮件。

邮件列表和详情都必须过滤 `expires_at <= now` 的记录，不能等待 Cron 实际删除后才隐藏过期邮件。

`since` 使用 `received_at >= since`。游标以 `(received_at, id)` 为排序锚点，严格向更旧的记录翻页，并绑定邮箱名和筛选条件；不建立快照或用户会话。`fromDomain` 使用 `from_domain` 精确匹配，`subject` 是字面子串，不能作为 SQL 通配符插入。清空邮箱只删除 `received_at < before` 的可读邮件，具体并发与重试语义见 API 规范。

## 6. 生命周期

```text
直接选用邮箱名，或随机生成邮箱名
  -> 外部注册表单引用该地址
  -> Email Routing 投递
  -> 校验域名、邮箱名格式、大小和 DMARC，无需检查地址是否创建
  -> 解析 MIME、提取文本/验证码/链接，清洗并保留 HTML 排版
  -> 写入 D1，设置这封邮件的 7 天过期时间
  -> Web UI 或 API 随时按邮箱名读取未删除、未过期的邮件
  -> 单封邮件接收满 7 天后不可读取
  -> Cron 清理过期邮件；地址继续接收新邮件
```

即使某个邮箱名从未在 Web UI 或 API 中使用过，也应能直接收信。首次查看不会创建或激活邮箱。

已确认的保留规则与其他建议配置：

| 配置                        | 默认值  | 范围         | 说明                                        |
| --------------------------- | ------- | ------------ | ------------------------------------------- |
| `MESSAGE_RETENTION_SECONDS` | 604800  | 固定 7 天    | 已确认；从每封邮件的接收时间起算            |
| `MAX_EMAIL_BYTES`           | 1048576 | 1024-2097152 | 单封邮件上限                                |
| `MAX_TEXT_CHARS`            | 32768   | 1024-131072  | 入库纯文本上限                              |
| `MAX_HTML_BYTES`            | 262144  | 1024-524288  | 清洗后 HTML 的 UTF-8 字节上限，具体值为建议 |
| `REQUIRE_DMARC_PASS`        | true    | true/false   | 生产环境不应关闭                            |

邮件过期或被手动删除后：

- 邮件列表不再包含该邮件，单封详情返回 `404 Not Found`。
- 如果该邮箱名下没有可读邮件，列表正常返回空数组。
- 相同邮箱名仍可接收和查询新邮件，不需要重新创建。
- 不存在“邮箱到期”的 `410 Gone` 状态。

当前实现不因单邮箱邮件数量而提前删除记录；邮件仅在 7 天到期、被 API 删除或被定时清理时移除。容量与速率限制由 Cloudflare 部署配置管理。

## 7. 清理策略

Cloudflare D1 没有原生按行 TTL，因此使用 Cron Trigger：

- 每 10 或 15 分钟执行一次。
- 分批删除 `expires_at <= now` 的邮件。
- 每轮限制删除数量，避免一次任务过久。
- 记录清理数量和错误，但不记录地址、标题、验证码或正文。
- 全局过期清理由 Worker 的 `scheduled()` 执行，首版不提供手动全局清理 HTTP 接口。

清理原则：

1. 只清理过期邮件，不存在需要过期或注销的邮箱记录。
2. 清空某邮箱的现有邮件不影响它继续收信。
3. 删除失败不影响后续轮次重试。
4. 逻辑过期必须先于物理删除生效，避免清理延迟暴露数据。

D1 的过期删除不等于 Cloudflare 平台所有备份或内部副本立即消失。若邮件含高度敏感信息，不应使用临时邮箱。

## 8. 邮件接收与安全

### 8.1 接收保障

- 只接受收件域为配置域名的邮件。
- 接受配置域名下合法的收件地址，无需在数据库中预先登记。
- 默认要求 Cloudflare 注入的首个 `Authentication-Results` 为 `dmarc=pass`。
- 同时校验声明大小和实际流式读取大小。
- 限制 MIME 嵌套深度和字段长度。
- Catch-all 将符合域名、格式、大小和邮件认证条件的邮件直接按收件地址存储，包括从未被访问过的邮箱名。
- 容量保护和收信限流策略待确认，不默认提前删除仍在保留期内的邮件。

### 8.2 内容安全

- 保留 HTML 的段落、标题、表格、允许的字体和颜色样式，以及作为链接使用的验证按钮。
- 入库前使用 HTML/CSS 白名单清洗，移除脚本、事件处理属性、表单、嵌套 iframe、对象嵌入、自动跳转及其他可执行内容。
- 保留经过清洗的内联样式和样式块，移除外部样式表、`@import` 和 CSS 中的资源加载引用。
- 邮件 HTML 在独立的沙箱 iframe 中展示，不直接注入应用主页面；不授予脚本执行、同源访问、表单提交或顶层导航权限。
- 验证按钮保留为可点击的 HTTPS 链接，用户点击后在新标签页打开；iframe 使用 `allow-popups allow-popups-to-escape-sandbox`，使目标页面不继承邮件框架的沙箱限制。链接设置 `target="_blank"` 和 `rel="noopener noreferrer"`，隔离新页面与来源页面。页面不会自动打开链接或提交表单。
- HTML 按钮和单独提取的链接使用相同 URL 校验规则：仅允许 `https:`，拒绝包含用户名或密码的 URL。
- 限制链接数量、纯文本长度和清洗后 HTML 大小。
- 验证码只是候选值，页面和 API 都应明确这一点。
- 链接操作可查看完整目标域名；远程图片默认不自动加载，不托管附件或内联图片。
- CSP 与 iframe 载入方式配套验证，允许已清洗的排版样式并阻止可执行内容和外部资源加载。
- 标题、发件人、验证码和纯文本正文使用文本节点展示；没有可用 HTML 时，详情回退为纯文本。

### 8.3 API 安全

- 所有业务 API 均免密，不验证用户身份或邮箱归属。
- 日志不记录邮件正文、验证码或完整链接。
- CORS 允许任意来源，声明 `GET, DELETE, OPTIONS`，处理预检请求，不启用 `Access-Control-Allow-Credentials`。
- 响应使用 `Cache-Control: no-store`。
- 校验邮箱名、邮件 ID、查询参数和请求大小；所有 D1 查询使用参数绑定。
- 请求频率和容量上限属于后续运行配置，不引入登录或密钥流程。

## 9. API v1 合同

规范版本：1.0.0；业务基础路径：`/api/v1`。所有接口公开免密，无需鉴权请求头或会话。

完整合同见 [API 接口文档](api.md)和 [OpenAPI 3.1](openapi.yaml)。本节保留接口概览，具体字段、边界和错误格式以这两份同步维护的文件为准。生产实例已经上线并通过真实邮件验收。

| 方法   | 路径                                | 用途 / 成功返回                                                   |
| ------ | ----------------------------------- | ----------------------------------------------------------------- |
| GET    | `/api/health`                       | HTTP API 存活检查和 `serverTime`，不测试 D1 或收信链路            |
| GET    | `/api/v1/addresses/random`          | `{name, address, serverTime}`，不写入数据库                       |
| GET    | `/api/v1/mailboxes/{name}/messages` | `{name, address, messages, pagination, serverTime}`               |
| GET    | `/api/v1/messages/{id}`             | `{message, serverTime}`，含纯文本和可用的 HTML                    |
| DELETE | `/api/v1/messages/{id}`             | `{id, deleted, serverTime}`，重复删除 `deleted: false`            |
| DELETE | `/api/v1/mailboxes/{name}/messages` | `{name, address, before, deletedCount, serverTime}`，地址继续收信 |

成功响应均为 `200` JSON；浏览器的 `OPTIONS` 预检返回 `204`。列表支持 `since`、`fromDomain`、`subject`、`dmarcPass`、`limit` 和 `cursor`，清空只接受可选 `before`，其他接口不接受查询参数。所有 GET/DELETE 接口无请求体。

### 9.1 列表、筛选和详情

- `since` 是包含边界的 Unix 毫秒下界：`receivedAt >= since`。
- 列表按 `receivedAt DESC, id DESC` 排序，默认每页 20 条，最大 100 条。
- `pagination.nextCursor` 为非空时可继续读取旧邮件，为 `null` 时当前没有下一页；不返回总数。
- 无匹配邮件时返回 `200`、`messages: []` 和 `nextCursor: null`，邮箱名无需预先创建。
- 列表只返回摘要和验证码候选。详情增加 `textBody`、`htmlBody`、`textTruncated`、`htmlStatus`、链接和原始大小等字段。
- 验证码候选为 `{value, source, context}`，`value` 为字符串；链接为 `{url, text, host}`。
- HTML 不可用时 `htmlBody: null`、`hasHtml: false`；HTML 和纯文本共用过期检查。

### 9.2 等待、删除与错误

- 客户端建议每 3 秒轮询，固定发起任务前的 `since`，每轮从不带 cursor 的第一页开始，按邮件 ID 去重；需要时向后翻页。不要持续推进 since，以免遗漏延迟入库的邮件。
- 单封删除成功或资源已不存在均返回 `200`，通过 `deleted` 区分；GET 同一资源不存在时仍返回 `404`。
- 清空使用排他上界 `receivedAt < before`，`before` 默认当前请求的 `serverTime`，不能显式设为未来时间；`deletedCount` 只计本次实际删除的可读邮件。
- 错误格式为 `{error, message, details, requestId, serverTime}`，`requestId` 同时通过 `X-Request-Id` 返回。
- 定义 `400` 输入错误、`404` 不存在、`405` 方法不支持、`413` 请求体过大、`429` 限流、`500` 内部错误和 `503` 临时不可用；`429/503` 包含整数秒的 `Retry-After`。
- 不存在 `401/403` 鉴权错误、`409` 地址冲突或 `410` 邮箱过期错误。

## 10. Web UI

### 10.1 已确认的首页流程

采用常见临时邮箱的单页结构，顶部为邮箱地址和操作区，下方为收件箱。

1. **打开即用**：进入首页时自动生成随机邮箱名，展示完整地址并开始等待收信。
2. **顶部地址区**：支持修改邮箱名并查看对应收件箱、重新随机生成邮箱名、一键复制完整地址。
3. **下方收件箱**：自动刷新当前地址的邮件，按时间倒序显示尚未删除、尚未过期的邮件；暂无邮件时显示等待收信的空状态。
4. **验证码快捷复制**：识别到验证码候选时，在邮件列表中突出展示并提供复制按钮；可打开邮件核对正文。

### 10.2 邮件详情

- **已确认的展示方式**：详情保留原邮件的基本排版、颜色、表格和验证按钮，默认显示清洗后的 HTML；没有可用 HTML 时显示纯文本。
- **邮件信息**：发件人、标题、正文、验证码候选、链接候选和该邮件的到期时间；列表中的验证码快捷复制继续保留。
- **验证按钮**：用户可直接点击，符合链接校验规则的目标在新标签页打开。
- **删除操作**：按 API v1 删除单封邮件或清空当前收件箱，均无需登录或密钥。

### 10.3 交互规则

- 页面隐藏时停止自动轮询。
- 新邮件到达后刷新列表。
- 自动刷新只更新邮件，不更换当前邮箱名。
- 修改邮箱名或重新随机只切换当前查看的收件箱，不删除原地址的邮件。
- 不提供最近使用的邮箱列表，不在浏览器中维护邮箱使用历史；查看之前用过的邮箱时直接输入邮箱名。
- 显示“邮件保留 7 天”，到期时间属于单封邮件，邮箱地址没有有效期倒计时。
- 同一邮箱名可随时重新输入查看；查看操作不续期，清空邮件不注销地址。
- 邮件 HTML 使用沙箱 iframe 隔离显示，标题、发件人和验证码等字段按纯文本显示。
- 错误区分“暂无可读邮件”“该邮件已不可用”“请求过于频繁”和“服务异常”。

### 10.4 页面参考与视觉方向

用户指定参考 [Temp Mail 中文站](https://temp-mail.org/zh/)，已于 2026-11-03 查看页面。采用其“顶部地址区—操作栏—收件箱”的层次：

- 深色顶部区域，居中突出完整邮件地址，复制按钮使用醒目的绿色。
- 地址区下方设置横向操作栏，提供复制、刷新、修改邮箱名、重新随机和清空邮件等操作；窄屏下换行排列。
- 下方使用浅色背景与居中的收件箱卡片，显示发件人、主题、时间和查看入口；验证码候选提供快捷复制。
- 无邮件时显示清晰的空状态和“等待来信”，页面标注邮件保留 7 天。
- 使用项目自己的名称、图标和文案，功能范围遵循已确认的临时接码需求。

参考站的删除动作在本项目中明确为“清空邮件”，不会注销或使邮箱地址失效。修改邮箱名与重新随机仅切换当前查看的地址。

## 11. 与注册自动化项目的接口

业务项目不直接访问 D1，也不依赖 Worker 内部实现。推荐集成流程：

```text
1. 自行指定邮箱名，或 GET /api/v1/addresses/random 获取随机邮箱名
2. 使用该地址填写外部注册表单，无需预先激活或创建
3. 遇到 Turnstile 时暂停，人工完成后继续
4. 轮询 GET /api/v1/mailboxes/{name}/messages?since=任务开始时间
5. 使用 fromDomain、subject、dmarcPass 等筛选条件，按邮件 ID 去重
6. 返回验证码/链接给流程，不自动打开陌生链接
7. 如需提前清理，删除本次任务处理的邮件；同名地址仍可继续使用
```

注册项目配置：

```env
EASY_TMP_MAIL_BASE_URL=https://<webHostname>
# 当前生产示例：https://inbox.cottage.dpdns.org
```

客户端只需配置服务地址，不需要任何访问凭据。业务项目负责：

- 客户端超时和取消。
- 并发任务尽量选用不同的随机邮箱名，避免共享同一收件箱。
- 在触发外部发信前保存随机地址接口或 `/api/health` 返回的 `serverTime`，作为整个任务固定的 `since`，避免复用邮箱名时读取旧验证码。
- 每轮从第一页查询，按 ID 去重；翻页时沿用相同筛选条件并传回 `nextCursor`。
- 应用 `503` 按其 `Retry-After` 退避；上游 `429` 若带同名响应头也遵循，网络错误和 `500` 采用有上限的退避。
- 邮件发送方和 DMARC 校验。
- 验证码选择的人工确认或业务侧规则。
- 按需提前删除本次任务的邮件，避免误清空同名邮箱中其他任务的邮件；其余邮件按 7 天规则过期。

## 12. 部署与迁移

推荐的零参数上线流程为 `pnpm onboard --dry-run` 后运行 `pnpm onboard`。根配置示例：

```text
Cloudflare account
├── Pages: <pages.projectName>
│   ├── Static UI
│   ├── Pages Functions: /api/*
│   ├── D1 Binding: DB
│   └── Custom Domain: <webHostname>
├── Worker: <worker.name>
│   ├── email()
│   ├── scheduled()
│   └── D1 Binding: DB
├── D1: <d1.databaseName>
└── Email Routing: <mailDomain>
    └── Catch-all -> Worker: <worker.name>
```

当前生产实例为 `inbox.cottage.dpdns.org` / `cottage.dpdns.org`。具体命令、OAuth 权限、幂等规则、备份和真实邮件验收见 [agent 上线手册](AGENT_RUNBOOK.md)。

资源名可由 `easytmp.config.json` 显式指定，也可由域名自动派生。`onboard` 在正式修改前先展示发现结果与拟变更；已有同名资源默认复用。

### 12.1 部署顺序

1. 在根配置中填写 `mailDomain`，可选指定网页主机名、资源名和已有资源 ID。
2. 由 OAuth 会话发现或校验 Account、Zone、D1、Pages 与 Worker；已有目标资源复用，缺失资源创建。
3. 执行 remote D1 migration，部署绑定同一 D1 的 Email Worker 和 Pages Functions，再发布静态网页。
4. 核对 Email Routing，保留平台 MX/SPF/DKIM，将 Catch-all 指向新 Worker，并绑定 `webHostname` 到 Pages。
5. 使用 `pnpm onboard --dry-run` 审查流量切换提案；正式执行 `pnpm onboard`。
6. 从外部邮箱真实投递，验证网页与 API 免密读取、DMARC、HTML、提取结果与精确 7 天保留。
7. 真实收信通过后，才按清单清理不再引用的旧 Worker；共享 D1、KV、R2 与 Email Routing 平台记录保留。

生产实例的旧服务替换已完成。新部署不预设旧 Worker 名，以 onboarding 的只读清单和显式清理步骤为准。

### 12.2 配置项

| 名称                        | 类型       | 使用位置 / 说明                                             |
| --------------------------- | ---------- | ----------------------------------------------------------- |
| `MAIL_DOMAIN`               | Var        | Pages Functions 与 Email Worker；来自根配置的 `mailDomain` |
| `MESSAGE_RETENTION_SECONDS` | 共享常量   | 固定 604800 秒（7 天），不能按邮箱覆盖                      |
| `MAX_EMAIL_BYTES`           | Var        | Email Worker；单封邮件大小上限                              |
| `MAX_TEXT_CHARS`            | Var        | Email Worker；纯文本正文长度上限                            |
| `MAX_HTML_BYTES`            | Var        | Email Worker；清洗后 HTML 的 UTF-8 字节上限                 |
| `REQUIRE_DMARC_PASS`        | Var        | Email Worker；生产默认 `true`；不应放宽为信任任意认证头       |
| `DB`                        | D1 Binding | Pages Functions 与 Email Worker 绑定同一个生产数据库        |

静态构建目录在 Pages 项目配置，不再使用 Worker 的 `ASSETS` Binding；Cron 只配置在 Email Worker。

## 13. 测试策略

自动测试覆盖：

- D1 migration 正确应用。
- Pages Functions 与 Email Worker 使用相同 schema，能够读取 Worker 接收入库的邮件。
- Pages 静态资源与 `/api/*` 路由正确分流，未知 API 路径不返回 SPA 页面。
- 无鉴权请求头、Cookie 或会话时，可以生成随机邮箱名、查看和删除邮件。
- 不同浏览器或 API 客户端使用同一邮箱名时，读取相同邮件。
- 公开 API 支持跨域读取、删除和 OPTIONS 预检。
- 从未在 UI/API 使用过的合法邮箱名也能直接收信。
- 非配置域名、非法邮箱名及不满足收信校验的邮件不能入库。
- 输入相同邮箱名可重复查询同一收件箱，无邮件时返回空列表。
- 随机生成邮箱名不创建数据库记录，也不签发邮箱专属 Token。
- 实际 API 响应符合 OpenAPI v1 的必填字段、类型、空值和错误约定。
- `since` 含下界、`before` 不含上界，毫秒单位和接收 7 天过期边界正确。
- 同毫秒多封邮件稳定分页、筛选条件与游标绑定、锚点删除后续页可读。
- 固定 since 的轮询可读到延迟入库的邮件，重复出现的 ID 可去重。
- 单封重复删除返回 `deleted: false`，清空返回正确 `before` 和 `deletedCount`。
- MIME plain、HTML、multipart 解析。
- 带附件但满足接收条件的邮件仍可读取正文和提取验证码；附件不保存，API 不返回附件内容，网页不提供附件操作。
- HTML 正文保留基本排版、表格、样式和验证按钮，纯文本邮件可正常显示。
- 详情 API 返回纯文本和可用的清洗后 HTML；列表轮询不传输完整 HTML。
- HTML 清洗移除脚本、事件属性、表单、嵌套框架、自动跳转和外部 CSS 资源引用。
- 沙箱和 CSP 不妨碍基本排版，且禁止邮件内容访问主页面、执行脚本或自动请求外部资源。
- 验证按钮仅在用户点击后打开新标签页，目标页面不会继承邮件框架的沙箱限制。
- 验证码候选和 HTTPS 链接提取。
- `javascript:`、HTTP、带凭据链接被过滤。
- 声明大小和实际大小超限都被拦截。
- DMARC 头只信任 Cloudflare 的结果。
- 纯文本长度和 HTML 字节大小限制，HTML 超限或清洗失败时回退为纯文本。
- 每封邮件独立计算接收后 7 天的到期时间，列表和详情在到期边界立即不可读。
- 查看邮箱、收到新邮件均不延长旧邮件的保留期。
- 删除单封邮件或清空收件箱后，同名地址仍可收信和查询。
- Cron 清理分批执行且可重试。
- UI 进入首页自动生成随机邮箱、手动切换邮箱名、重新随机、收信、复制和删除邮件的 Playwright 流程。
- 自动刷新不改变当前邮箱名，切换邮箱名不删除原收件箱的邮件。

手工验证：

- 从第三方邮箱真实投递到临时地址。
- 向从未打开过的邮箱名投递，再直接按该邮箱名查看。
- 检查 Email Routing 规则没有覆盖 catch-all。
- 部署时核对旧 MX、路由和对应 Worker 的清理结果，新路由指向实际部署的新 Worker。
- 检查 Pages 自定义域名、API 的 D1 Binding 和 Email Worker 的 Cron 配置。
- 检查应用域名和 API 的 HTTPS、CSP、Cache-Control。
- 使用真实 HTML 验证邮件检查排版和按钮，确认点击后目标验证页面能正常打开。
- 检查网页打开即可使用，API 调用无需凭据。
- 检查日志中没有邮件正文或验证码。
- 检查邮件接收 7 天后的逻辑不可读和 Cron 物理清理。

## 14. 里程碑

### Phase 0：架构确认

- 已确认：邮箱名直接使用，无需创建；Web UI 和 API 支持指定或随机邮箱名。
- 已确认：每封邮件接收后保留 7 天，地址本身不过期。
- 已确认：网页和 API 完全公开，无登录、密钥、Token 或邮箱归属验证。
- 已确认：首页自动生成随机邮箱，顶部可修改邮箱名和复制地址，下方自动刷新邮件并提供验证码快捷复制。
- 已确认：邮件详情保留基本排版和验证按钮，同时保留纯文本用于读取和提取验证码。
- 当前生产：邮件域名为 `cottage.dpdns.org`，网页和 API 共用 `inbox.cottage.dpdns.org`；自建部署通过根配置替换。
- 已确认：不提供附件下载、预览或保存，带附件邮件仍按接收条件处理正文。
- 页面参考 Temp Mail 中文站；实际采用 Pages/Functions + Email Worker。
- 生产迁移已完成：新 Catch-all 接管后清理旧 Worker，平台 MX/SPF/DKIM 保留。
- API v1 合同已定义：毫秒时间筛选、游标分页、完整字段、删除结果和错误格式；客户端轮询建议每 3 秒。

### Phase 1：迁移与 API 核心

- 从注册项目迁出已有 Worker 原型，拆分 HTTP API 与邮件接收入口，共享数据模型和地址规则。
- 建立 Pages Functions、Email Worker 和 D1 的配置。
- 完成 schema、API、邮件接收和自动测试。

### Phase 2：Web UI

- 完成打开即生成随机邮箱的首页，包括顶部地址操作区、自动刷新的邮件列表和验证码快捷复制。
- 按 Temp Mail 参考方向完成深色地址区、绿色强调和浅色收件箱，并验证移动端布局。
- 完成保留排版和验证按钮的邮件详情，以及删除操作。
- 加入轮询、邮件到期提示、复制、HTML 隔离展示和纯文本回退。
- 完成 Playwright E2E。

### Phase 3：清理与部署

- 完成 Cron 自动清理和运行指标。
- 按第 12 节核对和备份旧资源，仅清理已确认不再使用的旧 Worker；共享 Email Routing 平台记录保留。
- 部署 Pages、Functions、Email Worker，按根配置域名完成 Email Routing 与网页绑定。
- 做真实邮件 smoke test。

### Phase 4：注册项目接入

- 基于已定义的 OpenAPI v1 接入客户端，并验证实际服务与合同一致。
- 在注册项目实现邮箱名选择或随机生成、轮询、错误处理和邮件清理。
- 保留 Turnstile 人工接管节点。

## 15. 已确认与待确认的决策

### 已确认：邮箱名直接使用

不提供创建或激活邮箱的前置步骤。Web UI 和 API 都支持指定邮箱名或随机生成；按同一邮箱名可随时查看其尚未删除、尚未过期的邮件。邮箱名从未被访问过也可接收邮件。

### 已确认：邮件保留 7 天

每封邮件按服务接收时间独立保留 7 × 24 小时，到期立即不可读，由 Cron 分批清理。地址本身没有有效期，查看邮箱不续期，删除邮件不影响未来收信。

### 已确认：完全公开、无需密钥

这是公开的临时接码邮箱。网页和 API 无需注册、登录、密钥或 Token，任何人均可按邮箱名查看邮件；同名邮箱没有用户或会话隔离。API v1 的删除操作同样免密，过期邮件由 Cron 自动清理。

### 已确认：常见临时邮箱的首页流程

打开首页自动生成随机邮箱；顶部可修改邮箱名、重新随机和复制完整地址；下方自动刷新收件箱，识别到验证码时直接提供复制按钮。不提供最近使用的邮箱列表，需要回看时手动输入邮箱名。视觉参考 Temp Mail 中文站。

### 已确认：保留邮件排版和验证按钮

邮件详情保留原邮件的基本排版和验证按钮，用户可点击链接完成验证。实现采用清洗后的 HTML 配合沙箱 iframe 展示，并保存纯文本供 API、验证码识别和展示回退使用。两种正文共用 7 天保留期。

### 已确认：域名安排

当前生产邮件地址使用 `任意邮箱名@cottage.dpdns.org`；网页使用 `https://inbox.cottage.dpdns.org`，API 使用同一域名下的 `/api/v1`。其他部署只需替换根配置中的域名。

### 已确认：不支持附件

项目聚焦临时收信和接码，不提供附件下载、预览或保存。正文继续保留纯文本和清洗后的 HTML，验证按钮可点击。附件的存在本身不作为拒收理由，整封邮件仍遵守接收大小等限制。远程图片默认不自动加载。

### 已确认：页面参考与部署约束

参考 [Temp Mail 中文站](https://temp-mail.org/zh/) 的页面结构和使用方式。用户提出可使用 Cloudflare Pages，架构不限定单 Worker；当前推荐 Pages 托管网页，Pages Functions 提供同源 API，Email Worker 负责收信和定时清理，两者共用 D1。

### 已记录：旧临时邮箱迁移

生产迁移已完成：新服务沿用 `cottage.dpdns.org` 收信，网页和 API 使用 `inbox.cottage.dpdns.org`。Email Routing 平台 MX/SPF/DKIM 保留，旧 Worker 已单独清理；其他自建环境由 `pnpm onboard` 处理，不应对无关 Zone 操作。

### 已定义：API v1 与客户端轮询

完整合同见 [api.md](api.md) 和 [openapi.yaml](openapi.yaml)。采用毫秒时间戳，支持包含下界的 `since`、发件域/标题/DMARC 筛选和游标分页。生产 UI 每 3 秒轮询并固定任务开始时间，页面隐藏时暂停；具体限流阈值属于部署配置。

### 决策 1：技术栈

推荐 Hono + React + Vite + TypeScript，部署在 Pages/Functions 与 Email Worker；HTML/CSS 清洗器需验证 Workers 运行时兼容性和排版保留效果。

### 决策 2：容量与收信限流

直接接收任意合法邮箱名后，需要讨论容量和收信速率限制。不能沿用超出数量上限即删除最旧邮件的规则，而不说明它对 7 天保留期的影响。

## 16. 当前状态

- 生产实例已上线：网页与 API 为 `https://inbox.cottage.dpdns.org`，收件域为 `cottage.dpdns.org`。
- Pages 项目、Pages Functions、Email Worker、D1 与 Email Routing Catch-all 已部署，使用同一个生产 D1。
- 真实邮件已验证入库、`dmarcPass=true`、验证码和链接提取、HTML 清洗、精确 7 天到期与 Web UI 详情展示。
- 旧 `email-code-worker` 已清理；平台 MX、SPF、DKIM 和新 D1 均保留。
- 自动化测试、类型检查、Lint、格式检查和生产构建均通过。
- 自建环境和域名替换见 [agent 上线手册](AGENT_RUNBOOK.md)；程序化接入见 [API 文档](api.md) 与 [OpenAPI](openapi.yaml)。
