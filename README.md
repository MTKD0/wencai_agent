# 文财 · 银行 AI 智能体

用自然语言办理银行业务的 AI Banking Agent。核心原则：**大模型负责理解与提议，确定性代码负责授权与执行。**

架构与安全设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 快速开始

```bash
pnpm install
cp .env.example .env.local   # 填入 DEEPSEEK_API_KEY（或 FALLBACK_* 兼容接口）
pnpm db:reset                # 建表 + 演示数据
pnpm dev                     # http://localhost:3000
```

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
| `pnpm db:reset` | 重建数据库并写入演示数据 |
| `pnpm bot:lark` | 启动飞书机器人（需 `LARK_APP_ID` / `LARK_SECRET`） |
| `pnpm mcp` | 以 stdio 启动 MCP Server（仅只读工具） |

## 用户与权限

- **身份**：手机号 + 验证码登录（better-auth + phone-number 插件），会话存库。未登录调用 `/api/chat`、`/api/confirm` 一律 401。
- **强验证**：红色操作用交易密码（scrypt）或 Passkey（WebAuthn）。5 次失败锁定 30 分钟。
- **渠道绑定**：飞书账号需在 `/bind` 完成一次强验证后才可代办业务，未绑定账号查不到任何数据。
- **设备管理**：`/settings` 可查看并踢掉其他登录会话、解绑渠道、注册 Passkey。

详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 第 3、4 节。

## 技术栈

TanStack Start · Vercel AI SDK v7 · DeepSeek V4.1 Flash · Qwen3Guard · json-render · Chat SDK（飞书） · MCP · SQLite + Drizzle · QuickJS 沙箱 · Vitest
