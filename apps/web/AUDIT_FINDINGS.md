# Web UI 前端审计与合同防御记录 (Web UI Audit Findings & Defensive Measures)

日期：2026-11-03
服务模块：`@easytmp/web` (React + Vite SPA)

在将前端实现与共享层（`@easytmp/shared`）及接口合同（`docs/api.md`、`docs/openapi.yaml`）进行对接时，记录以下边界处理、共享层分析与前端安全防御措施。

---

## 1. 邮箱名输入兼顾纯名称与完整地址 (`packages/shared/src/validation/mailbox.ts`)

### 问题分析

`packages/shared` 中的 `validateMailboxName` 严格针对 local-part 邮箱名（`1–64` 位 ASCII 字符，通过正则 `MAILBOX_NAME_INPUT_REGEX` 校验）。若用户在 Web 页面输入或粘贴完整邮箱地址（如 `user@cottage.dpdns.org`），该函数会将其判定为非法字符而直接拒绝。

而在 Web UI 使用场景中，用户习惯直接粘贴接收到的完整邮件地址。

### 前端补强措施 (`apps/web/src/utils/mailbox.ts`)

前端实现了统一规范化函数 `normalizeMailboxInput`：

1. 允许用户输入纯邮箱名（如 `mybox`）或完整地址（如 `mybox@cottage.dpdns.org`）；
2. 若包含 `@`，严格验证其域名必须为 `@cottage.dpdns.org`（对大小写不敏感），非本站域名直接在前端阻断并提示明确中文错误；
3. 提取 local-part 后继续复用共享层 `validateMailboxName` 进行严格校验（首尾字符、连字符/下划线/点、不可连续点等规则）；
4. 校验不通过时不发起任何网络请求，提供直观的字段级错误提示。

---

## 2. HTML 邮件安全沙箱与零外发请求隔离 (`SandboxIframe`)

### 安全边界设计

虽然共享层 `packages/shared/src/sanitizer/html.ts` 已经基于 `parse5` AST 对邮件正文进行了严格的白名单清洗（移除 `<script>`、`<iframe>`、`<base>`、`<form>`，过滤 `on*` 事件，只允许白名单内联样式与安全的 HTTPS 链接），但在浏览器端直接内联或宽松渲染仍存在潜在风险：

- 伪造链接或注入样式可能试图加载外部追踪像素（Tracking Pixel）；
- 点击链接可能会操纵顶层窗口上下文。

### 前端防护措施 (`apps/web/src/components/SandboxIframe.tsx`)

1. **严格沙箱权限**：
   iframe 仅声明 `sandbox="allow-popups allow-popups-to-escape-sandbox"`。
   - **绝对不给予** `allow-scripts`（禁止执行任何 JavaScript）；
   - **绝对不给予** `allow-same-origin`（沙箱处于独立唯一源，无法访问主域 Storage/Cookie/DOM）；
   - **绝对不给予** `allow-forms`（禁止表单提交）；
   - **绝对不给予** `allow-top-navigation`（禁止劫持顶层页面跳转）。
2. **内嵌 CSP 策略**：
   在 `srcDoc` 文档头部注入严格 Content Security Policy：
   `default-src 'none'; style-src 'unsafe-inline'; font-src 'none'; img-src data:; base-uri 'none'; form-action 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none';`
   页面渲染时绝不触发外部邮件图片或 URL 请求，彻底杜绝外发流量与隐私泄露。
3. **安全新标签页跳转**：
   通过 `<base target="_blank">` 与 `rel="noopener noreferrer"` 确保用户点击验证链接时在新标签页安全打开。

---

## 3. 接码任务固定 `since` 轮询与防漂移状态机 (`useMailbox`)

### 合同与业务考量

接码业务对时间下界非常敏感：

- 邮件由于网络与投递排队可能稍有延迟入库；
- 若轮询时将 `since` 随每轮推进到上一轮完成时刻，延迟入库的验证码邮件将被彻底漏掉；
- 共享收件箱中可能存在之前的旧验证码，若不带 `since` 则容易误将旧码识别为当前任务。

### 前端实现要点 (`apps/web/src/hooks/useMailbox.ts`)

1. **固定任务起始时间**：初始化随机地址时以服务端返回的 `serverTime` 作为基线 `taskSince`。在后续每 3 秒的自动轮询中，固定保持该 `taskSince`，不随每轮轮询递增。
2. **合并去重**：每轮第一页拉取返回后，前端按邮件小写 UUID `id` 建立 Map 严格去重，按 `receivedAt DESC, id DESC` 稳定排序，既保证晚到达的邮件能被及时发现，又避免列表闪烁或重复项。
3. **基线手动重置**：当用户点击“刷新”或手动“切换邮箱”时，主动将 `taskSince` 重置为最新时间戳；同时提供“查看全部未过期邮件”切换选项，兼顾查阅历史与即时接码两种需求。
4. **后台挂起与恢复即刷**：监听 `document.visibilitychange`，页面隐藏时暂停定时器避免浪费资源；恢复可见时立即触发静默刷新。

---

## 4. API 响应安全解析与网关错误容错 (`apps/web/src/api/client.ts`)

### 问题分析

当 Cloudflare Pages Functions 或 D1 发生临时不可用、平台限流或 502/504 错误时，网关返回的内容可能是 HTML 格式的错误页，而非应用的 JSON 格式。若前端直接执行 `await response.json()`，会抛出无意义的 `SyntaxError: Unexpected token < in JSON at position 0`。

### 前端防御措施

1. 前置读取 `Content-Type`，仅在声明为 `application/json` 时执行 JSON 解析；
2. 非 JSON 响应（如网关 HTML）静默安全消费，抛出规范的 `ApiError`，输出友好的中文提示（如“服务暂时发生异常，请稍后重试”），绝不将原始 HTML 暴露给用户；
3. 解析响应头中的 `Retry-After`，在 429（限流）和 503（服务不可用）时展示具体的“请等待 X 秒后再试”提示；
4. 运行阶段对 API 响应体关键字段进行最小化结构校验，防止由于未知响应字段导致前端渲染白屏。
