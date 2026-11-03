# Inbound Worker 审计与公共层缺陷报告 (Audit Findings)

日期：2026-11-03
模块：`apps/inbound-worker`

本文件记录在实现与补强 Email Worker（接信、流控、安全校验与 Cron 清理）过程中发现的共享层与原型实现缺陷、Worker 内部补防措施以及给主代理的具体修复建议。

---

## 1. DMARC 认证信任边界缺陷 (`packages/shared/src/mime/parser.ts`)

### 问题详情

在 `packages/shared/src/mime/parser.ts` 中：

```ts
export function checkDmarcPassFromHeaders(headers: Array<{ key: string; value: string }>): boolean {
  for (const header of headers) {
    if (header.key.toLowerCase() === 'authentication-results') {
      const val = header.value.toLowerCase();
      if (/\bdmarc=pass\b/.test(val)) {
        return true;
      }
    }
  }
  return false;
}
```

该函数遍历邮件的所有头部，只要发现任意名为 `Authentication-Results` 的头包含 `dmarc=pass` 就判定 DMARC 通过。

### 安全风险

1. **伪造头利用**：攻击者可在发送的原始邮件中包含自建的 `Authentication-Results: attacker.com; dmarc=pass`，或者通过多跳中继保留其他中继 MTA 的认证头。当 Cloudflare Email Routing 判定 DMARC 失败并注入 `Authentication-Results: mx.cloudflare.com; dmarc=fail` 时，由于遍历了所有同名头，`checkDmarcPassFromHeaders` 依然会返回 `true`，导致伪造邮件绕过防护进入用户收件箱。
2. **缺乏 authserv-id 校验**：即便只有单个头，该函数未校验其是否源自 Cloudflare 认证服务（`mx.cloudflare.com` / `*.cloudflare.com`），任何第三方域名的认证结果均被无条件信任。

### Worker 内部补防措施 (`apps/inbound-worker/src/dmarc.ts`)

Worker 实现了独立的 `parseRawHeaders` 与 `verifyCloudflareDmarc`：

1. 严格只定位并校验**首个** `Authentication-Results` 头（Cloudflare Email Routing 会将自身认证结果头前置插入到邮件最上方）。
2. 提取分号前的 `authserv-id`，严格正则匹配 Cloudflare 官方服务标识：`/^(?:[a-z0-9-]+\.)*cloudflare(?:\.com)?$/i`。
3. 校验该 Cloudflare 头内部参数包含且仅包含 `dmarc=pass`（使用 `/(?:^|[;\s])dmarc\s*=\s*pass(?:\s|[;(]|$)/i`）。
4. 忽略后续伪造同名头，且 RFC 5322 头部解析截止于 `\r\n\r\n`，杜绝正文内容伪造头部。
5. Worker 在将记录写入 D1 时，覆盖 `dmarc_pass` 为 Worker 严格校验后的结果。

### 给主代理的修复建议

在 `packages/shared/src/mime/parser.ts` 中：

1. 修改 `checkDmarcPassFromHeaders`，改为只取首个 `key.toLowerCase() === 'authentication-results'` 的头；
2. 校验首个头的 `authserv-id` 属于 Cloudflare；
3. 确保只有该首个头明确为 `dmarc=pass` 时才返回 `true`。

---

## 2. `ParsedEmailResult` 未暴露解析后的 Headers 列表 (`packages/shared/src/mime/parser.ts`)

### 问题详情

`parseRawEmail` 的返回类型 `ParsedEmailResult` 仅返回了计算后的 `dmarcPass: boolean`，未保留原始或解析后的 `headers` 数组。

### 影响

由于无法从 `ParsedEmailResult` 取得原始头部结构，调用方若需对邮件头进行二次安全审计（例如核对 Cloudflare 注入头或防伪分析），必须再次解析头部。

### 给主代理的修复建议

在 `ParsedEmailResult` 接口中增加 `headers?: Array<{ key: string; value: string }>` 字段，并将 PostalMime 解析出的 headers 暴露给上层业务。

---

## 3. 全量缓冲与 OOM 拒绝服务风险

### 问题详情

原 Worker 骨架使用 `new Response(message.raw).arrayBuffer()` 一次性读取全量数据后才判断字节大小。

### 影响

恶意发件人若投递 50MB-100MB 垃圾邮件，会耗尽 Cloudflare Worker 的 128MB 内存上限，直接导致 Worker 实例崩溃。

### Worker 内部补防措施 (`apps/inbound-worker/src/stream.ts`)

1. 前置读取 `message.size` 或 `message.rawSize`（若运行时存在），超限则立即 `message.setReject`，完全不读取流；
2. 实现 `readStreamWithLimit`，在流式 chunk 读取时累计字节数，一旦超过 `MAX_EMAIL_BYTES` 立即调用 `reader.cancel()` 中断传输并释放资源，杜绝内存耗尽风险。

---

## 4. 环境变量与配置安全范围收敛

### 问题详情

若环境变量传入负数、非数字字符串或超出架构规定的极值（如 `MAX_EMAIL_BYTES = 10000000`），可能破坏业务约束。

### Worker 内部补防措施 (`apps/inbound-worker/src/config.ts`)

实现 `clampNumber` 与 `resolveConfig`：

- `MAX_EMAIL_BYTES` 严格限制在 `[1024, 2097152]`（默认 1048576）；
- `MAX_TEXT_CHARS` 严格限制在 `[1024, 131072]`（默认 32768）；
- `MAX_HTML_BYTES` 严格限制在 `[1024, 524288]`（默认 262144）；
- `REQUIRE_DMARC_PASS` 默认与非法值 fail-safe 回退为 `true`。

---

## 5. Cron 定时清理执行耗时与子请求上限保护

### 问题详情

原 Cron 清理使用 `do ... while (deletedInBatch === batchSize)` 无上限循环。若有海量过期邮件积压，会触发 Cloudflare Worker 的 CPU 超时或子请求限制（50 subrequests limit）。

### Worker 内部补防措施 (`apps/inbound-worker/src/index.ts`)

为 Cron 每次触发增加总清理上限保护（`cronMaxTotalDelete = 1000`，即最多 10 批次），未清理完的数据由 10 分钟后的下一轮 Cron 继续平滑清理，确保 Worker 稳定运行且不被平台截断。
