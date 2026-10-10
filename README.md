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

演示交易密码：`123456`（`DEMO_TX_PASSWORD`）。

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 启动 Web/H5 |
| `pnpm test` | 单元测试与红队用例（策略、令牌、审计链、执行器、注入、沙箱、生成式 UI） |
| `pnpm typecheck` | 类型检查 |
| `pnpm db:reset` | 重建数据库并写入演示数据 |
| `pnpm bot:lark` | 启动飞书机器人（需 `LARK_APP_ID` / `LARK_APP_SECRET`） |
| `pnpm mcp` | 以 stdio 启动 MCP Server（仅只读工具） |

## 技术栈

TanStack Start · Vercel AI SDK v7 · DeepSeek V4.1 Flash · Qwen3Guard · json-render · Chat SDK（飞书） · MCP · SQLite + Drizzle · QuickJS 沙箱 · Vitest
