import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AgentContext } from '#/server/agent/context'
import { availableBankTools } from '#/server/agent/tools'
import { runBankTool } from '#/server/tools/runner'

/**
 * MCP 渠道：把文财的银行能力开放给 OpenClaw / Claude 等通用智能体。
 * 能力上限为 🟢——只注册只读工具；写操作不在此渠道暴露。
 */
export function createMcpServer(ctx: AgentContext): McpServer {
  const server = new McpServer({ name: 'wencai-bank', version: '0.1.0' })
  for (const def of availableBankTools(ctx)) {
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: def.inputSchema as never, annotations: { readOnlyHint: true } },
      (async (args: unknown) => {
        const outcome = await runBankTool(def, args, ctx)
        return { content: [{ type: 'text' as const, text: JSON.stringify(outcome) }] }
      }) as never,
    )
  }
  return server
}
