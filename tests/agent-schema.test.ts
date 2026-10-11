import { asSchema, generateText } from 'ai'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { describe, expect, it } from 'vitest'
import { buildAgentTools } from '#/server/agent/tools'
import { lookupSchema } from '#/server/payments/service'
import { getSpendingReport } from '#/server/tools/bank-extended'
import { modelToolSchema } from '#/server/agent/tool-schema'
import { businessMonth } from '#/lib/dashboard'
import { checkSpec } from '#/server/genui/validate'

const ctx = { userId: 'u_demo', sessionId: 'schema-test', channel: 'web' as const }
describe('模型工具协议兼容性', () => {
  it('全部工具通过真实 DeepSeek SDK 序列化后，参数根节点均为 object', async () => {
    let count = 0
    const model = createDeepSeek({ apiKey: 'test-key', fetch: async (_url, options) => {
      const body = JSON.parse(String(options?.body))
      for (const tool of body.tools) {
        expect(tool.function.parameters.type, tool.function.name).toBe('object')
        count++
      }
      const search = body.tools.find((t: { function: { name: string } }) => t.function.name === 'search_bank_accounts')
      expect(search.function.parameters.oneOf ?? search.function.parameters.anyOf).toHaveLength(2)
      return Response.json({ id: 'schema-test', object: 'chat.completion', created: 1, model: 'deepseek-flash',
        choices: [{ index: 0, message: { role: 'assistant', content: '正常' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
    } })('deepseek-flash')
    const tools = buildAgentTools(ctx)
    const result = await generateText({ model, tools, prompt: '你好' })
    expect(result.text).toBe('正常')
    expect(count).toBe(Object.keys(tools).length)
    expect(count).toBeGreaterThan(50)
  })
  it('参数包装保留手机号、账号户名互斥分支的运行时校验', async () => {
    const schema = asSchema(modelToolSchema(lookupSchema))
    for (const args of [{ method: 'phone', phoneNumber: '13800000001' }, { method: 'account', accountNo: '8800000000000001', name: '李小萌' }])
      expect((await schema.validate!(args)).success).toBe(true)
    for (const args of [{ method: 'phone' }, { method: 'phone', phoneNumber: '123' }, { method: 'account', accountNo: '8800000000000001' }])
      expect((await schema.validate!(args)).success).toBe(false)
  })
  it('自然月报表直接提供最终图表数组，无需再分析交易来转换格式', async () => {
    const data = await getSpendingReport.execute({ period: businessMonth(new Date()) }, ctx)
    expect(Object.fromEntries(data.byCategory.map((row) => [row.category, row.total]))).toEqual(data.categories)
    expect(Math.round(data.byCategory.reduce((sum, row) => sum + row.total, 0) * 100)).toBe(Math.round(data.expense * 100))
    expect(checkSpec({ root: 'chart', elements: { chart: { type: 'PieChart', props: { title: '分类支出', data: { $state: '/get_spending_report/byCategory' }, labelKey: 'category', valueKey: 'total' } } } }, { get_spending_report: data }).ok).toBe(true)
  })
})
