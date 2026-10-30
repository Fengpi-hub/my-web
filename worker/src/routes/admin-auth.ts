// 管理员认证路由：初始化 / 登录 / 状态 / 退出 / 修改密码
import type { Env } from '../env'
import type { RouteHandler, Router } from '../utils/router'
import { AppError } from '../utils/errors'
import { json } from '../utils/response'
import { newId, nowIso } from '../utils/id'
import { randomToken, sha256Hex, timingSafeStringEqual } from '../utils/crypto'
import { buildSessionCookie, clearSessionCookie } from '../utils/cookies'
import { getSessionToken, requireAdmin } from '../middleware/auth'
import { verifyTrustedOrigin } from '../middleware/csrf'
import {
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from '../services/password'
import * as authRepo from '../repositories/auth-repository'

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 天
const RATE_WINDOW_MS = 15 * 60 * 1000 // 15 分钟
const RATE_MAX_FAILURES = 5

export function registerAdminAuthRoutes(router: Router<Env>): void {
  router.post('/api/admin/setup', handleSetup)
  router.post('/api/admin/auth/login', handleLogin)
  router.get('/api/admin/auth/me', handleMe)
  router.post('/api/admin/auth/logout', handleLogout)
  router.post('/api/admin/auth/change-password', handleChangePassword)
}

// 首次管理员初始化
const handleSetup: RouteHandler<Env> = async ({ request, env }) => {
  verifyTrustedOrigin(request, env.APP_ORIGIN)
  const db = env.DB
  const ip = clientIp(request)
  const setupIdentifier = `setup:ip:${ip}`
  await enforceRateLimit(db, setupIdentifier, 'setup')

  const body = await readJsonBody(request)
  const setupToken = getString(body, 'setupToken') ?? ''
  const username = getString(body, 'username') ?? ''
  const password = getString(body, 'password') ?? ''

  const expectedToken = env.ADMIN_SETUP_TOKEN
  if (!expectedToken || !timingSafeStringEqual(setupToken, expectedToken)) {
    await recordFailureSafe(db, setupIdentifier, 'setup')
    throw new AppError('FORBIDDEN', '初始化凭据无效')
  }

  if (await authRepo.hasAnyAdmin(db)) {
    throw new AppError('FORBIDDEN', '系统已完成初始化')
  }

  validateUsername(username)
  const passwordError = validatePasswordStrength(password)
  if (passwordError) {
    throw new AppError('VALIDATION_ERROR', passwordError)
  }

  const id = newId()
  const now = nowIso()
  const passwordHash = await hashPassword(password)
  await authRepo.createAdmin(db, { id, username, passwordHash, now })
  await authRepo.clearFailures(db, setupIdentifier, 'setup')
  await authRepo.insertOperationLog(db, {
    id: newId(),
    adminId: null,
    actionType: 'admin_setup',
    targetId: id,
    summary: `初始化管理员 ${sanitizeForLog(username)}`,
    now,
  })

  return json({ initialized: true, admin: { id, username } })
}

// 登录
const handleLogin: RouteHandler<Env> = async ({ request, env, url }) => {
  verifyTrustedOrigin(request, env.APP_ORIGIN)
  const db = env.DB
  const ip = clientIp(request)
  const body = await readJsonBody(request)
  const username = getString(body, 'username') ?? ''
  const password = getString(body, 'password') ?? ''

  const identifiers = [`login:ip:${ip}`, `login:user:${username}`]
  await enforceRateLimits(db, identifiers, 'login')

  const admin = await authRepo.findAdminByUsername(db, username)
  const valid = admin ? await verifyPassword(password, admin.password_hash) : false

  if (!admin || !valid) {
    const now = nowIso()
    for (const identifier of identifiers) {
      await recordFailureSafe(db, identifier, 'login')
    }
    await authRepo.insertOperationLog(db, {
      id: newId(),
      adminId: null,
      actionType: 'login_failed',
      targetId: null,
      summary: `登录失败 ip=${ip} username=${sanitizeForLog(username)}`,
      now,
    })
    throw new AppError('UNAUTHORIZED', '用户名或密码错误')
  }

  for (const identifier of identifiers) {
    await authRepo.clearFailures(db, identifier, 'login')
  }

  // 每次登录重新生成 Session，避免会话固定
  const token = randomToken(32)
  const tokenHash = await sha256Hex(token)
  const now = nowIso()
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString()
  await authRepo.createSession(db, {
    id: newId(),
    adminId: admin.id,
    tokenHash,
    createdAt: now,
    expiresAt,
  })
  await authRepo.insertOperationLog(db, {
    id: newId(),
    adminId: admin.id,
    actionType: 'login_success',
    targetId: admin.id,
    summary: `管理员登录 ip=${ip}`,
    now,
  })

  const secure = url.protocol === 'https:'
  return json(
    { admin: { id: admin.id, username: admin.username } },
    200,
    { 'Set-Cookie': buildSessionCookie(token, SESSION_TTL_SECONDS, secure) },
  )
}

// 获取登录状态（只读，无需 CSRF）
const handleMe: RouteHandler<Env> = async ({ request, env }) => {
  const db = env.DB
  const token = getSessionToken(request)
  if (!token) {
    return json({ authenticated: false })
  }
  const tokenHash = await sha256Hex(token)
  const row = await authRepo.findSessionWithAdmin(db, tokenHash)
  if (!row || row.revoked_at !== null || new Date(row.expires_at).getTime() <= Date.now()) {
    return json({ authenticated: false })
  }
  return json({
    authenticated: true,
    admin: { id: row.admin_id, username: row.username },
  })
}

// 退出登录
const handleLogout: RouteHandler<Env> = async ({ request, env, url }) => {
  verifyTrustedOrigin(request, env.APP_ORIGIN)
  const db = env.DB
  const token = getSessionToken(request)
  if (token) {
    const tokenHash = await sha256Hex(token)
    const row = await authRepo.findSessionWithAdmin(db, tokenHash)
    if (row && row.revoked_at === null) {
      const now = nowIso()
      await authRepo.revokeSession(db, row.id, now)
      await authRepo.insertOperationLog(db, {
        id: newId(),
        adminId: row.admin_id,
        actionType: 'logout',
        targetId: null,
        summary: '管理员退出登录',
        now,
      })
    }
  }
  const secure = url.protocol === 'https:'
  return json({ loggedOut: true }, 200, { 'Set-Cookie': clearSessionCookie(secure) })
}

// 修改密码
const handleChangePassword: RouteHandler<Env> = async ({ request, env, url }) => {
  verifyTrustedOrigin(request, env.APP_ORIGIN)
  const db = env.DB
  const admin = await requireAdmin(db, request)
  const body = await readJsonBody(request)
  const currentPassword = getString(body, 'currentPassword') ?? ''
  const newPassword = getString(body, 'newPassword') ?? ''

  const adminRow = await authRepo.findAdminById(db, admin.id)
  if (!adminRow) {
    throw new AppError('UNAUTHORIZED', '登录状态无效')
  }

  const valid = await verifyPassword(currentPassword, adminRow.password_hash)
  if (!valid) {
    throw new AppError('VALIDATION_ERROR', '当前密码不正确')
  }

  const passwordError = validatePasswordStrength(newPassword)
  if (passwordError) {
    throw new AppError('VALIDATION_ERROR', passwordError)
  }

  const now = nowIso()
  const passwordHash = await hashPassword(newPassword)
  await authRepo.updateAdminPassword(db, admin.id, passwordHash, now)
  await authRepo.revokeAllSessionsForAdmin(db, admin.id, now)
  await authRepo.insertOperationLog(db, {
    id: newId(),
    adminId: admin.id,
    actionType: 'change_password',
    targetId: admin.id,
    summary: '修改密码并撤销所有会话',
    now,
  })

  const secure = url.protocol === 'https:'
  return json({ changed: true }, 200, { 'Set-Cookie': clearSessionCookie(secure) })
}

// ---- 工具 ----

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json()
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>
    }
  } catch {
    // 忽略解析失败，统一抛出校验错误
  }
  throw new AppError('VALIDATION_ERROR', '请求体格式不正确')
}

function getString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key]
  return typeof value === 'string' ? value : null
}

function validateUsername(username: string): void {
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(username)) {
    throw new AppError('VALIDATION_ERROR', '用户名需为 3-64 位字母、数字、下划线或连字符')
  }
}

function clientIp(request: Request): string {
  const cfIp = request.headers.get('CF-Connecting-IP')
  if (cfIp) return cfIp
  const forwarded = request.headers.get('X-Forwarded-For')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  return 'unknown'
}

async function enforceRateLimits(
  db: D1Database,
  identifiers: string[],
  attemptType: string,
): Promise<void> {
  for (const identifier of identifiers) {
    await enforceRateLimit(db, identifier, attemptType)
  }
}

async function enforceRateLimit(
  db: D1Database,
  identifier: string,
  attemptType: string,
): Promise<void> {
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString()
  const failures = await authRepo.countRecentFailures(db, identifier, attemptType, since)
  if (failures >= RATE_MAX_FAILURES) {
    throw new AppError('RATE_LIMITED', '尝试次数过多，请稍后再试')
  }
}

async function recordFailureSafe(
  db: D1Database,
  identifier: string,
  attemptType: string,
): Promise<void> {
  await authRepo.recordFailure(db, {
    id: newId(),
    identifier,
    attemptType,
    now: nowIso(),
  })
}

function sanitizeForLog(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64)
}
