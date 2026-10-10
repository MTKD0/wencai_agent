import { z } from 'zod'

export const PlanNodeSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,24}$/),
  kind: z.enum(['tool', 'handoff']).default('tool'),
  tool: z.string().optional().describe('kind=tool 时必填'),
  args: z.record(z.string(), z.unknown()).default({}).describe('可用 {"$ref":"节点id.字段路径"} 引用依赖节点的输出'),
  dependsOn: z.array(z.string()).default([]),
  note: z.string().max(100).optional().describe('给用户看的步骤说明'),
})

export const PlanSchema = z.object({
  goal: z.string().max(200),
  nodes: z.array(PlanNodeSchema).min(1).max(12),
})

export type PlanNode = z.infer<typeof PlanNodeSchema>
export type Plan = z.infer<typeof PlanSchema>

export type PlanValidation = { ok: true; plan: Plan; order: string[] } | { ok: false; errors: string[] }

/** 结构校验：唯一 ID、依赖存在、无环、工具在白名单内、$ref 只能引用直接依赖 */
export function validatePlan(input: unknown, allowedTools: Set<string>): PlanValidation {
  const parsed = PlanSchema.safeParse(input)
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
  const plan = parsed.data
  const errors: string[] = []
  const ids = new Set<string>()

  for (const n of plan.nodes) {
    if (ids.has(n.id)) errors.push(`节点 ID 重复：${n.id}`)
    ids.add(n.id)
  }
  for (const n of plan.nodes) {
    if (n.kind === 'tool' && (!n.tool || !allowedTools.has(n.tool))) errors.push(`节点 ${n.id} 使用了不可用的工具：${n.tool}`)
    for (const d of n.dependsOn) if (!ids.has(d)) errors.push(`节点 ${n.id} 依赖不存在的节点 ${d}`)
    for (const ref of collectRefs(n.args)) {
      const src = ref.split('.')[0]
      if (!n.dependsOn.includes(src)) errors.push(`节点 ${n.id} 引用了非直接依赖 ${src}`)
    }
  }
  if (errors.length) return { ok: false, errors }

  const order = topoSort(plan.nodes)
  if (!order) return { ok: false, errors: ['计划存在循环依赖'] }
  return { ok: true, plan, order }
}

export function topoSort(nodes: Pick<PlanNode, 'id' | 'dependsOn'>[]): string[] | null {
  const indeg = new Map(nodes.map((n) => [n.id, n.dependsOn.length]))
  const children = new Map<string, string[]>()
  for (const n of nodes) for (const d of n.dependsOn) children.set(d, [...(children.get(d) ?? []), n.id])
  const queue = nodes.filter((n) => n.dependsOn.length === 0).map((n) => n.id)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    order.push(id)
    for (const c of children.get(id) ?? []) {
      indeg.set(c, indeg.get(c)! - 1)
      if (indeg.get(c) === 0) queue.push(c)
    }
  }
  return order.length === nodes.length ? order : null
}

export function isRef(v: unknown): v is { $ref: string } {
  return !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { $ref?: unknown }).$ref === 'string' && Object.keys(v).length === 1
}

function collectRefs(v: unknown, out: string[] = []): string[] {
  if (isRef(v)) out.push(v.$ref)
  else if (Array.isArray(v)) v.forEach((x) => collectRefs(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => collectRefs(x, out))
  return out
}
