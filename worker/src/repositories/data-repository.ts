// 数据管理仓储：导出查询、任务记录与合并恢复写入
import { execute, queryAll, queryOne } from '../db/client'

export interface DataTaskRow {
  id: string
  task_type: 'export' | 'import'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  scope: string | null
  r2_key: string | null
  progress: number
  result_summary: string | null
  error_message: string | null
  created_at: string
  updated_at: string
  expires_at: string | null
}

export interface ExportDiaryRow {
  id: string
  record_date: string
  status: string
  created_at: string
  updated_at: string
  published_at: string | null
  published_revision_id: string | null
  draft_revision_id: string | null
  pub_content: string | null
  pub_version: number | null
  pub_created_at: string | null
  pub_updated_at: string | null
  draft_content: string | null
  draft_version: number | null
  draft_created_at: string | null
  draft_updated_at: string | null
}

export interface PhotoMediaRow {
  id: string
  r2_key: string
  original_name: string
  mime_type: string
  file_size: number
  width: number | null
  height: number | null
  upload_status: string
  uploaded_at: string | null
  created_at: string
  deleted_at: string | null
}

export interface ImportDiaryBundle {
  diaryId: string
  recordDate: string
  status: 'draft' | 'published'
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  publishedRevisionId: string | null
  draftRevisionId: string | null
  revisions: Array<{
    id: string
    content: string
    revisionType: 'working' | 'published'
    version: number
    createdAt: string
    updatedAt: string
  }>
  revisionPhotos: Array<{ revisionId: string; photoId: string; sortOrder: number }>
}

export interface ImportPhotoBundle {
  id: string
  r2Key: string
  originalName: string
  mimeType: string
  fileSize: number
  width: number | null
  height: number | null
  uploadedAt: string | null
  createdAt: string
}

// ---- 任务记录 ----

export async function createDataTask(
  db: D1Database,
  params: {
    id: string
    taskType: 'export' | 'import'
    status: 'pending' | 'running'
    scope: string | null
    now: string
    expiresAt?: string | null
  },
): Promise<void> {
  await execute(
    db,
    `INSERT INTO data_tasks (id, task_type, status, scope, r2_key, progress, result_summary,
       error_message, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, NULL, 0, NULL, NULL, ?, ?, ?)`,
    [
      params.id,
      params.taskType,
      params.status,
      params.scope,
      params.now,
      params.now,
      params.expiresAt ?? null,
    ],
  )
}

export async function findDataTask(
  db: D1Database,
  id: string,
): Promise<DataTaskRow | null> {
  return queryOne<DataTaskRow>(db, 'SELECT * FROM data_tasks WHERE id = ?', [id])
}

export async function updateTaskProgress(
  db: D1Database,
  id: string,
  progress: number,
  now: string,
): Promise<void> {
  await execute(
    db,
    'UPDATE data_tasks SET status = ?, progress = ?, updated_at = ? WHERE id = ?',
    ['running', Math.min(100, Math.max(0, Math.round(progress))), now, id],
  )
}

export async function completeDataTask(
  db: D1Database,
  params: {
    id: string
    summary: string
    now: string
    r2Key?: string | null
    expiresAt?: string | null
  },
): Promise<void> {
  await execute(
    db,
    `UPDATE data_tasks
        SET status = 'completed', progress = 100, result_summary = ?,
            r2_key = COALESCE(?, r2_key), expires_at = COALESCE(?, expires_at),
            error_message = NULL, updated_at = ?
      WHERE id = ?`,
    [params.summary, params.r2Key ?? null, params.expiresAt ?? null, params.now, params.id],
  )
}

// 恢复预览：将上传任务转为待确认的预览任务
export async function markTaskPreview(
  db: D1Database,
  params: { id: string; summary: string; now: string; expiresAt: string },
): Promise<void> {
  await execute(
    db,
    `UPDATE data_tasks
        SET status = 'pending', scope = 'preview', progress = 0,
            result_summary = ?, expires_at = ?, updated_at = ?
      WHERE id = ?`,
    [params.summary, params.expiresAt, params.now, params.id],
  )
}

export async function failDataTask(
  db: D1Database,
  id: string,
  message: string,
  now: string,
): Promise<void> {
  await execute(
    db,
    `UPDATE data_tasks
        SET status = 'failed', error_message = ?, updated_at = ?
      WHERE id = ?`,
    [message.slice(0, 500), now, id],
  )
}

export async function clearTaskR2Key(db: D1Database, id: string): Promise<void> {
  await execute(db, 'UPDATE data_tasks SET r2_key = NULL WHERE id = ?', [id])
}

// ---- 导出查询 ----

const EXPORT_DIARY_SQL = `
  SELECT d.id, d.record_date, d.status, d.created_at, d.updated_at, d.published_at,
         d.published_revision_id, d.draft_revision_id,
         pub.content AS pub_content, pub.revision_version AS pub_version,
         pub.created_at AS pub_created_at, pub.updated_at AS pub_updated_at,
         draft.content AS draft_content, draft.revision_version AS draft_version,
         draft.created_at AS draft_created_at, draft.updated_at AS draft_updated_at
    FROM diaries d
    LEFT JOIN diary_revisions pub ON pub.id = d.published_revision_id
    LEFT JOIN diary_revisions draft ON draft.id = d.draft_revision_id
   WHERE d.deleted_at IS NULL`

export async function listExportDiaries(
  db: D1Database,
  scope: 'all' | 'published' | 'draft',
): Promise<ExportDiaryRow[]> {
  const scopeCondition =
    scope === 'published'
      ? " AND d.status = 'published' AND d.published_revision_id IS NOT NULL"
      : scope === 'draft'
        ? " AND d.status = 'draft' AND d.draft_revision_id IS NOT NULL"
        : ''
  return queryAll<ExportDiaryRow>(
    db,
    `${EXPORT_DIARY_SQL}${scopeCondition} ORDER BY d.record_date ASC, d.created_at ASC`,
  )
}

export async function listExportDiariesByIds(
  db: D1Database,
  diaryIds: string[],
): Promise<ExportDiaryRow[]> {
  const rows: ExportDiaryRow[] = []
  for (const chunk of chunkArray(diaryIds, 90)) {
    const placeholders = chunk.map(() => '?').join(', ')
    rows.push(
      ...(await queryAll<ExportDiaryRow>(
        db,
        `${EXPORT_DIARY_SQL} AND d.id IN (${placeholders})
         ORDER BY d.record_date ASC, d.created_at ASC`,
        chunk,
      )),
    )
  }
  return rows
}

export async function listRevisionPhotoLinks(
  db: D1Database,
  revisionIds: string[],
): Promise<Array<{ revision_id: string; photo_id: string; sort_order: number }>> {
  const rows: Array<{ revision_id: string; photo_id: string; sort_order: number }> = []
  for (const chunk of chunkArray(revisionIds, 90)) {
    const placeholders = chunk.map(() => '?').join(', ')
    rows.push(
      ...(await queryAll<{ revision_id: string; photo_id: string; sort_order: number }>(
        db,
        `SELECT revision_id, photo_id, sort_order FROM revision_photos
          WHERE revision_id IN (${placeholders})
          ORDER BY revision_id, sort_order ASC`,
        chunk,
      )),
    )
  }
  return rows
}

export async function listPhotoMedia(
  db: D1Database,
  photoIds: string[],
): Promise<PhotoMediaRow[]> {
  const rows: PhotoMediaRow[] = []
  for (const chunk of chunkArray(photoIds, 90)) {
    const placeholders = chunk.map(() => '?').join(', ')
    rows.push(
      ...(await queryAll<PhotoMediaRow>(
        db,
        `SELECT id, r2_key, original_name, mime_type, file_size, width, height,
                upload_status, uploaded_at, created_at, deleted_at
           FROM photos WHERE id IN (${placeholders})`,
        chunk,
      )),
    )
  }
  return rows
}

export async function findExistingDiaryIds(
  db: D1Database,
  ids: string[],
): Promise<Set<string>> {
  const result = new Set<string>()
  for (const chunk of chunkArray(ids, 90)) {
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = await queryAll<{ id: string }>(
      db,
      `SELECT id FROM diaries WHERE id IN (${placeholders})`,
      chunk,
    )
    rows.forEach((row) => result.add(row.id))
  }
  return result
}

export async function findExistingPhotoIds(
  db: D1Database,
  ids: string[],
): Promise<Set<string>> {
  const result = new Set<string>()
  for (const chunk of chunkArray(ids, 90)) {
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = await queryAll<{ id: string }>(
      db,
      `SELECT id FROM photos WHERE id IN (${placeholders})`,
      chunk,
    )
    rows.forEach((row) => result.add(row.id))
  }
  return result
}

// ---- 合并恢复写入 ----

// 构建单篇日记的写入语句（日记 + 版本 + 照片关联）
export function buildImportDiaryStatements(
  db: D1Database,
  bundle: ImportDiaryBundle,
  now: string,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO diaries (id, record_date, status, published_revision_id, draft_revision_id,
           created_at, updated_at, published_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind(
        bundle.diaryId,
        bundle.recordDate,
        bundle.status,
        bundle.publishedRevisionId,
        bundle.draftRevisionId,
        bundle.createdAt || now,
        bundle.updatedAt || now,
        bundle.publishedAt,
      ),
  ]

  for (const revision of bundle.revisions) {
    statements.push(
      db
        .prepare(
          `INSERT INTO diary_revisions (id, diary_id, content, revision_type, revision_version,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          revision.id,
          bundle.diaryId,
          revision.content,
          revision.revisionType,
          revision.version,
          revision.createdAt || now,
          revision.updatedAt || now,
        ),
    )
  }

  for (const link of bundle.revisionPhotos) {
    statements.push(
      db
        .prepare(
          `INSERT INTO revision_photos (id, revision_id, photo_id, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), link.revisionId, link.photoId, link.sortOrder, now),
    )
  }

  return statements
}

// 构建导入照片的写入语句（已直接标记为 uploaded）
export function buildImportPhotoStatement(
  db: D1Database,
  photo: ImportPhotoBundle,
  now: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO photos (id, r2_key, thumbnail_key, original_name, mime_type, file_size,
         width, height, upload_status, uploaded_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'uploaded', ?, ?, ?, NULL)`,
    )
    .bind(
      photo.id,
      photo.r2Key,
      photo.originalName,
      photo.mimeType,
      photo.fileSize,
      photo.width,
      photo.height,
      photo.uploadedAt ?? now,
      photo.createdAt || now,
      now,
    )
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}
