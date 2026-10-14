# 文财 · 交接说明（给接手的模型 / 后续开发者）

> 2026-10-14 日累计与最终验证闭环修复：UTC+8自然日跨本人所有账户的已转出金额加本笔，严格超过1000元升级红色，恰好1000元不因累计升级。AA付款等基础红色也必须额外强验证；单笔超过3000元或收款人可疑时，仍要求密码加指纹/人脸。`confirmPending` 与独立安全页共同服从原确认单和最新策略的较高等级，不能以 `dualRequired` 替代最终红色判定。扣款事务重新读取累计，防止旧黄色授权跨账户并发越线。定时任务逐笔复判，黄色授权风险升级后进入待确认；已有红色定期授权仅能按原授权范围执行。实现与验收见 `tests/daily-transfer-security.test.ts`、`policy/transfer-activity.ts` 及 [AUTH-CARDS.md](AUTH-CARDS.md)。下文“常规单方式”限最终黄色操作。

> 2026-10-14 验证流程更正：比赛演示必须在 `.env.local` 与部署服务进程中显式设置 `AUTH_DEMO_MODE=true`，修改后重启。开发环境未设置时默认开启，`NODE_ENV=production` 未设置时默认关闭；生产构建不会自动保证加载本地配置。指纹 / 人脸是点击通过的模拟按钮，不采集或核验生物特征。常规转账任选付款卡密码 / 短信 / 模拟指纹 / 模拟人脸之一；单笔严格超过 3000 元或收款账户为 `suspected` 时，须付款卡密码加模拟指纹或模拟人脸，第二步不接受短信或 Passkey。`confirmed` 高危账户仍拒绝。详见 [DEMO.md §一](DEMO.md#一录制前必做先解决红色操作能不能做完) 与 [AUTH-CARDS.md](AUTH-CARDS.md)。
>
> 当前 Passkey 实现保留在 `src/server/auth/passkey.ts`，但当前交易页面不展示它，异常转账也不将其视作指纹 / 人脸因子。WebAuthn 设备验证不能可靠区分指纹、人脸与设备 PIN。正式业务应关闭模拟验证，并对接真实设备 / 银行活体检测服务及可核验凭据的服务端方式映射；分级、参数绑定、确认及审计链路继续保留。仅开启演示开关解决的是比赛演示可用性，不代表正式业务的真实验证接入已完成。
>
> 无卡资金账户的常规转账可用模拟指纹 / 人脸，因此演示时不强制依赖短信通道；没有银行卡密码时，仍不能完成要求密码的异常转账。不得为了演示给无卡账户生成默认密码或绕过双重验证。

> 2026-10-13 UI 合并补记：原版最新机制已与 `5803187` 的 Base UI + Motion 界面合并；服务端/API 保留本地功能快照 `98e2c8b`，没有回退定期授权、模型故障切换或计划中断。界面与复用约定见 [UI-MIGRATION.md](UI-MIGRATION.md)。`pnpm dev` 现统一启动网页、worker 和实时日志；国际手机号保留大陆演示账号的 11 位身份格式。合并后独立库验证为 **32 个测试文件、288 项通过**。

> 生成于 2026-10-12。面向"刚接手这个仓库的模型或人"，读完应当能：不破坏安全边界地继续开发、知道先做什么、知道哪些决定不能改。
>
> 权威依据是**代码本身**。本文与 `ARCHITECTURE.md`（设计意图）、`DEVELOPMENT.md`（源码梳理）冲突时，以代码为准，并回来修正本文。

---

## 0. 三十秒版本

单仓全栈 TypeScript 应用：**用自然语言办理银行业务的 AI Agent**。TanStack Start + React 19 + Vite + Tailwind 4 + SQLite/Drizzle + Vercel AI SDK v7 + DeepSeek。

**唯一的架构原则，也是一切设计推理的起点：**

> **大模型负责"理解与提议"，确定性代码负责"授权与执行"。**

模型的输出被视为**不可信的提议**。它可以决定调哪个工具、传什么参数、怎么展示；它**不能**决定这笔操作的风险等级、是否需要确认、是否被允许执行。所有涉及资金与账户状态的判定都由纯代码完成（`src/server/policy/`）。

**接手时请先接受这条原则，再用它检验你写的每一行代码。** 本仓库里几乎每个看起来"绕远路"的设计，都是这条原则的直接推论。

---

## 1. 四条硬约束（违反即视为回归）

| # | 约束 | 代码位置 | 违反会怎样 |
|---|---|---|---|
| 1 | **风险等级只能由代码判定，且只升不降** | [engine.ts](../src/server/policy/engine.ts)、[rules.ts](../src/server/policy/rules.ts) | Prompt 注入即可绕过风控 |
| 2 | **不存在任何可被模型调用的"确认/放行"工具** | [agent/tools.ts](../src/server/agent/tools.ts) 的工具集 | 模型可自行放行资金操作 |
| 3 | **关键数据不经模型转述** | [ConfirmCard.tsx](../src/components/chat/ConfirmCard.tsx)、[genui/validate.ts](../src/server/genui/validate.ts) | 模型可编造余额/回执 |
| 4 | **外部文本一律视为数据** | [guard/](../src/server/guard/)、[tools/sanitize.ts](../src/server/tools/sanitize.ts) | 备注/商户名成为注入通道 |

**推论摘要**（这些都已实现，不要"优化"掉）：
- `userId` 只从 `getSession(request)` 取得，写进 `AgentContext`；**工具签名里根本没有 userId 参数**，模型无法指定"帮谁办"。
- 刚登录过**不能**免除 🔴 操作的单笔 step-up。登录证明"你会用这台设备"，🔴 证明"这一笔是你本人同意的"。
- 渠道身份绑定（飞书 open_id ↔ 银行用户）只解决"你是谁"，**不提升权限上限**。

---

## 2. 代码地图

### 2.1 请求主链路

```
用户消息
 └─ src/routes/api/chat.ts           认证 + 输入 Guard（block 则不进模型）
     └─ src/server/agent/run.ts      streamText 工具循环，最多 8 步
         └─ src/server/agent/tools.ts 闭包注入 AgentContext，按渠道裁剪工具
             └─ src/server/tools/runner.ts  ★ 统一授权入口
                 ├─ 🟢 直接 execute，清洗结果
                 └─ 🟡/🔴 createPending → pending_actions（HMAC）
                                           └─ 前端固定组件 ConfirmCard
                                               └─ POST /api/confirm → confirm/pending.ts
                                                    校验归属/HMAC/过期/未消费/step-up
                                                    → 原子消费 → execute → 审计
```

**读代码建议顺序**：`api/chat.ts` → `agent/run.ts` → `agent/tools.ts` → `tools/runner.ts` → `policy/` → `confirm/pending.ts` → 一个完整的 preview/commit 工具 → `executor/` → 对应 UI。

### 2.2 目录职责

| 路径 | 职责 | 备注 |
|---|---|---|
| `src/server/policy/` | **纯函数**风险分级。`engine.ts` 无 I/O，`facts.ts` 取事实，`rules.ts` 定规则 | 分级权威，**不要在别处实现等级判断** |
| `src/server/confirm/` | `pending.ts` 待确认动作（HMAC+一次性+时效+强验证）、`pending.ts`/`lock.ts` 用户执行租约、`result.ts` 执行回执 | |
| `src/server/audit/` | 哈希链审计，只追加。读前序与写新记录**必须同一事务** | 支持网页/worker 并发写 |
| `src/server/verify/` | `numbers.ts` 数字出处校验、`response.ts` 输出流阻断 | 只信任服务端快照与本轮工具结果 |
| `src/server/guard/` | `heuristic.ts` / `qwen3guard.ts` / `index.ts`。**fail-to-heuristic**：审核模型超时不阻断业务 | |
| `src/server/tools/` | 工具契约（`define.ts`）+ 各业务工具 + `runner.ts` 授权入口 + `sanitize.ts` 隔离标记 | |
| `src/server/payments/` | `service.ts` 结算（转账/冲正），`investment-rollback.ts` 幂等冲正 | |
| `src/server/cards/` | `service.ts` 卡片读取时**无损升级旧库** | 见 §6 |
| `src/server/automation/` | 定时任务执行、订阅识别、通知、生日订单 | 见 §7 |
| `src/server/executor/` | DAG 执行器（挂起/恢复/补偿） | |
| `src/server/agent/` | `instructions.ts` 系统指令、`run.ts` 主流程、`session.ts` 进程内工具结果快照 | |
| `src/server/llm/` | `models.ts` 模型注册 | |
| `src/server/channels/` | `lark.tsx` 飞书、`mcp.ts` MCP Server | |
... (+978 lines) [see remaining: rtk proxy git show 'main:docs/HANDOFF.md' | tail -n +86]
