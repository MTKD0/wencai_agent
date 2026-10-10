import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer } from '#/server/channels/mcp'
import { DEMO_USER_ID } from '#/server/db/constants'

// TODO: 通过 OAuth 获取用户身份；骨架阶段使用演示用户
const server = createMcpServer({ userId: DEMO_USER_ID, sessionId: `mcp:${Date.now()}`, channel: 'mcp' })
await server.connect(new StdioServerTransport())
