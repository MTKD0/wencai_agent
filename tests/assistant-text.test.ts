import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AssistantText, { duplicatesTable, presentedTables } from '#/components/chat/AssistantText'
import type { PresentedTable } from '#/components/chat/AssistantText'
import ToolPart from '#/components/chat/ToolPart'
import type { WencaiUIMessage } from '#/server/agent/messages'

const table: PresentedTable = { headers: ['日期', '商户', '类别', '金额（元）'], rows: [
  ['2026-10-01', '王建国', '转账', '281.09'], ['2026-10-04', '网约车', '交通', '264.33'],
] }
const markdown = '本月最高的支出如下：\n\n| 日期 | 对方 | 分类 | 金额 |\n| --- | --- | --- | ---: |\n| 10-01 | **王建国** | 转账 | ¥281.09 |\n| 10-04 | 网约车 | 交通 | ¥264.33 |\n\n转账和交通金额较高。'
const render = (text: string, tables: PresentedTable[] = [], processing = false) =>
  renderToStaticMarkup(createElement(AssistantText, { text, tables, processing }))
const viewPart = {
  type: 'tool-show_view' as const, toolCallId: 'v', state: 'output-available' as const,
  output: { status: 'view', spec: { root: 'table', state: { analyze_spending: { result: { top: table.rows.map(([date, counterparty, category, amount]) => ({ date, counterparty, category, amount: Number(amount) })) } } },
    elements: { table: { type: 'Table', props: { rows: { $state: '/analyze_spending/result/top' },
      columns: ['date', 'counterparty', 'category', 'amount'].map((key, i) => ({ key, label: table.headers[i] })),
    }, children: [] } },
  } },
}
const parts = [viewPart] as unknown as WencaiUIMessage['parts']

describe('Agent 文字表格与生成式结果', () => {
  it('截图场景：生成式交易明细后相同 Markdown 表格只展示一次，保留结论', () => {
    const tables = presentedTables(parts, ['result'])
    const html = renderToStaticMarkup(createElement(Fragment, {},
      createElement(ToolPart, { part: viewPart, onFollowUp: () => {} }),
      createElement(AssistantText, { text: markdown, tables })))
    expect(html.match(/<table/g)).toHaveLength(1)
    expect(html).toContain('281.09')
    expect(html).toContain('转账和交通金额较高。')
    expect(html).not.toMatch(/Copy table|Download table|Fullscreen/)
  })
  it('没有生成式明细时，Markdown 表格保留并复用银行表格样式', () => {
    const html = render(markdown)
    expect(html.match(/<table/g)).toHaveLength(1)
    expect(html).toContain('bank-chat-table')
    expect(html).toContain('王建国')
    expect(html).not.toMatch(/<button|<svg/)
  })
  it('有图表但无生成式表格时，不删除文字中的必要明细', () => {
    const chart = structuredClone(viewPart) as unknown as { output: { spec: { elements: Record<string, unknown> } } }
    chart.output.spec.elements.table = { type: 'BarChart', props: {}, children: [] }
    expect(presentedTables([chart] as unknown as WencaiUIMessage['parts'], ['result'])).toEqual([])
    expect(render(markdown).match(/<table/g)).toHaveLength(1)
  })
  it('流式处理中推迟文字表格，完成后无卡片时正常显示', () => {
    expect(render(markdown, [], true)).not.toContain('<table')
    expect(render(markdown, [], true)).toContain('转账和交通金额较高。')
    expect(render(markdown)).toContain('<table')
  })
  it('不同金额、更多行或额外列包含新信息，不能隐藏', () => {
    expect(render(markdown.replace('281.09', '999.00'), [table])).toContain('<table')
    expect(render(markdown.replace('| 10-04', '| 10-02 | 咖啡 | 餐饮 | ¥18 |\n| 10-04'), [table])).toContain('<table')
    expect(duplicatesTable({ ...table, headers: [...table.headers, '备注'], rows: table.rows.map((row) => [...row, '新信息']) }, table)).toBe(false)
  })
  it('列顺序、行顺序、日期缩写与金额格式不同仍能识别相同明细', () => {
    const rearranged = { headers: ['金额', '分类', '交易日期', '对方'], rows: [
      ['￥264.330元', '交通', '10-04', '网约车'], ['281.09', '转账', '10-01', '王建国'],
    ] }
    expect(duplicatesTable(rearranged, table)).toBe(true)
    expect(duplicatesTable(rearranged, { ...table, headers: ['日期', '商户/对方', '类别', '金额（元）'] })).toBe(true)
    expect(duplicatesTable({ headers: ['金额'], rows: [['¥1,234.50']] }, { headers: ['金额'], rows: [['1234.5']] })).toBe(true)
  })
  it('保留重复行次数，不把金额巧合相同的收入和支出合并', () => {
    expect(duplicatesTable({ headers: ['金额'], rows: [['1'], ['1']] }, { headers: ['金额'], rows: [['1'], ['2']] })).toBe(false)
    expect(duplicatesTable({ headers: ['收入'], rows: [['100']] }, { headers: ['支出'], rows: [['100']] })).toBe(false)
    expect(duplicatesTable({ headers: ['账号'], rows: [['00123']] }, { headers: ['账号'], rows: [['123']] })).toBe(false)
    expect(duplicatesTable({ headers: ['账号'], rows: [['9900000000000001']] }, { headers: ['账号'], rows: [['9900000000000000']] })).toBe(false)
  })
  it('隐藏的、未挂载的和失败的生成式视图不能吞掉文字表格', () => {
    expect(presentedTables(parts, ['hidden'])).toEqual([])
    expect(presentedTables(parts, ['status'])).toEqual([])
    const orphan = structuredClone(viewPart)
    orphan.output.spec.root = 'absent'
    expect(presentedTables([orphan] as unknown as WencaiUIMessage['parts'], ['result'])).toEqual([])
    const invalid = { ...viewPart, output: { status: 'invalid_view' } }
    expect(presentedTables([invalid] as unknown as WencaiUIMessage['parts'], ['result'])).toEqual([])
  })
  it('正文说明、链接与代码中的表格语法保持原样', () => {
    const html = render('查看 [详情](/)。\n\n```text\n| 日期 | 金额 |\n| --- | --- |\n| 10-01 | 281.09 |\n```', [table])
    expect(html).toContain('<pre')
    expect(html).toContain('281.09')
    expect(html).toContain('详情')
  })
})
