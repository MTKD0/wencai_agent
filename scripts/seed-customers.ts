/** 只追加：为后台演示生成合成客户与反诈案例。不清空、不重置；重复执行不会重复写入。 */
import { eq } from 'drizzle-orm'
import { db, schema } from '../src/server/db/client'
import { FRAUD_CASE_COUNT, seedDemoCustomers } from '../src/server/db/seed-customers'

if (!process.argv.includes('--append-demo')) {
  console.error('仅追加合成演示数据：pnpm exec tsx scripts/seed-customers.ts --append-demo')
  process.exit(1)
}
// 以业务时钟为准，案例的冷静期到期时间才会落在演示时刻之后
const [clock] = await db.select().from(schema.settings).where(eq(schema.settings.key, 'clock'))
const now = clock ? new Date(clock.value) : new Date()
const added = await seedDemoCustomers(now)
console.log(added ? `已追加 24 位合成客户与 ${FRAUD_CASE_COUNT} 个反诈案例（业务时间 ${now.toISOString()}）` : '合成客户已存在，未重复写入')
process.exit(0)
