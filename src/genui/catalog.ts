import { defineCatalog } from '@json-render/core'
import { schema } from '@json-render/react/schema'
import { z } from 'zod'

/**
 * 展示类生成式 UI 的组件目录（见 ARCHITECTURE.md §6）。
 * 约束：所有数据型 props 只接受 { $state: "/路径" } 引用，不接受字面量——
 * 数据由服务端从工具结果注入，模型只决定"怎么展示"，无法编造数字。
 */
const DataRef = z.object({ $state: z.string().regex(/^\/[\w/-]+$/) }).strict()

export const catalog = defineCatalog(schema, {
  components: {
    Panel: {
      props: z.object({ title: z.string().max(30), subtitle: z.string().max(60).nullable() }),
      description: '卡片容器，可包含子元素',
    },
    Metric: {
      props: z.object({ label: z.string().max(20), value: DataRef, unit: z.enum(['元', '%', '笔', '天']).nullable() }),
      description: '单个指标，如本月总支出',
    },
    BarChart: {
      props: z.object({ title: z.string().max(30), data: DataRef, labelKey: z.string(), valueKey: z.string() }),
      description: '纵向柱状图（逐柱向上展开）；data 指向对象数组，labelKey/valueKey 指定字段名',
    },
    PieChart: {
      props: z.object({ title: z.string().max(30), data: DataRef, labelKey: z.string(), valueKey: z.string() }),
      description: '环形占比图（顺时针逐段展开）；适合消费类别构成',
    },
    Table: {
      props: z.object({
        rows: DataRef,
        columns: z.array(z.object({ key: z.string(), label: z.string().max(12) })).min(1).max(6),
      }),
      description: '表格；rows 指向对象数组',
    },
    Note: {
      props: z.object({ text: z.string().max(120) }),
      description: '一句说明文字。不得包含金额数字，金额请用 Metric 引用数据',
    },
    FollowUp: {
      props: z.object({ label: z.string().max(16), prompt: z.string().max(60) }),
      description: '追问按钮：点击后以用户身份发送 prompt。只能用于查询/分析类追问',
    },
  },
  // 不声明任何 action：唯一的交互 FollowUp 只会以用户身份发一条新消息，重新走完整的意图 → 策略 → 确认流程
  actions: {},
})

export type GenUISpec = typeof catalog._specType

/** 给模型的组件说明（不使用默认的 JSONL 流式提示，spec 通过 show_view 工具整体提交） */
export function catalogPrompt(): string {
  const lines = Object.entries(catalog.data.components).map(
    ([name, c]) => `- ${name}: ${(c as { description: string }).description}`,
  )
  return [
    'show_view 的 spec 格式：{ root: string, elements: { [key]: { type, props, children?: string[] } } }',
    '可用组件：',
    ...lines,
    '数据型 props 必须写成 {"$state": "/工具名/字段路径"}，例如 {"$state": "/analyze_spending/result/byCategory"}；',
    '路径只能指向本会话已调用工具的返回结果。禁止在 spec 中写入任何金额数字，禁止提供 state 字段。',
  ].join('\n')
}
