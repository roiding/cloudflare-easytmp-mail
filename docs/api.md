# Cloudflare EasyTmp Mail API v1

规范版本：1.0.0
定义日期：2026-11-03
状态：v1 已上线并通过真实收信、D1、DMARC、7 天保留、HTML 清洗与 Web UI 端到端验收。

[openapi.yaml](openapi.yaml) 是接口字段、类型、约束和示例的机器可读规范，可导入支持 OpenAPI 3.1 的工具。本页说明调用流程及边界语义；两者应同步维护。

## 1. 地址与通用规则

当前生产示例：`https://inbox.cottage.dpdns.org`；自建部署时替换为配置中的 `webHostname`。业务 API 前缀为 `/api/v1`，`/api/health` 是独立存活检查端点。

- 所有接口公开免密，无需注册、创建邮箱、API Key、Cookie 或 `Authorization`。
- 请求和响应字段使用 `camelCase`。JSON 为 UTF-8；时间统一使用 **Unix 毫秒整数**。
- 规范列出的响应字段均会返回，不以省略字段表达空值。字符串无内容时为 `""`、集合为空时为 `[]`，明确可空的字段使用 `null`。
- 邮件从服务接收时起保留 `604800000` 毫秒（7 天），不使用邮件的 `Date` 头计时；查看不会续期。
- 每次请求开始固定一个 `serverTime`，该请求只读取或主动删除 `expiresAt > serverTime` 的邮件。到期边界为 `expiresAt <= serverTime`。
- 所有 GET/DELETE 请求均无请求体。非空请求体返回 `400 unexpected_body`；请求体超过 8192 字节返回 `413 request_too_large`。邮件通过 Email Routing 接收，不通过 HTTP 上传。
- 未声明的查询参数、重复参数、空参数和非法编码返回 `400`。参数名区分大小写；可选参数不用时省略，不发送 `since=` 或 `cursor=null`。
- 数值参数只接受 `0` 或无前导零的十进制正整数，不接受小数、负号、指数或空格，且不超过 `9007199254740991`。不自动把秒转换为毫秒。
- v1 可增加响应字段，客户端应忽略未知字段；既有字段类型和语义的破坏性修改使用新主版本路径。

所有应用生成的响应，包括错误响应，包含：

```http
Cache-Control: no-store
Access-Control-Allow-Origin: *
Access-Control-Expose-Headers: Retry-After, X-Request-Id
X-Request-Id: <服务生成的 UUID v4>
X-Content-Type-Options: nosniff
```

有 JSON 响应体时使用 `Content-Type: application/json; charset=utf-8`。错误体的 `requestId` 与响应头一致。

`OPTIONS /api/*` 返回 `204`，无响应体，并返回 `Access-Control-Allow-Methods: GET, DELETE, OPTIONS` 与 `Access-Control-Allow-Headers: Content-Type`。不启用 `Access-Control-Allow-Credentials`。支持的方法按具体路径区分；方法不支持时返回 `405` 和该路径的 `Allow` 响应头。`HEAD` 未列为业务方法，若收到该请求，按 HTTP 语义不发送响应体。

以上是应用自身的响应约定；请求尚未到达应用时由 Cloudflare 等上游生成的错误，可能不是此 JSON 格式。

## 2. 邮箱名与 ID

`{name}` 只填写 `@` 前面的邮箱名。规范化规则如下：

| 项目   | 规则                                                           |
| ------ | -------------------------------------------------------------- |
| 长度   | 1–64 个 ASCII 字符                                             |
| 字符   | 字母、数字、点 `.`、下划线 `_`、连字符 `-`                     |
| 首尾   | 必须为字母或数字                                               |
| 点     | 不允许连续两个点                                               |
| 大小写 | ASCII 大写转小写，`Signup` 和 `signup` 指向同一邮箱            |
| 不支持 | 完整邮箱地址、`+` 子地址、空格、Unicode 邮箱名，不自动裁剪空格 |
| 地址   | 规范化名称加当前部署的 `mailDomain`；当前生产示例为 `@cottage.dpdns.org` |

输入校验正则：

```regex
^(?!.*\.\.)[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?(?![\s\S])
```

`a`、`signup`、`test_01`、`test.name-2` 合法；`.test`、`test-`、`test..name`、`test+tag` 不合法。API 与收信入口采用同一规范化规则。随机接口生成 16 位小写字母/数字名称，不检查是否被其他人使用，也不预留地址。自建到更长的 `mailDomain` 时，外部发信系统还必须满足其自身的完整邮箱地址长度限制。

`{id}` 是服务生成的小写 UUID v4，例如 `8c746a0e-7f90-4b13-a71c-9db724e57c02`。客户端应原样使用，不从 ID 推断时间。格式错误返回 `400 invalid_message_id`。

## 3. 接口一览

| 方法   | 路径                                | 查询参数                                                         | 成功响应                    |
| ------ | ----------------------------------- | ---------------------------------------------------------------- | --------------------------- |
| GET    | `/api/health`                       | 无                                                               | `200 HealthResponse`        |
| GET    | `/api/v1/addresses/random`          | 无                                                               | `200 RandomAddressResponse` |
| GET    | `/api/v1/mailboxes/{name}/messages` | `since`、`fromDomain`、`subject`、`dmarcPass`、`limit`、`cursor` | `200 MessageListResponse`   |
| GET    | `/api/v1/messages/{id}`             | 无                                                               | `200 MessageResponse`       |
| DELETE | `/api/v1/messages/{id}`             | 无                                                               | `200 DeleteMessageResponse` |
| DELETE | `/api/v1/mailboxes/{name}/messages` | `before`                                                         | `200 ClearMailboxResponse`  |

不存在创建邮箱、邮箱过期、用户鉴权、附件下载或全局管理清理接口。下面的请求地址与数据均为合同示例；当前生产实例已经上线并通过真实邮件验收。

## 4. 服务时间与随机地址

### GET /api/health

只确认 HTTP API 存活，不查询 D1，也不表示真实收信链路正常。`serverTime` 可用于建立接码任务的时间下界。

```json
{
  "status": "ok",
  "service": "easytmp-mail",
  "apiVersion": "1",
  "serverTime": 1793671200000
}
```

### GET /api/v1/addresses/random

```json
{
  "name": "p7x4m9q2v6k8n3r5",
  "address": "p7x4m9q2v6k8n3r5@cottage.dpdns.org",
  "serverTime": 1793671200000
}
```

`name` 与 `address` 不代表创建记录，也没有邮箱 Token、创建时间或地址有效期。可在发起外部验证流程前保存本次 `serverTime`，后续作为 `since` 使用。

## 5. 查询邮件列表

### GET /api/v1/mailboxes/{name}/messages

| 参数         | 类型 / 默认值                | 精确语义                                                                                   |
| ------------ | ---------------------------- | ------------------------------------------------------------------------------------------ |
| `since`      | 非负毫秒整数 / 省略          | `receivedAt >= since`，包含下界；省略时查询全部未过期邮件；未来值合法，当前可返回空列表    |
| `fromDomain` | 域名字符串 / 省略            | 精确匹配解析后的 From 头邮箱域名，ASCII 大小写不敏感，不自动匹配子域名                     |
| `subject`    | 1–200 个 Unicode 码点 / 省略 | 标题的字面子串；对 ASCII 大小写忽略，Unicode 按字面比较，不做归一化，不解释正则和 `%`、`_` 通配符 |
| `dmarcPass`  | `true` 或 `false` / 省略     | 精确匹配邮件记录的认证标记；省略时不筛选                                                   |
| `limit`      | 1–100 整数 / `20`            | 每页最多返回多少条，超范围返回 `400`                                                       |
| `cursor`     | 上一页返回的游标 / 省略      | 读取更旧的一页；首次请求和每轮接码轮询均省略                                               |

所有筛选条件以 **AND** 组合。`fromDomain` 不接受前导 `@`、URL、尾点或通配符；国际化域名使用 ASCII/Punycode，长度不超过 253，标签长度不超过 63。`example.com` 不匹配 `mail.example.com`。没有可解析 From 邮箱的邮件不匹配域名筛选。

`dmarcPass: false` 仅表示没有记录为 pass，可能是 fail、none 或缺失。生产默认只保存通过 Cloudflare DMARC 校验的邮件，因此 `dmarcPass=false` 通常为空；接收策略与查询格式是两个独立规则。

示例：只读取本次接码开始后、指定发件域且标题含“验证码”的邮件。

```sh
curl --get 'https://inbox.cottage.dpdns.org/api/v1/mailboxes/signup/messages' \
  --data-urlencode 'since=1793671200000' \
  --data-urlencode 'fromDomain=example.com' \
  --data-urlencode 'subject=验证码' \
  --data-urlencode 'dmarcPass=true' \
  --data-urlencode 'limit=20'
```

完整响应：

```json
{
  "name": "signup",
  "address": "signup@cottage.dpdns.org",
  "messages": [
    {
      "id": "8c746a0e-7f90-4b13-a71c-9db724e57c02",
      "address": "signup@cottage.dpdns.org",
      "from": {
        "name": "Example",
        "address": "no-reply@example.com",
        "domain": "example.com"
      },
      "subject": "你的验证码：012345",
      "preview": "你的验证码是 012345，5 分钟内有效。也可以点击“验证邮箱”完成验证。",
      "receivedAt": 1793671205000,
      "expiresAt": 1794276005000,
      "dmarcPass": true,
      "codeCandidates": [
        {
          "value": "012345",
          "source": "subject",
          "context": "你的验证码：012345"
        }
      ],
      "hasHtml": true
    }
  ],
  "pagination": {
    "limit": 20,
    "nextCursor": null
  },
  "serverTime": 1793671210000
}
```

没有匹配邮件、邮箱名从未使用或邮件已全部删除/过期时，均返回：

```json
{
  "name": "signup",
  "address": "signup@cottage.dpdns.org",
  "messages": [],
  "pagination": {
    "limit": 20,
    "nextCursor": null
  },
  "serverTime": 1793671200000
}
```

### 摘要对象 MessageSummary

| 字段             | 类型    | 含义                                               |
| ---------------- | ------- | -------------------------------------------------- |
| `id`             | string  | 小写 UUID v4                                       |
| `address`        | string  | 规范化的收件地址，与本次邮箱查询相同               |
| `from`           | object  | From 头首个可解析邮箱，详见下表                    |
| `subject`        | string  | 解码后的标题，最多 998 个码点，缺失时为 `""`       |
| `preview`        | string  | 纯文本正文合并空白后的前 200 个码点，缺失时为 `""` |
| `receivedAt`     | integer | 服务接收时间，Unix 毫秒                            |
| `expiresAt`      | integer | `receivedAt + 604800000`                           |
| `dmarcPass`      | boolean | 可信的 Cloudflare 认证结果是否为 pass              |
| `codeCandidates` | array   | 最多 10 个去重的候选；没有时为 `[]`                |
| `hasHtml`        | boolean | 详情是否有可用的 HTML 正文                         |

`from` 始终包含三个字段：

| 字段      | 类型           | 含义                                                                  |
| --------- | -------------- | --------------------------------------------------------------------- |
| `name`    | string         | MIME 解码后的显示名，最多 256 个码点；无显示名或无可解析邮箱时为 `""` |
| `address` | string 或 null | 首个可解析的 From 邮箱地址，最长 254；无可解析邮箱时为 `null`         |
| `domain`  | string 或 null | 对应的小写 ASCII/Punycode 域名；无可解析邮箱时为 `null`               |

### 验证码候选 CodeCandidate

| 字段      | 类型   | 含义                                                          |
| --------- | ------ | ------------------------------------------------------------- |
| `value`   | string | 4–12 位 ASCII 字母/数字，保留大小写和前导零，例如 `"012345"`  |
| `source`  | string | `subject` 或 `textBody`；HTML 回退提取的文本也属于 `textBody` |
| `context` | string | 附近的纯文本上下文，最多 160 个码点                           |

候选先按标题中的出现顺序，再按正文中的出现顺序排列；相同 `value` 按大小写敏感比较去重，保留首次出现，最多 10 个。识别属于启发式提取，不保证准确，也不承诺识别所有验证码格式。API 不替客户端选定唯一验证码，不返回可误解为确定结果的 `code` 字段。

## 6. 分页与轮询规则

固定排序为 `receivedAt DESC, id DESC`；同毫秒的邮件按小写 UUID 文本降序排列，保证稳定的排序键。

`pagination.limit` 是本次上限，实际数量用 `messages.length` 判断。服务查询 `limit + 1` 条：有更多记录时返回非空 `nextCursor`，否则为 `null`。不提供 `total` 或页码。

下一页请求保留 `name` 和原有筛选参数，并追加上次的 `nextCursor`。`limit` 可以改变。游标是 1–1024 字符的 base64url 字符串，客户端原样回传；它不是密钥，也不提供任何权限。

实现语义：游标携带最后一条邮件的 `(receivedAt, id)` 以及规范化邮箱名和筛选条件的上下文。下一页必须严格读取更小的排序键，邮箱或筛选不匹配返回 `400 invalid_cursor`。游标的实际内部编码由服务实现，不能由客户端生成或修改。

分页不创建历史快照。每页重新排除已删除/过期邮件，锚点邮件被删后仍按其排序键继续。并发新邮件不会自动回填到已翻过的页面；需要最新邮件时，重新请求不带 `cursor` 的第一页。

接码轮询按下面的规则进行：

1. **触发外部发信前**，记录一次任务开始时间。随机地址可使用返回的 `serverTime`；自定义邮箱名可先调用 `/api/health` 获取服务时间。
2. 每 3 秒从第一页查询，固定使用这个 `since` 和发件域/标题等筛选条件。
3. 批量处理时按邮件 `id` 去重，按照 `nextCursor` 读取当前剩余页；每个轮询周期重新从第一页开始。
4. 列表出现邮件后，可从 `codeCandidates` 查看候选，或调用详情获取正文、按钮和链接。
5. 列表到详情之间邮件被其他访客删除或到期时，详情可能返回 `404`；跳过该邮件并继续等待。
6. `429`、`503` 遵守 `Retry-After`；网络错误和 `500` 采用有上限的退避，整个等待过程建议最多 120 秒，支持取消。

`since` 是包含边界的，因此重复看到同一个 ID 是正常现象。**不要把 `since` 每轮推进到刚收到的 `serverTime` 或最新邮件时间**：邮件接收和解析入库之间可能有延迟。固定任务时间并去重，才能在下一轮看见晚入库的匹配邮件。随机邮箱名有助于减少同名任务混用，但邮箱仍然公开共享。

最小对接流程示例：

```javascript
const baseUrl = 'https://inbox.cottage.dpdns.org';
const response = await fetch(`${baseUrl}/api/v1/addresses/random`);
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const mailbox = await response.json();

// 此时把 mailbox.address 交给需要发送验证码的外部流程。
// 后续每轮都保留相同的 mailbox.serverTime，不更新 since。
const query = new URLSearchParams({
  since: String(mailbox.serverTime),
  fromDomain: 'example.com',
  subject: '验证码',
  dmarcPass: 'true',
  limit: '20',
});
const listUrl = `${baseUrl}/api/v1/mailboxes/${encodeURIComponent(mailbox.name)}/messages?${query}`;
```

这是构造请求的示例；轮询、取消、超时和重试应按上述规则由调用方实现，不应把示例当作已经实现的 SDK。

## 7. 邮件详情

### GET /api/v1/messages/{id}

成功返回 `{ "message": MessageDetail, "serverTime": integer }`。`MessageDetail` 包含全部 `MessageSummary` 字段，并增加：

| 字段            | 类型           | 含义                                                                                    |
| --------------- | -------------- | --------------------------------------------------------------------------------------- |
| `envelopeFrom`  | string 或 null | SMTP envelope 发件地址，最长 254；空反向路径或无法表示时为 `null`                       |
| `textBody`      | string         | 规范化纯文本，最大 131072 码点；部署默认上限 32768，无内容为 `""`                       |
| `htmlBody`      | string 或 null | 清洗后的 HTML；默认最多 262144 UTF-8 字节，可配置但不超过 524288；无可用 HTML 为 `null` |
| `textTruncated` | boolean        | 纯文本是否因正文长度上限被截断                                                          |
| `htmlStatus`    | string         | `available`、`not_present`、`too_large`、`unavailable`，详见下文                        |
| `links`         | array          | 最多 20 个去重的 HTTPS 链接，没有时为 `[]`                                              |
| `sizeBytes`     | integer        | 实际接收的整封原始邮件大小，包括未保存的附件；当前最大合同范围为 2097152 字节           |

完整 HTML 邮件示例：

```json
{
  "message": {
    "id": "8c746a0e-7f90-4b13-a71c-9db724e57c02",
    "address": "signup@cottage.dpdns.org",
    "from": {
      "name": "Example",
      "address": "no-reply@example.com",
      "domain": "example.com"
    },
    "subject": "你的验证码：012345",
    "preview": "你的验证码是 012345，5 分钟内有效。也可以点击“验证邮箱”完成验证。",
    "receivedAt": 1793671205000,
    "expiresAt": 1794276005000,
    "dmarcPass": true,
    "codeCandidates": [
      {
        "value": "012345",
        "source": "subject",
        "context": "你的验证码：012345"
      }
    ],
    "hasHtml": true,
    "envelopeFrom": "bounce@example.com",
    "textBody": "你的验证码是 012345，5 分钟内有效。也可以点击“验证邮箱”完成验证。",
    "htmlBody": "<p>你的验证码是 <strong>012345</strong>，5 分钟内有效。</p><a href=\"https://example.com/verify?t=demo\" style=\"display:inline-block;padding:12px 20px;background-color:#00a884;color:#ffffff\" target=\"_blank\" rel=\"noopener noreferrer\">验证邮箱</a>",
    "textTruncated": false,
    "htmlStatus": "available",
    "links": [
      {
        "url": "https://example.com/verify?t=demo",
        "text": "验证邮箱",
        "host": "example.com"
      }
    ],
    "sizeBytes": 2048
  },
  "serverTime": 1793671210000
}
```

`htmlStatus` 与其他字段必须一致：

| htmlStatus    | hasHtml | htmlBody   | 含义                         |
| ------------- | ------- | ---------- | ---------------------------- |
| `available`   | `true`  | 非空字符串 | 有可用的清洗后 HTML          |
| `not_present` | `false` | `null`     | 邮件本来没有 HTML            |
| `too_large`   | `false` | `null`     | 清洗后 HTML 超出部署字节上限 |
| `unavailable` | `false` | `null`     | 清洗失败或结果不可用         |

不直接截断 HTML 后渲染。HTML 不可用时仍返回可用的纯文本。列表中只返回 `hasHtml`，不随轮询传输完整正文或全部链接。网页对 HTML 使用隔离渲染，具体边界见[架构中的内容展示](architecture.md#82-内容安全)。

每个 `links` 元素包含：

| 字段   | 类型   | 含义                                                             |
| ------ | ------ | ---------------------------------------------------------------- |
| `url`  | string | 经 URL 解析和规范化的绝对 HTTPS URL，最长 4096；无用户名或密码   |
| `text` | string | 链接或按钮的纯文本标题，最多 256 码点；无标题时为 `""`           |
| `host` | string | 小写 ASCII/Punycode `URL.hostname`，不含端口；也可能是 IP 字面量 |

先收集清洗后 HTML 中的链接（DOM 顺序），再收集正文中的 URL（出现顺序），以规范化 URL 去重，保留首个非空标题，最多 20 个。链接不保证是验证入口，服务不会自动打开。原始 MIME、附件和未经清洗的 HTML 不作为 API 字段返回。

## 8. 删除邮件

### DELETE /api/v1/messages/{id}

本次删除仍可读的邮件时：

```json
{
  "id": "8c746a0e-7f90-4b13-a71c-9db724e57c02",
  "deleted": true,
  "serverTime": 1793671210000
}
```

不存在、已删除或已过期时仍返回 `200`，`deleted` 为 `false`。重复调用幂等，不把第二次删除当成异常。到期但尚未被 Cron 物理删除的邮件同样返回 `false`。这与 **GET 详情的 `404` 规则不同**。

### DELETE /api/v1/mailboxes/{name}/messages

只接受可选查询参数 `before`。条件为：

```text
address = 当前邮箱
AND receivedAt < before
AND expiresAt > serverTime
```

`before` 省略时取本请求的 `serverTime`；显式值不能在未来，超出返回 `400 invalid_query`。这是**不包含边界**的删除上界：恰好等于 `before` 的邮件保留。

```sh
curl --request DELETE \
  'https://inbox.cottage.dpdns.org/api/v1/mailboxes/signup/messages?before=1793671210000'
```

```json
{
  "name": "signup",
  "address": "signup@cottage.dpdns.org",
  "before": 1793671210000,
  "deletedCount": 2,
  "serverTime": 1793671210000
}
```

`deletedCount` 是语句执行时实际删除的可读邮件数。没有邮件时为 `0`，仍返回 `200`；过期记录不计入此数，由 Cron 清理。

清空不会注销地址，也不阻止新邮件入库。并发收信时，删除只作用于数据库语句当时可见且满足条件的记录，后来才入库的邮件不被这次操作覆盖。需要重试时可复用同一个 `before` 保持时间边界，但实际计数可能变化；只想删除本次任务已经处理的邮件时，应逐 ID 删除。

## 9. 错误格式与状态码

```json
{
  "error": "invalid_query",
  "message": "Invalid query parameter",
  "details": [
    {
      "field": "since",
      "message": "Must be a non-negative safe integer in Unix milliseconds"
    }
  ],
  "requestId": "5ab0dc31-ea54-4e46-95cf-d4a7d03a3aa1",
  "serverTime": 1793671210000
}
```

`error` 是稳定错误码；`message` 与 `details[].message` 用于阅读，不作为程序分支依据。`details` 最多 10 项，没有字段错误时为 `[]`；不回显请求中的邮件内容或堆栈。`requestId` 可用于查日志。

| HTTP | error                  | 场景 / 客户端处理                                                                      |
| ---- | ---------------------- | -------------------------------------------------------------------------------------- |
| 400  | `invalid_mailbox_name` | `{name}` 不合法，修改输入                                                              |
| 400  | `invalid_message_id`   | `{id}` 不符合小写 UUID v4，修改输入                                                    |
| 400  | `invalid_query`        | 未知、重复、空或非法查询参数，编码错误，或 `before` 在未来                             |
| 400  | `invalid_cursor`       | 游标内部结构非法或邮箱/筛选上下文不匹配，从第一页重查；空/重复参数仍归 `invalid_query` |
| 400  | `unexpected_body`      | GET/DELETE 带了非空请求体                                                              |
| 404  | `message_not_found`    | GET 单封详情时，不存在、已删除或已过期                                                 |
| 404  | `route_not_found`      | 未定义的 `/api/*` 路径，响应为 JSON，不回退到网页                                      |
| 405  | `method_not_allowed`   | 已有路径的方法不受支持，查看 `Allow`                                                   |
| 413  | `request_too_large`    | HTTP 请求体超过 8192 字节                                                              |
| 429  | `rate_limited`         | 请求频率过高；若响应带 `Retry-After` 则按其等待                                   |
| 500  | `internal_error`       | 未预期的应用错误，采用有上限的退避                                                     |
| 503  | `service_unavailable`  | 暂时不可用，例如 D1 请求失败；应用响应带 `Retry-After`                           |

当前应用实现会为 D1 不可用等 `503` 返回正整数秒的 `Retry-After`，例如 `Retry-After: 3`，浏览器客户端可通过 CORS 读取。Cloudflare 或其前置限流层也可能返回 `429`；具体阈值属于部署配置，不改变上述错误体合同。

本 API 无鉴权错误 `401/403`、邮箱创建冲突 `409` 或邮箱到期 `410`。合法邮箱名永远可查询，无可读邮件就返回正常空列表。多个参数同时有错时，服务至少报告一项，不规定错误检查顺序。

## 10. 可直接接入的最小客户端

以下 TypeScript 代码适合在 Cloudflare Workers、Node.js 20+ 或现代浏览器中直接改写。它保留任务固定的 `since`，每轮从第一页读取，按 `id` 去重，不自动推进时间下界，因此不会漏掉稍后入库的邮件。

```ts
export interface Mail {
  id: string;
  address: string;
  from: { name: string; address: string | null; domain: string | null };
  subject: string;
  preview: string;
  receivedAt: number;
  expiresAt: number;
  dmarcPass: boolean;
  codeCandidates: Array<{ value: string; source: 'subject' | 'textBody'; context: string }>;
  hasHtml: boolean;
}

export class EasyTmpClient {
  constructor(readonly baseUrl: string) {}

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, init);
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const retryAfter = Number(response.headers.get('Retry-After') || 0) || undefined;
      throw Object.assign(new Error(body?.message || `HTTP ${response.status}`), {
        status: response.status,
        code: body?.error,
        retryAfter,
        requestId: response.headers.get('X-Request-Id') || undefined,
      });
    }
    return body as T;
  }

  health() {
    return this.json<{ status: 'ok'; apiVersion: '1'; serverTime: number }>('/api/health');
  }

  randomAddress() {
    return this.json<{ name: string; address: string; serverTime: number }>(
      '/api/v1/addresses/random',
    );
  }

  messages(name: string, query: { since: number; fromDomain?: string; subject?: string }) {
    const params = new URLSearchParams({ since: String(query.since), limit: '20' });
    if (query.fromDomain) params.set('fromDomain', query.fromDomain);
    if (query.subject) params.set('subject', query.subject);
    return this.json<{ messages: Mail[]; pagination: { nextCursor: string | null } }>(
      `/api/v1/mailboxes/${encodeURIComponent(name)}/messages?${params}`,
    );
  }

  async waitForMail(
    name: string,
    since: number,
    options: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<Mail> {
    const deadline = Date.now() + (options.timeoutMs ?? 120_000);
    const seen = new Set<string>();
    while (Date.now() < deadline) {
      const result = await this.messages(name, { since });
      for (const mail of result.messages) {
        if (!seen.has(mail.id)) return mail; // 持久化业务状态时先保存，再返回
        seen.add(mail.id);
      }
      await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 3000));
    }
    throw new Error('Timed out waiting for email');
  }
}
```

上面的例子只用于第一页通常就包含目标邮件的情况。需要遍历全部匹配邮件时，从第一页开始，保留相同 `since`、`fromDomain`、`subject` 和 `dmarcPass`，把 `nextCursor` 原样传回；每轮轮询重新从不带 `cursor` 的第一页开始。客户端应持久化已处理的 `id`，或者只在本次任务内维护去重集合，避免重复处理同一邮件。

实际接码顺序为：生成或指定邮箱名 -> 调用 `/api/health` 或随机地址接口取得固定 `since` -> 将地址交给外部发信流程 -> 每隔约 3 秒查询列表 -> 按 `id` 去重 -> 从 `codeCandidates` 选择候选或读取详情 -> 需要时删除本次任务已处理的邮件。不要把 `since` 更新成最新的 `serverTime`，否则在发送与入库之间延迟的邮件可能被漏掉。

## 11. 实现与生产验收范围

自动化测试与实际生产验收覆盖以下行为：

- 邮箱名大小写归一、合法字符和 1/64 字符边界；发送到同名地址与 API 查询规则一致。
- `since` 含边界、`before` 不含边界、7 天到期边界，所有接口使用毫秒。
- 同毫秒多封邮件按 ID 稳定分页；筛选变化导致游标失效；锚点删除和过期仍能继续翻页。
- 任务固定 `since` 时，延迟入库的邮件可在后续轮询查到。
- 前导零验证码保持字符串；无候选、无发件名、无 HTML 和 HTML 超限均符合已定义空值格式。
- 单封读取与删除对“已删除/过期”的不同状态约定，清空的时间边界和删除数量。
- 非法参数、公开跨域调用、`OPTIONS`、统一错误头；应用 `503` 的 `Retry-After`，以及客户端对上游 `429` 的兼容处理。

生产实例 `https://inbox.cottage.dpdns.org` 已通过真实邮件投递、`dmarcPass=true`、验证码/链接提取、HTML 清洗、7 天精确到期和 Web UI 邮件详情验收。自建部署仍需用 `pnpm onboard` 的冒烟测试与一封真实邮件完成同样验收。
