import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { and, eq } from 'drizzle-orm'
import { consumeChallenge } from './challenge'
import { auth as authTables, db } from '#/server/db/client'
import { env } from '#/server/env'
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'

/**
 * Passkey 强验证（WebAuthn）。
 * 用于红色操作：比交易密码更强的实人核验，也作为未来「人脸核验」的挂载点。
 */

const RP_ID = new URL(env.PUBLIC_BASE_URL).hostname
const ORIGIN = env.PUBLIC_BASE_URL

export async function registrationOptions(userId: string, userName: string) {
  const existing = await db.select().from(authTables.passkeys).where(eq(authTables.passkeys.userId, userId))
  return generateRegistrationOptions({
    rpName: '文财',
    rpID: RP_ID,
    userID: new TextEncoder().encode(userId),
    userName,
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports ? (JSON.parse(p.transports) as never) : undefined })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  })
}

export async function verifyRegistration(userId: string, response: RegistrationResponseJSON, expectedChallenge: string) {
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    requireUserVerification: false,
  })
  if (!verification.verified || !verification.registrationInfo) return false
  const { credential } = verification.registrationInfo
  await db.insert(authTables.passkeys).values({
    id: `pk_${credential.id}`,
    userId,
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports ? JSON.stringify(credential.transports) : null,
    createdAt: new Date(),
  })
  return true
}

export async function authenticationOptions(userId: string) {
  const credentials = await db.select().from(authTables.passkeys).where(eq(authTables.passkeys.userId, userId))
  if (!credentials.length) return null
  return generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: credentials.map((p) => ({ id: p.credentialId, transports: p.transports ? (JSON.parse(p.transports) as never) : undefined })),
    userVerification: 'preferred',
  })
}

/** 校验 Passkey 签名，成功则推进计数器（防重放） */
export async function verifyPasskeyAssertion(userId: string, response: unknown): Promise<boolean> {
  if (!response || typeof response !== 'object') return false
  const assertion = response as AuthenticationResponseJSON
  if (!assertion.id) return false
  const [row] = await db
    .select()
    .from(authTables.passkeys)
    .where(and(eq(authTables.passkeys.userId, userId), eq(authTables.passkeys.credentialId, assertion.id)))
  if (!row) return false

  // challenge 由 /api/passkey/options 签发并缓存在内存，见 challenge.ts
  const expectedChallenge = consumeChallenge(userId, 'auth')
  if (!expectedChallenge) return false

  const verification = await verifyAuthenticationResponse({
    response: assertion,
    expectedChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    credential: {
      id: row.credentialId,
      publicKey: new Uint8Array(Buffer.from(row.publicKey, 'base64url')),
      counter: row.counter,
      transports: row.transports ? (JSON.parse(row.transports) as never) : undefined,
    },
    requireUserVerification: false,
  })
  if (!verification.verified) return false
  await db.update(authTables.passkeys).set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() }).where(eq(authTables.passkeys.id, row.id))
  return true
}

export async function listPasskeys(userId: string) {
  const rows = await db.select().from(authTables.passkeys).where(eq(authTables.passkeys.userId, userId))
  return rows.map((r) => ({ id: r.id, deviceType: r.deviceType, backedUp: r.backedUp, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt }))
}

export async function deletePasskey(userId: string, id: string): Promise<boolean> {
  const res = await db.delete(authTables.passkeys).where(and(eq(authTables.passkeys.id, id), eq(authTables.passkeys.userId, userId))).returning({ id: authTables.passkeys.id })
  return res.length > 0
}

export async function hasPasskey(userId: string): Promise<boolean> {
  const [row] = await db.select({ id: authTables.passkeys.id }).from(authTables.passkeys).where(eq(authTables.passkeys.userId, userId)).limit(1)
  return !!row
}
