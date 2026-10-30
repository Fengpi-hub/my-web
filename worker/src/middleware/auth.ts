// Session 与权限中间件：校验管理员身份
import { findSessionWithAdmin } from '../repositories/auth-repository'
import { readCookie, SESSION_COOKIE } from '../utils/cookies'
import { sha256Hex } from '../utils/crypto'
import { AppError } from '../utils/errors'

export interface AdminIdentity {
  id: string
  username: string
  sessionId: string
}

// 从 Cookie 读取 Session Token
export function getSessionToken(request: Request): string | null {
  return readCookie(request, SESSION_COOKIE)
}

// 校验当前请求的管理员身份；失败抛出 UNAUTHORIZED
export async function requireAdmin(
  db: D1Database,
  request: Request,
): Promise<AdminIdentity> {
  const token = getSessionToken(request)
  if (!token) {
    throw new AppError('UNAUTHORIZED', '请先登录')
  }

  const tokenHash = await sha256Hex(token)
  const row = await findSessionWithAdmin(db, tokenHash)

  if (!row || row.revoked_at !== null) {
    throw new AppError('UNAUTHORIZED', '登录状态无效')
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new AppError('UNAUTHORIZED', '登录状态已过期')
  }

  return { id: row.admin_id, username: row.username, sessionId: row.id }
}
