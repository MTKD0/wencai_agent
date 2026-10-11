import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import { env } from '#/server/env'
import * as auth from './auth-schema'
import * as schema from './schema'
import { serializeLocalClient } from './serialized-client'

// better-auth 的表由 drizzleAdapter 按 modelName 解析，需要全部挂在同一个 schema 对象上
const client = createClient({ url: env.DATABASE_URL })
export const db = drizzle({ client: env.DATABASE_URL.startsWith('file:') ? serializeLocalClient(client) : client, schema: { ...auth, ...schema } })
export type DB = typeof db
export { schema, auth }
