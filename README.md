<p align="center">
  <img src="docs/assets/project-icon.svg" width="96" height="96" alt="Cloudflare EasyTmp Mail Logo" />
</p>

<h1 align="center">Cloudflare EasyTmp Mail</h1>

<p align="center">
  <strong>基于 Cloudflare 全栈 Serverless 架构的完全公开、免密使用的临时接码邮箱系统</strong>
</p>

<p align="center">
  <a href="https://inbox.cottage.dpdns.org">官方生产演示</a> •
  <a href="docs/GETTING_STARTED.md">5分钟快速上线</a> •
  <a href="docs/api.md">API v1 合同</a> •
  <a href="docs/openapi.yaml">OpenAPI 3.1</a> •
  <a href="docs/AI_PROMPTS.md">AI 提示词库</a> •
  <a href="docs/README.md">完整文档中心</a>
</p>

---

## 项目总览

**Cloudflare EasyTmp Mail** 是一套开箱即用、免密公开、自动滚动的现代化临时邮箱基础设施。系统采用 **Cloudflare Pages** 托管静态 React 前端与同源 **Pages Functions** (`/api/*`)、**Cloudflare Email Worker** 负责接收公网邮件与定时垃圾清理，两端通过边缘分布式数据库 **Cloudflare D1** 持久化并共享数据。

项目具备高度可移植性：任何拥有 Cloudflare 域名的使用者，**只需修改一个根配置文件并完成一次官方 OAuth 授权，即可在 5 分钟内拉起属于自己的全套临时接码邮箱服务**。

---

## 官方正式生产实例

- **网页端与 API 服务地址**：[https://inbox.cottage.dpdns.org](https://inbox.cottage.dpdns.org)
- **官方收件域名**：`@cottage.dpdns.org`
- **当前运行状态**：v1 稳定生产运行中，已通过公网真实收信、Cloudflare Email Routing MTA 严格 DMARC 认证、4-12 位验证码提取、7 天到期硬约束及 Web 安全沙箱端到端验收。

---

## 核心业务与技术规则

1. **公开免密设计（预期设计）**：
   - 临时邮箱专为短期验证码接收与即用即弃场景设计，无需用户注册、密码、Token 或 API Key。
   - 只要知道邮箱名，任何使用者或自动化脚本均可读取与清理该邮箱下的邮件。
2. **7 天不可变保留周期**：
   - 数据库 Schema 底层硬性施加 `CHECK (expires_at = received_at + 604800000)`，精确锁定 7 天生命周期。
   - API 查询层强制过滤 `expires_at > serverTime`，到期即刻逻辑不可见；Worker Cron 触发器每 10 分钟执行一次物理批处理销毁。
   - **邮箱地址永不过期，过期的仅为接收到的邮件数据**。
3. **严格 DMARC 防伪造防线**：
   - 仅信任 Cloudflare MTA 注入的最上方首个 `Authentication-Results` 标头，且验证 `authserv-id` 必须严格等于 `mx.cloudflare.net`。
   - 发件人自带的伪造标头、正文注入标头或非 Cloudflare 认证结果一律判定为未通过。
4. **智能验证码与链接提取**：
   - 自动从标题与正文中识别提取 4–12 位验证码（保留前导零字符串格式），并提取合法 HTTPS 激活链接。
   - HTML 邮件运行在隔离的 `srcdoc` iframe 沙箱中，严格阻止脚本执行与外部隐私追踪。
5. **权威对账与节能休眠**：
   - 前端采用 3 秒长轮询自动对账；当浏览器标签页处于后台不可见状态时彻底停止定时器，恢复可见时立即触发主动刷新。

---

## 5 分钟极速上线指引

只需准备一个托管在 Cloudflare 上的域名，四步即可完成全自主部署：

```sh
# 1. 克隆代码并安装依赖
git clone https://github.com/your-org/cloudflare-easytmp-mail.git
cd cloudflare-easytmp-mail
pnpm install --frozen-lockfile

# 2. 修改根目录 easytmp.config.json 中的 mailDomain 为你的域名
# 例如: {"mailDomain": "example.com"}

# 3. 在浏览器（Chrome）中完成 Cloudflare 官方 OAuth 授权登录
pnpm exec wrangler login

# 4. 运行预检与全自动部署上线
pnpm onboard          # 默认执行 Dry-Run 安全模拟检查
pnpm onboard --apply  # 确认无误后执行正式全栈部署发布
```

详细逐步实操、常见错误排查与首次外部发信验收详见 [新手 5 分钟上手指南](docs/GETTING_STARTED.md)。

---

## 目录地图 (pnpm workspace)

```text
cloudflare-easytmp-mail/
├── packages/
│   ├── shared/         # 纯业务工具：API 类型、校验、严格 Cursor、HTML 清洗、DMARC 验证
│   └── db/             # D1 Repository、SQL 查询构建器、0001 初始 Schema 迁移与 Mock
├── apps/
│   ├── api/            # Cloudflare Pages Functions (/api/*) 与全栈产物打包入口
│   ├── inbound-worker/ # Cloudflare Email Worker 与 Cron Trigger scheduled() 定时清理
│   └── web/            # React 18 + Vite 静态网页（深色操作区、浅色收件箱、安全沙箱 iframe）
├── scripts/            # 自动化 Onboarding、OAuth 会话解析、邮件路由配置与冒烟测试
├── docs/               # 完整技术架构、接口手册、OpenAPI 规范与运维指南
└── easytmp.config.json # 全仓单一配置事实源
```

---

## 完整文档中心索引

项目提供针对不同角色的完备文档体系，请参阅：

| 文档名称                                           | 主要面向受众            | 核心内容摘要                                                                   |
| -------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| [docs/README.md](docs/README.md)                   | 全体人员                | 文档全景导航与角色检索路径地图                                                 |
| [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) | 初次部署者 / 站长       | 从零克隆、改 1 个域名、授权 1 次 OAuth 的 5 分钟全自动上线实操指南             |
| [docs/AGENT_RUNBOOK.md](docs/AGENT_RUNBOOK.md)     | AI Agent / 自动化流水线 | 面向执行 Agent 的确定性状态机、只读与修改边界、零凭据泄露规范与回滚策略        |
| [docs/api.md](docs/api.md)                         | 业务对接工程师          | 完整的 API v1 合同手册，涵盖各端点定义、时间筛选、游标分页与 TypeScript 客户端 |
| [docs/openapi.yaml](docs/openapi.yaml)             | 机器与工具集成          | 严格遵循 OpenAPI 3.1.0 标准的机器可读规范定义（已补全 `/api/config`）          |
| [docs/api-testing.md](docs/api-testing.md)         | QA / 测试人员           | 本地/生产 curl 联调命令、端到端真实邮件投递验收规范及严格 HTTP 边界测试矩阵    |
| [docs/MAINTENANCE.md](docs/MAINTENANCE.md)         | SRE / 运维人员          | 日常监控指标、7 天 Cron 定时清理机制、D1 迁移、域名变更与服务回滚手册          |
| [docs/EDITING_GUIDE.md](docs/EDITING_GUIDE.md)     | 核心开发者 / 贡献者     | 代码模块职责、配置数据流、API/Worker/Web/D1 各端修改流程与测试质量门禁         |
| [docs/AI_PROMPTS.md](docs/AI_PROMPTS.md)           | 提示词使用者            | 针对 Claude Code、Codex、CPA gemini-3.8-flash 的开箱即用启动与排障提示词库     |
| [docs/architecture.md](docs/architecture.md)       | 架构师 / 安全审计员     | 边缘拓扑结构、入站收信/查询/清理三大核心数据流、防伪造模型与生产资源表         |

---

## 当前官方生产资源一览

| 资源类别            | 官方生产事实                            | 说明                                                   |
| ------------------- | --------------------------------------- | ------------------------------------------------------ |
| **收件邮件域名**    | `cottage.dpdns.org`                     | 托管在 Cloudflare 的活跃 Zone，开通 Email Routing      |
| **Web 与 API 域名** | `inbox.cottage.dpdns.org`               | Cloudflare Pages 自定义域名，全站强制开启 HTTPS        |
| **Pages 实例**      | `easytmp-mail`                          | 托管 React 静态前端与同源 `/api/*` Pages Functions     |
| **Email Worker**    | `easytmp-mail-inbound` (版本 `0c6c...`) | 处理 SMTP 邮件接收、DMARC 校验与 10 分钟 Cron 清理     |
| **D1 数据库**       | `easytmp-mail` (UUID: `8a3c...`)        | 部署于亚太（apac）区域，包含 7 天不可变 CHECK 约束     |
| **已清理历史资源**  | `email-code-worker`                     | **已于 2026-11-03 彻底下线删除**，平台 MX/SPF 完整保留 |

---

## 限制与安全使用须知

- **共享邮箱私密性提示**：由于免密公共属性，同名邮箱不设账户密码隔离。建议用户或业务系统通过生成 16 位密码学安全随机地址（如调用 `/api/v1/addresses/random`）来降低碰撞概率。
- **邮件体大小上限**：系统默认接收邮件大小上限为 1MB（架构硬限 2MB），超大附件邮件将在 Cloudflare 边缘被安全拒收。
- **生产环境防误删红线**：严禁在官方生产环境对公共测试邮箱调用清空或随意删除他人验证码邮件。接口测试请使用独立的随机临时邮箱。
- **凭据零泄露规范**：请勿在提交的代码、配置文件或讨论日志中记录任何 Cloudflare OAuth 令牌或 API Token。
