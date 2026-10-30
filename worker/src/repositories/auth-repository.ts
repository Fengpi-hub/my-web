// 认证相关数据访问（管理员、会话、限流、操作日志）
import { execute, queryOne } from '../db/client'

export interface AdminRow {
  id: string
  username: string
  password_hash: string
  password_changed_at: string
}

export interface SessionWithAdminRow {
  id: string
  admin_id: string
  username: string
  expires_at: string
  revoked_at: string | null
}

export async function hasAnyAdmin(db: D1Database): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    db,
    'SELECT id FROM admin_users LIMIT 1',
  )
  return row !== null
}

export async function createAdmin(
  db: D1Database,
  params: { id: string; username: string; passwordHash: string; now: string },
): Promise<void> {
  await execute(
    db,
    `INSERT INTO admin_users (id, username, password_hash, created_at, updated_at, password_changed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [params.id, params.username, params.passwordHash, params.now, params.now, params.now],
  )
}

export async function findAdminByUsername(
  db: D1Database,
  username: string,
): Promise<AdminRow | null> {
  return queryOne<AdminRow>(
    db,
    `SELECT id, username, password_hash, password_changed_at
       FROM admin_users WHERE username = ?`,
    [username],
  )
}

export async function findAdminById(
  db: D1Database,
  id: string,
): Promise<AdminRow | null> {
  return queryOne<AdminRow>(
    db,
    `SELECT id, username, password_hash, password_changed_at
       FROM admin_users WHERE id = ?`,
    [id],
  )
}

export async function updateAdminPassword(
  db: D1Database,
  adminId: string,
  passwordHash: string,
  now: string,
): Promise<void> {
  await execute(
    db,
    `UPDATE admin_users
        SET password_hash = ?, password_changed_at = ?, updated_at = ?
      WHERE id = ?`,
    [passwordHash, now, now, adminId],
  )
}

export async function createSession(
  db: D1Database,
  params: { id: string; adminId: string; tokenHash: string; createdAt: string; expiresAt: string },
): Promise<void> {
  await execute(
    db,
    `INSERT INTO admin_sessions (id, admin_id, token_hash, created_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
    [params.id, params.adminId, params.tokenHash, params.createdAt, params.expiresAt],
  )
}

export async function findSessionWithAdmin(
  db: D1Database,
  tokenHash: string,
): Promise<SessionWithAdminRow | null> {
  return queryOne<SessionWithAdminRow>(
    db,
    `SELECT s.id, s.admin_id, u.username, s.expires_at, s.revoked_at
       FROM admin_sessions s
       JOIN admin_users u ON u.id = s.admin_id
      WHERE s.token_hash = ?`,
    [tokenHash],
  )
}

export async function revokeSession(
  db: D1Database,
  sessionId: string,
  now: string,
): Promise<void> {
  await execute(
    db,
    `UPDATE admin_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
    [now, sessionId],
  )
}

export async function revokeAllSessionsForAdmin(
  db: D1Database,
  adminId: string,
  now: string,
): Promise<void> {
  await execute(
    db,
    `UPDATE admin_sessions SET revoked_at = ? WHERE admin_id = ? AND revoked_at IS NULL`,
    [now, adminId],
  )
}

// ---- 限流 ----

export async function countRecentFailures(
  db: D1Database,
  identifier: string,
  attemptType: string,
  sinceIso: string,
): Promise<number> {
  const row = await queryOne<{ count: number }>(
    db,
    `SELECT COUNT(*) AS count FROM login_attempts
      WHERE identifier = ? AND attempt_type = ? AND success = 0 AND created_at >= ?`,
    [identifier, attemptType, sinceIso],
  )
  return row?.count ?? 0
}

export async function recordFailure(
  db: D1Database,
  params: { id: string; identifier: string; attemptType: string; now: string },
): Promise<void> {
  await execute(
    db,
    `INSERT INTO login_attempts (id, identifier, attempt_type, success, created_at)
     VALUES (?, ?, ?, 0, ?)`,
    [params.id, params.identifier, params.attemptType, params.now],
  )
}

export async function clearFailures(
  db: D1Database,
  identifier: string,
  attemptType: string,
): Promise<void> {
  await execute(
    db,
    `DELETE FROM login_attempts WHERE identifier = ? AND attempt_type = ?`,
    [identifier, attemptType],
  )
}

// ---- 操作日志 ----
export async function insertOperationLog(
  db: D1Database,
  params: {
    id: string
    adminId: string | null
    actionType: string
    targetId: string | null
    summary: string
    now: string
  },
): Promise<void> {
  await execute(
    db,
    `INSERT INTO operation_logs (id, admin_id, action_type, target_id, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [params.id, params.adminId, params.actionType, params.targetId, params.summary, params.now],
  )
}
