# API 实现审计与防护记录 (API Audit Findings & Defensive Measures)

日期：2026-11-03
服务模块：`@easytmp/api` (Cloudflare Pages Functions)

在审查公共层（`@easytmp/shared`、`@easytmp/db`）与接口合同（`docs/api.md`、`docs/openapi.yaml`）时，发现以下边界问题与公共层局限性。按照只修改 `apps/api/**` 的规范要求，我们在 API 路由层实施了完整的安全防护与语义补全，确保对外 HTTP API 100% 忠实履行合同。

---

## 1. 查询参数与路径百分号编码校验 (Percent-Encoding Validation)

### 问题定位

`packages/shared/src/validation/query.ts` 中的 `parseAndValidateSearchParams` 直接依赖 Web 标准的 `URLSearchParams`。WHATWG 标准对非法的百分号编码（例如 `%ZZ`、截断的 `%2`、不合法的 UTF-8 字节序 `%E0%A4%A`）表现为宽松解析（保留字面量 `%ZZ`），不会抛出异常。同时，Hono 的路由参数解析在遇到解码失败时也会静默回退到原始字符串。

### 合同要求

`docs/api.md` 第 1 节和第 2 节明确规定：

- “未声明的查询参数、重复参数、空参数和非法编码返回 400。”
- “路径按 UTF-8 百分号编码解码一次后校验，非法编码返回 400。”

### 路由层防护措施

在 `apps/api` 的请求解析层：

1. 对原始查询字符串（Raw Query String）按参数分割并逐一执行 `decodeURIComponent` 校验。一旦检测到任何非法十六进制字符或无效 UTF-8 字节序，立即返回 `400 invalid_query`。
2. 对路径中的 `{name}` 原始段进行 `decodeURIComponent` 解码验证。若解码抛出 `URIError`，立即返回 `400 invalid_mailbox_name`，不继续进入下游查询。

---

## 2. 游标错误类型分类 (Cursor Error Classification)

### 问题定位

`packages/shared/src/validation/query.ts` 将所有参数格式校验错误（包括 cursor 的格式错误）统一汇总进 `details` 数组。若上层路由统一把校验失败当作 `invalid_query`，则游标结构损坏或超长时会错误返回 `invalid_query`。

### 合同要求

`docs/api.md` 第 9 节错误码表明确规定：

- `invalid_query`: “未知、重复、空或非法查询参数，编码错误，或 before 在未来”
- `invalid_cursor`: “游标内部结构非法或邮箱/筛选上下文不匹配，从第一页重查；空/重复参数仍归 invalid_query”

### 路由层防护措施

在 `apps/api` 路由处理中采用两阶段精细判断：

1. **第一阶段**：检查参数结构。若 `cursor` 参数为空字符串（`?cursor=`）或重复出现（`?cursor=a&cursor=b`），严格归入 `400 invalid_query`。
2. **第二阶段**：检查非空游标的有效性。若 `cursor` 包含非 base64url 字符、长度超过 1024、Base64/JSON 反序列化失败、缺少必要字段、版本不兼容，或解密出的 `name` 及 `since/fromDomain/subject/dmarcPass` 筛选条件与当前请求上下文不匹配，统一精确返回 `400 invalid_cursor`。

---

## 3. 请求体大小流式检测与防绕过 (Request Body Streaming & Anti-Bypass)

### 问题定位

攻击者或客户端可能发送 Chunked Transfer-Encoding（不提供 `Content-Length`），或伪造 `Content-Length: 0` 但在 HTTP 流中持续传输数据；或者传递 `Content-Length: 10` 但实际发送超过 8192 字节。若仅依赖 `Content-Length` 头判断，存在绕过风险；若使用 `request.text()` 一次性缓冲整个请求体，可能遭受内存耗尽 DoS 攻击。

### 合同要求

- “所有 GET/DELETE 请求均无请求体。非空请求体返回 400 unexpected_body；请求体超过 8192 字节返回 413 request_too_large。”
- “用实际流大小，不盲信 Content-Length；不允许 body 读取绕过。”

### 路由层防护措施

在 `apps/api` 中实现高效的流式请求体检测器 `checkEmptyBody`：

1. 若 `Content-Length` 存在且解析为大于 8192 的有效正整数，快速失败返回 `413 request_too_large`。
2. 若 `request.body` 存在，通过 `ReadableStreamDefaultReader` 逐块读取流并累计字节长度。
3. 一旦累计字节超过 8192 字节，立即调用 `reader.cancel()` 中断流读取，返回 `413 request_too_large`，不缓冲超大请求体。
4. 若流读取完毕且总字节数在 `1..8192` 之间，返回 `400 unexpected_body`（`field: "body"`）。
5. 仅当总字节严格为 0 时放行请求。

---

## 4. 路由不支持方法 (405 Method Not Allowed) 与未知路由 (404 Route Not Found)

### 问题定位

Hono 默认的路由分发机制在遇到请求方法与路由不匹配时（例如对仅注册了 GET 的路径发送 POST），会直接穿透到 `app.notFound()`，导致返回 `404 route_not_found`，丢失了 HTTP 405 语义及 `Allow` 响应头。

### 合同要求

- “未知 API 路径返回 404 route_not_found，响应为 JSON，不回退到网页。”
- “方法不支持时返回 405 和该路径的 Allow 响应头。”
- `/api/health` 与 `/api/v1/addresses/random` 支持 `GET, OPTIONS`。
- `/api/v1/mailboxes/{name}/messages` 与 `/api/v1/messages/{id}` 支持 `GET, DELETE, OPTIONS`。

### 路由层防护措施

在 `apps/api` 中为所有有效业务路径显式声明了全方法兜底捕获（`.all(...)`），针对不支持的 HTTP 方法返回 `405 method_not_allowed` 并附带规范的 `Allow` 响应头；未注册的 API 路径则由 `app.notFound()` 统一返回 `404 route_not_found` 的标准 JSON 格式。

---

## 5. D1 数据库绑定可用性保障 (D1 Missing Binding Defense)

### 问题定位

在 Cloudflare Pages 某些预览环境或配置异常时，`c.env.DB` 可能为 `undefined`。此时调用 `new MessageRepository(c.env.DB)` 会产生未捕获异常。

### 合同要求

“没有 D1 binding 时合理返回 503。” 应用生成的 503 必须携带 `Retry-After` 头。

### 路由层防护措施

在所有涉及数据库查询与删除的路由前置检查 `c.env?.DB`。若未绑定，立即返回 `503 service_unavailable` 并携带 `Retry-After: 3` 响应头及合同标准头。
