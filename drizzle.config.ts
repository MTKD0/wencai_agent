import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  // 业务表与认证表（better-auth / Passkey）一起推送
  schema: ['./src/server/db/schema.ts', './src/server/db/auth-schema.ts'],
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'file:./data/bank.db' },
})
