if (!process.env.DATABASE_URL?.includes('dbconcurrent-')) throw new Error('isolated audit fixture required')
const { audit } = await import('../../src/server/audit/log')
const { db } = await import('../../src/server/db/client')
for (let i = 0; i < 20; i++) await audit({ userId: 'concurrency', sessionId: `writer-${process.pid}`, channel: 'web' }, 'tool_result', { index: i })
db.$client.close()
export {}
