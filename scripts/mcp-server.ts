import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer } from '#/server/channels/mcp'
import { DEMO_USER_ID } from '#/server/db/constants'

/**
 * MCP 渠道身份。
 *
 * stdio 模式由本地调用方直接拉起进程，无浏览器会话可用，因此这里用演示用户。
 * 真实部署应改为 HTTP 传输 + OAuth 授权码：回调里换 token → 查 channel_bindings
 * （channel='mcp'）→ 得到 userId。只开放只读工具，与该渠道 🟢 的能力上限一致。
 */
const server = createMcpServer({ userId: DEMO_USER_ID, sessionId: `mcp:${Date.now()}`, channel: 'mcp' })
await server.connect(new StdioServerTransport())
