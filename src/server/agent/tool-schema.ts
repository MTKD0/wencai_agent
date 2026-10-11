import { asSchema, jsonSchema } from 'ai'
import type { FlexibleSchema } from 'ai'

/** DeepSeek 要求函数参数根节点显式为 object；保留联合分支及原始运行时校验。 */
export function modelToolSchema<T>(input: FlexibleSchema<T>) {
  const schema = asSchema(input)
  return jsonSchema<T>(async () => ({ ...(await schema.jsonSchema), type: 'object' }), {
    validate: schema.validate,
  })
}
