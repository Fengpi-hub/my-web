// 站点级数据访问：Dashboard 统计、操作日志、站点配置
import { queryAll, queryOne } from '../db/client'

export interface DiaryStatusCounts {
  published: number
  drafts: number
}

export interface PhotoAggregate {
  total: number
  storageUsed: number
}

export interface OperationLogRow {
  id: string
  action_type: string
  target_id: string | null
  summary: string
  created_at: string
}

export interface SettingRow {
  key: string
  value: string
}

// 已发布 / 草稿日记数量
export async function getDiaryStatusCounts(db: D1Database): Promise<DiaryStatusCounts> {
  const row = await queryOne<{ published: number; drafts: number }>(
    db,
    `SELECT
       SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
       SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS drafts
     FROM diaries
     WHERE deleted_at IS NULL`,
  )
  return {
    published: Number(row?.published ?? 0),
    drafts: Number(row?.drafts ?? 0),
  }
}

// 已上传照片数量与占用字节数（统计范围：未删除且上传成功的照片原图）
export async function getPhotoAggregate(db: D1Database): Promise<PhotoAggregate> {
  const row = await queryOne<{ total: number; storageUsed: number }>(
    db,
    `SELECT COUNT(*) AS total, COALESCE(SUM(file_size), 0) AS storageUsed
     FROM photos
     WHERE deleted_at IS NULL AND upload_status = 'uploaded'`,
  )
  return {
    total: Number(row?.total ?? 0),
    storageUsed: Number(row?.storageUsed ?? 0),
  }
}

// 最近操作记录
export async function listRecentLogs(db: D1Database, limit: number): Promise<OperationLogRow[]> {
  return queryAll<OperationLogRow>(
    db,
    `SELECT id, action_type, target_id, summary, created_at
     FROM operation_logs
     ORDER BY created_at DESC
     LIMIT ?`,
    [limit],
  )
}

// 分页查询操作记录
export async function listLogs(
  db: D1Database,
  params: {
    limit: number
    offset: number
    actionType: string | null
    startDate: string | null
    endDate: string | null
  },
): Promise<{ rows: OperationLogRow[]; total: number }> {
  const where: string[] = []
  const bindings: unknown[] = []

  if (params.actionType) {
    where.push('action_type = ?')
    bindings.push(params.actionType)
  }
  if (params.startDate) {
    where.push('created_at >= ?')
    bindings.push(params.startDate)
  }
  if (params.endDate) {
    where.push('created_at <= ?')
    bindings.push(params.endDate)
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const [rows, total] = await Promise.all([
    queryAll<OperationLogRow>(
      db,
      `SELECT id, action_type, target_id, summary, created_at
       FROM operation_logs
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...bindings, params.limit, params.offset],
    ),
    queryOne<{ count: number }>(
      db,
      `SELECT COUNT(*) AS count FROM operation_logs ${whereSql}`,
      bindings,
    ),
  ])

  return { rows, total: Number(total?.count ?? 0) }
}

// 读取全部站点配置
export async function listSettings(db: D1Database): Promise<SettingRow[]> {
  return queryAll<SettingRow>(db, 'SELECT key, value FROM site_settings ORDER BY key')
}

// 批量写入站点配置
export async function saveSettings(
  db: D1Database,
  entries: Array<{ key: string; value: string }>,
  now: string,
): Promise<void> {
  if (entries.length === 0) return
  await db.batch(
    entries.map((entry) =>
      db
        .prepare(
          `INSERT INTO site_settings (key, value, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .bind(entry.key, entry.value, now),
    ),
  )
}

// 清理三个月前的操作日志（服务端维护保留期）
export async function deleteLogsBefore(db: D1Database, before: string): Promise<number> {
  const result = await db
    .prepare('DELETE FROM operation_logs WHERE created_at < ?')
    .bind(before)
    .run()
  return result.meta.changes ?? 0
}
