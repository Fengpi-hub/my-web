// 照片数据访问层
import { execute, queryAll, queryOne } from '../db/client'

export type PhotoUploadStatus =
  | 'pending'
  | 'uploading'
  | 'uploaded'
  | 'failed'
  | 'deleting'
  | 'deleted'

export interface PhotoRow {
  id: string
  r2_key: string
  thumbnail_key: string | null
  original_name: string
  mime_type: string
  file_size: number
  width: number | null
  height: number | null
  upload_status: PhotoUploadStatus
  uploaded_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface AdminPhotoListRow {
  id: string
  original_name: string
  mime_type: string
  file_size: number
  width: number | null
  height: number | null
  upload_status: PhotoUploadStatus
  uploaded_at: string | null
  created_at: string
}

export interface PhotoDiaryLinkRow {
  photo_id: string
  diary_id: string
  record_date: string
  diary_status: string
  revision_type: string
}

export interface PhotoAssociationRow {
  revision_id: string
  revision_type: string
  diary_id: string
  record_date: string
  diary_status: string
}

export interface UploadIntentRow {
  idempotency_key: string
  photo_id: string
  admin_id: string
  filename: string
  mime_type: string
  file_size: number
}

const PHOTO_COLUMNS = `id, r2_key, thumbnail_key, original_name, mime_type, file_size,
  width, height, upload_status, uploaded_at, created_at, updated_at, deleted_at`

export async function findPhotoById(
  db: D1Database,
  id: string,
): Promise<PhotoRow | null> {
  return queryOne<PhotoRow>(db, `SELECT ${PHOTO_COLUMNS} FROM photos WHERE id = ?`, [id])
}

export interface PhotoStatusRow {
  id: string
  upload_status: string
  deleted_at: string | null
}

// 批量查询照片状态（上传完成校验）
export async function findPhotoStatuses(
  db: D1Database,
  photoIds: string[],
): Promise<PhotoStatusRow[]> {
  if (photoIds.length === 0) return []
  const placeholders = photoIds.map(() => '?').join(', ')
  return queryAll<PhotoStatusRow>(
    db,
    `SELECT id, upload_status, deleted_at FROM photos WHERE id IN (${placeholders})`,
    photoIds,
  )
}

export async function insertPhoto(
  db: D1Database,
  params: {
    id: string
    r2Key: string
    originalName: string
    mimeType: string
    fileSize: number
    now: string
  },
): Promise<void> {
  await execute(
    db,
    `INSERT INTO photos (id, r2_key, thumbnail_key, original_name, mime_type, file_size,
       width, height, upload_status, uploaded_at, created_at, updated_at, deleted_at)
     VALUES (?, ?, NULL, ?, ?, ?, NULL, NULL, 'pending', NULL, ?, ?, NULL)`,
    [
      params.id,
      params.r2Key,
      params.originalName,
      params.mimeType,
      params.fileSize,
      params.now,
      params.now,
    ],
  )
}

// 标记为上传中；仅允许 pending / uploading / failed 状态重试
export async function markPhotoUploading(
  db: D1Database,
  photoId: string,
  now: string,
): Promise<number> {
  return execute(
    db,
    `UPDATE photos SET upload_status = 'uploading', updated_at = ?
      WHERE id = ? AND deleted_at IS NULL
        AND upload_status IN ('pending', 'uploading', 'failed')`,
    [now, photoId],
  )
}

export async function markPhotoUploaded(
  db: D1Database,
  params: {
    photoId: string
    mimeType: string
    fileSize: number
    width: number
    height: number
    now: string
  },
): Promise<void> {
  await execute(
    db,
    `UPDATE photos
        SET upload_status = 'uploaded', mime_type = ?, file_size = ?, width = ?, height = ?,
            uploaded_at = ?, updated_at = ?
      WHERE id = ?`,
    [
      params.mimeType,
      params.fileSize,
      params.width,
      params.height,
      params.now,
      params.now,
      params.photoId,
    ],
  )
}

export async function markPhotoFailed(
  db: D1Database,
  photoId: string,
  now: string,
): Promise<void> {
  await execute(
    db,
    `UPDATE photos SET upload_status = 'failed', updated_at = ? WHERE id = ?`,
    [now, photoId],
  )
}

export async function updateThumbnailKey(
  db: D1Database,
  photoId: string,
  thumbnailKey: string,
  now: string,
): Promise<void> {
  await execute(
    db,
    `UPDATE photos SET thumbnail_key = ?, updated_at = ? WHERE id = ?`,
    [thumbnailKey, now, photoId],
  )
}

// 管理端照片列表
export async function listAdminPhotos(
  db: D1Database,
  params: {
    limit: number
    offset: number
    keyword: string | null
    status: string | null
    diaryId: string | null
    unassociated: boolean
  },
): Promise<AdminPhotoListRow[]> {
  const { where, bindings } = buildPhotoFilters(params)
  bindings.push(params.limit, params.offset)
  return queryAll<AdminPhotoListRow>(
    db,
    `SELECT id, original_name, mime_type, file_size, width, height,
            upload_status, uploaded_at, created_at
       FROM photos p
      WHERE ${where.join(' AND ')}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?`,
    bindings,
  )
}

export async function countAdminPhotos(
  db: D1Database,
  params: {
    keyword: string | null
    status: string | null
    diaryId: string | null
    unassociated: boolean
  },
): Promise<number> {
  const { where, bindings } = buildPhotoFilters(params)
  const row = await queryOne<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total FROM photos p WHERE ${where.join(' AND ')}`,
    bindings,
  )
  return row?.total ?? 0
}

// 批量读取照片的日记归属（用于列表展示）
export async function listPhotoDiaryLinks(
  db: D1Database,
  photoIds: string[],
): Promise<PhotoDiaryLinkRow[]> {
  if (photoIds.length === 0) return []
  const placeholders = photoIds.map(() => '?').join(', ')
  return queryAll<PhotoDiaryLinkRow>(
    db,
    `SELECT DISTINCT rp.photo_id, rv.diary_id, d.record_date,
            d.status AS diary_status, rv.revision_type
       FROM revision_photos rp
       JOIN diary_revisions rv ON rv.id = rp.revision_id
       JOIN diaries d ON d.id = rv.diary_id
      WHERE rp.photo_id IN (${placeholders}) AND d.deleted_at IS NULL`,
    photoIds,
  )
}

// 照片详情：所有关联的版本与日记
export async function listPhotoAssociations(
  db: D1Database,
  photoId: string,
): Promise<PhotoAssociationRow[]> {
  return queryAll<PhotoAssociationRow>(
    db,
    `SELECT rv.id AS revision_id, rv.revision_type, rv.diary_id,
            d.record_date, d.status AS diary_status
       FROM revision_photos rp
       JOIN diary_revisions rv ON rv.id = rp.revision_id
       JOIN diaries d ON d.id = rv.diary_id
      WHERE rp.photo_id = ? AND d.deleted_at IS NULL
      ORDER BY d.record_date DESC`,
    [photoId],
  )
}

// 是否被任何有效日记的公开版本引用
export async function countPublishedReferences(
  db: D1Database,
  photoId: string,
): Promise<number> {
  const row = await queryOne<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total
       FROM revision_photos rp
       JOIN diary_revisions rv ON rv.id = rp.revision_id
       JOIN diaries d ON d.id = rv.diary_id
      WHERE rp.photo_id = ?
        AND d.deleted_at IS NULL
        AND d.published_revision_id = rv.id
        AND d.status = 'published'`,
    [photoId],
  )
  return row?.total ?? 0
}

// 是否被任何有效日记版本（含工作版本）引用
export async function countAnyReferences(
  db: D1Database,
  photoId: string,
): Promise<number> {
  const row = await queryOne<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total
       FROM revision_photos rp
       JOIN diary_revisions rv ON rv.id = rp.revision_id
       JOIN diaries d ON d.id = rv.diary_id
      WHERE rp.photo_id = ? AND d.deleted_at IS NULL`,
    [photoId],
  )
  return row?.total ?? 0
}

// 读取日记所有版本引用的照片 ID（去重）
export async function listDiaryPhotoIds(
  db: D1Database,
  diaryId: string,
): Promise<string[]> {
  const rows = await queryAll<{ photo_id: string }>(
    db,
    `SELECT DISTINCT rp.photo_id AS photo_id
       FROM revision_photos rp
       JOIN diary_revisions rv ON rv.id = rp.revision_id
      WHERE rv.diary_id = ?`,
    [diaryId],
  )
  return rows.map((row) => row.photo_id)
}

// 排除指定日记后，仍被其他有效日记版本引用的照片 ID
export async function listStillReferencedPhotoIds(
  db: D1Database,
  photoIds: string[],
  excludedDiaryId: string,
): Promise<string[]> {
  if (photoIds.length === 0) return []
  const placeholders = photoIds.map(() => '?').join(', ')
  const rows = await queryAll<{ photo_id: string }>(
    db,
    `SELECT DISTINCT rp.photo_id AS photo_id
       FROM revision_photos rp
       JOIN diary_revisions rv ON rv.id = rp.revision_id
       JOIN diaries d ON d.id = rv.diary_id
      WHERE d.deleted_at IS NULL
        AND d.id <> ?
        AND rp.photo_id IN (${placeholders})`,
    [excludedDiaryId, ...photoIds],
  )
  return rows.map((row) => row.photo_id)
}

// 为确认不再被引用的照片创建清理任务并标记为 deleting
export async function enqueuePhotoCleanup(
  db: D1Database,
  params: {
    photoIds: string[]
    now: string
    newId: () => string
  },
): Promise<void> {
  if (params.photoIds.length === 0) return

  const updates = params.photoIds.map((photoId) =>
    db
      .prepare(`UPDATE photos SET upload_status = 'deleting', updated_at = ? WHERE id = ?`)
      .bind(params.now, photoId),
  )
  const tasks = params.photoIds.map((photoId) =>
    db
      .prepare(
        `INSERT INTO photo_cleanup_tasks (id, photo_id, status, retry_count, last_error,
           created_at, updated_at)
         VALUES (?, ?, 'pending', 0, NULL, ?, ?)`,
      )
      .bind(params.newId(), photoId, params.now, params.now),
  )
  await db.batch([...updates, ...tasks])
}

export async function createCleanupTask(
  db: D1Database,
  params: { id: string; photoId: string; now: string },
): Promise<void> {
  await execute(
    db,
    `INSERT INTO photo_cleanup_tasks (id, photo_id, status, retry_count, last_error,
       created_at, updated_at)
     VALUES (?, ?, 'pending', 0, NULL, ?, ?)`,
    [params.id, params.photoId, params.now, params.now],
  )
}

export async function markCleanupTaskRunning(
  db: D1Database,
  taskId: string,
  now: string,
): Promise<void> {
  await execute(
    db,
    `UPDATE photo_cleanup_tasks SET status = 'running', updated_at = ? WHERE id = ?`,
    [now, taskId],
  )
}

export async function markCleanupTaskResult(
  db: D1Database,
  taskId: string,
  success: boolean,
  errorMessage: string | null,
  now: string,
): Promise<void> {
  if (success) {
    await execute(
      db,
      `UPDATE photo_cleanup_tasks SET status = 'completed', last_error = NULL, updated_at = ?
        WHERE id = ?`,
      [now, taskId],
    )
    return
  }
  await execute(
    db,
    `UPDATE photo_cleanup_tasks
        SET status = 'failed', retry_count = retry_count + 1, last_error = ?, updated_at = ?
      WHERE id = ?`,
    [errorMessage, now, taskId],
  )
}

export async function markPhotoDeleted(
  db: D1Database,
  photoId: string,
  now: string,
): Promise<void> {
  await execute(
    db,
    `UPDATE photos SET upload_status = 'deleted', deleted_at = ?, updated_at = ?
      WHERE id = ?`,
    [now, now, photoId],
  )
}

// 上传幂等记录
export async function findUploadIntent(
  db: D1Database,
  idempotencyKey: string,
): Promise<UploadIntentRow | null> {
  return queryOne<UploadIntentRow>(
    db,
    `SELECT idempotency_key, photo_id, admin_id, filename, mime_type, file_size
       FROM photo_upload_intents WHERE idempotency_key = ?`,
    [idempotencyKey],
  )
}

export async function insertUploadIntent(
  db: D1Database,
  params: {
    idempotencyKey: string
    photoId: string
    adminId: string
    filename: string
    mimeType: string
    fileSize: number
    now: string
  },
): Promise<void> {
  await execute(
    db,
    `INSERT INTO photo_upload_intents (idempotency_key, photo_id, admin_id, filename,
       mime_type, file_size, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      params.idempotencyKey,
      params.photoId,
      params.adminId,
      params.filename,
      params.mimeType,
      params.fileSize,
      params.now,
    ],
  )
}

// ---- 上传限流 ----

export async function countRecentUploadEvents(
  db: D1Database,
  adminId: string,
  sinceIso: string,
): Promise<number> {
  const row = await queryOne<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total FROM rate_limit_events
      WHERE identifier = ? AND action_type = 'photo_upload' AND created_at >= ?`,
    [adminId, sinceIso],
  )
  return row?.total ?? 0
}

export async function recordUploadEvent(
  db: D1Database,
  params: { id: string; adminId: string; now: string },
): Promise<void> {
  await execute(
    db,
    `INSERT INTO rate_limit_events (id, identifier, action_type, created_at)
     VALUES (?, ?, 'photo_upload', ?)`,
    [params.id, params.adminId, params.now],
  )
}

// 公开照片墙/时间轴所需的照片查询在 Phase 6 使用，此处仅提供引用校验基础

function buildPhotoFilters(params: {
  keyword: string | null
  status: string | null
  diaryId: string | null
  unassociated: boolean
}): { where: string[]; bindings: unknown[] } {
  const where: string[] = ['p.deleted_at IS NULL']
  const bindings: unknown[] = []

  if (params.status) {
    where.push('p.upload_status = ?')
    bindings.push(params.status)
  }
  if (params.keyword) {
    where.push(`p.original_name LIKE ? ESCAPE '\\'`)
    bindings.push(`%${escapeLike(params.keyword)}%`)
  }
  if (params.diaryId) {
    where.push(`EXISTS (
      SELECT 1 FROM revision_photos rp
        JOIN diary_revisions rv ON rv.id = rp.revision_id
       WHERE rp.photo_id = p.id AND rv.diary_id = ?)`)
    bindings.push(params.diaryId)
  }
  if (params.unassociated) {
    where.push(`NOT EXISTS (
      SELECT 1 FROM revision_photos rp
       WHERE rp.photo_id = p.id)`)
  }
  return { where, bindings }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}
