import { drizzle } from 'drizzle-orm/libsql'
import { env } from '#/server/env'
import * as auth from './auth-schema'
import * as schema from './schema'

// better-auth 的表由 drizzleAdapter 按 modelName 解析，需要全部挂在同一个 schema 对象上
export const db = drizzle({ connection: { url: env.DATABASE_URL }, schema: { ...auth, ...schema } })
export type DB = typeof db
export { schema, auth }
