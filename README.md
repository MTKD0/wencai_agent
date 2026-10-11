# 文财 · 银行 AI 智能体

用自然语言办理银行业务的 AI Banking Agent。核心原则：**大模型负责理解与提议，确定性代码负责授权与执行。**

架构与安全设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)；当前源码调用链、开发入口、Windows 启动步骤和待办见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 快速开始

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env.local  # 填入至少 16 位的 CONFIRM_SECRET 和模型配置
New-Item -ItemType Directory -Force data | Out-Null
pnpm exec node --env-file=.env.local ./node_modules/drizzle-kit/bin.cjs push
pnpm exec node --env-file=.env.local --import=tsx src/server/db/seed.ts
pnpm exec node --env-file=.env.local ./node_modules/vite/bin/vite.js --port 3000
```

以上适用于首次初始化；播种会重建演示数据。服务端从进程环境变量读取配置，上述命令显式加载 `.env.local`。环境变量已经注入时可直接使用下方快捷命令。

登录用手机号验证码（演示环境验证码打印在服务端日志）：

| 手机号 | 用户 | 交易密码 |
|---|---|---|
| `13800000000` | 张小明 | `123456` |
| `13800000001` | 李小萌 | `654321` |

第二个账号用于演示越权防护：登录态 A 拿不到 B 的任何数据。

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 启动 Web/H5 |
| `pnpm test` | 单元测试与红队用例（策略、令牌、审计链、执行器、注入、沙箱、生成式 UI、越权） |
| `pnpm typecheck` | 类型检查 |
| `pnpm db:reset` | POSIX shell 下重建数据库并写入演示数据；Windows 见上方步骤 |
| `pnpm bot:lark` | 启动飞书机器人（需 `LARK_APP_ID` / `LARK_APP_SECRET`） |
| `pnpm mcp` | 以 stdio 启动 MCP Server（仅只读工具） |

## 银行管理后台

`http://localhost:3000/admin` 首页展示全部银行用户与注册用户，支持按姓名、手机号或用户 ID 搜索，并显示账户数、总余额和风险等级。点击「登录账户」进入指定用户的管理界面，右上角或侧栏可返回首页切换账户。

这是面向银行运营/演示的管理后台（不是用户端），可直接查看和操作所选用户的模拟银行数据：账户总览、流水与异常、转账与 AA、理财、卡片、订阅、生日计划、仿真时钟、操作审计。账户切换只改变后台管理对象，不创建用户端登录会话；各用户的查询缓存、命令与审计均携带对应用户标识。

- 后台走 `/api/admin`，**不经过策略引擎与确认令牌**，是人工直连通道；每条命令都写入哈希链审计（类型 `admin_command`）。
- **没有登录鉴权**，只适合本地演示。`NODE_ENV=production` 时默认关闭，显式设置 `ADMIN_ENABLED=true` 可开启。
- 「推进时间」只向前推进仿真时钟，并执行到期的定时转账。

## 工具层

Agent 共 50 个银行工具（基础 13 个 + `bank-extended.ts` 22 个 + `bank-planning.ts` 15 个，32 个 read、18 个 write）。扩展部分采用**两段式确认**：

```
resolve_recipient → check_transfer_limit → preview_transfer（签发令牌，只读）→ commit_transfer（策略引擎拦截 → 用户确认 → 校验并消费令牌）
```

预览令牌绑定 操作类型 + 已解析实体 ID 的参数指纹 + 用户，15 分钟有效。顺序调用中的改金额、换收款人、重放、跨用户、过期会被拒绝，见 `tests/confirmation-token.test.ts`；并发消费仍需加固。用户确认另由 HMAC 待确认动作控制，默认有效期 300 秒。

当前扩展转账尚未接入原 `transfer` 的风险升级规则，其他实现边界见 [开发导读第 8 节](docs/DEVELOPMENT.md#8-当前实现边界与优先事项)。

## 用户与权限

- **身份**：手机号 + 验证码登录（better-auth + phone-number 插件），会话存库。未登录调用 `/api/chat`、`/api/confirm` 一律 401。
- **强验证**：红色操作用交易密码（scrypt）或 Passkey（WebAuthn）。5 次失败锁定 30 分钟。
- **渠道绑定**：飞书账号需在 `/bind` 完成一次强验证后才可代办业务，未绑定账号查不到任何数据。
- **设备管理**：`/settings` 可查看并踢掉其他登录会话、解绑渠道、注册 Passkey。

详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 第 3、4 节。

## 技术栈

TanStack Start · Vercel AI SDK v7 · DeepSeek / OpenAI 兼容模型接口 · Qwen3Guard · json-render · Chat SDK（飞书） · MCP · SQLite + Drizzle · QuickJS 沙箱 · Vitest
