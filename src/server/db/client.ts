import { drizzle } from 'drizzle-orm/libsql'
import { env } from '#/server/env'
import * as schema from './schema'

export const db = drizzle({ connection: { url: env.DATABASE_URL }, schema })
export type DB = typeof db
export { schema }
