// 日记版本与版本照片关联数据访问层
import { execute, queryAll, queryOne } from '../db/client'

export type RevisionType = 'working' | 'published'

export interface RevisionRow {
  id: string
  diary_id: string
  content: string
  revision_type: RevisionType
  revision_version: number
  created_at: string
  updated_at: string
}

export interface RevisionPhotoRow {
  id: string
  photo_id: string
  sort_order: number
  original_name: string
  mime_type: string
  file_size: number
  width: number | null
  height: number | null
  upload_status: string
}

export async function findRevisionById(
  db: D1Database,
  id: string,
): Promise<RevisionRow | null> {
  return queryOne<RevisionRow>(
    db,
    `SELECT id, diary_id, content, revision_type, revision_version, created_at, updated_at
       FROM diary_revisions WHERE id = ?`,
    [id],
  )
}

export async function createRevision(
  db: D1Database,
  params: {
    id: string
    diaryId: string
    content: string
    revisionType: RevisionType
    now: string
  },
): Promise<void> {
  await execute(
    db,
    `INSERT INTO diary_revisions (id, diary_id, content, revision_type, revision_version,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
    [params.id, params.diaryId, params.content, params.revisionType, params.now, params.now],
  )
}

// 保存工作版本：带版本号条件更新，返回受影响行数（0 表示并发冲突）
export async function updateWorkingRevision(
  db: D1Database,
  params: {
    revisionId: string
    diaryId: string
    content: string
    expectedVersion: number
    now: string
  },
): Promise<number> {
  return execute(
    db,
    `UPDATE diary_revisions
        SET content = ?, revision_version = revision_version + 1, updated_at = ?
      WHERE id = ? AND diary_id = ? AND revision_type = 'working' AND revision_version = ?`,
    [
      params.content,
      params.now,
      params.revisionId,
      params.diaryId,
      params.expectedVersion,
    ],
  )
}

// 将工作版本转为公开版本（条件更新，防止并发覆盖）
export async function markRevisionPublished(
  db: D1Database,
  params: { revisionId: string; expectedVersion: number; now: string },
): Promise<number> {
  return execute(
    db,
    `UPDATE diary_revisions
        SET revision_type = 'published', revision_version = revision_version + 1, updated_at = ?
      WHERE id = ? AND revision_type = 'working' AND revision_version = ?`,
    [params.now, params.revisionId, params.expectedVersion],
  )
}

// 仅递增工作版本号（照片排序等结构化变更使用）
export async function bumpWorkingRevision(
  db: D1Database,
  params: { revisionId: string; diaryId: string; expectedVersion: number; now: string },
): Promise<number> {
  return execute(
    db,
    `UPDATE diary_revisions
        SET revision_version = revision_version + 1, updated_at = ?
      WHERE id = ? AND diary_id = ? AND revision_type = 'working' AND revision_version = ?`,
    [params.now, params.revisionId, params.diaryId, params.expectedVersion],
  )
}

export async function touchRevision(
  db: D1Database,
  revisionId: string,
  now: string,
): Promise<void> {
  await execute(db, 'UPDATE diary_revisions SET updated_at = ? WHERE id = ?', [now, revisionId])
}

// 读取版本照片（含照片元数据），按 sort_order 升序
export async function listRevisionPhotos(
  db: D1Database,
  revisionId: string,
): Promise<RevisionPhotoRow[]> {
  return queryAll<RevisionPhotoRow>(
    db,
    `SELECT rp.id, rp.photo_id, rp.sort_order,
            p.original_name, p.mime_type, p.file_size, p.width, p.height, p.upload_status
       FROM revision_photos rp
       JOIN photos p ON p.id = rp.photo_id
      WHERE rp.revision_id = ?
      ORDER BY rp.sort_order ASC`,
    [revisionId],
  )
}

// 批量读取多个版本的照片（用于公开列表，避免 N+1 查询）
export async function listPhotosForRevisions(
  db: D1Database,
  revisionIds: string[],
): Promise<
  Array<{ revision_id: string; photo_id: string; sort_order: number }>
> {
  if (revisionIds.length === 0) return []
  const placeholders = revisionIds.map(() => '?').join(', ')
  return queryAll<{ revision_id: string; photo_id: string; sort_order: number }>(
    db,
    `SELECT rp.revision_id, rp.photo_id, rp.sort_order
       FROM revision_photos rp
       JOIN photos p ON p.id = rp.photo_id
      WHERE rp.revision_id IN (${placeholders})
        AND p.upload_status = 'uploaded' AND p.deleted_at IS NULL
      ORDER BY rp.revision_id, rp.sort_order ASC`,
    revisionIds,
  )
}

// 生成替换版本照片关联的批量语句（先清空再按给定顺序写入）
export function buildReplacePhotoStatements(
  db: D1Database,
  revisionId: string,
  photoIds: string[],
  now: string,
  newId: () => string,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM revision_photos WHERE revision_id = ?').bind(revisionId),
  ]
  photoIds.forEach((photoId, index) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO revision_photos (id, revision_id, photo_id, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(newId(), revisionId, photoId, index, now),
    )
  })
  return statements
}

// 生成复制版本照片关联的批量语句（保留原排序，逐行生成唯一 ID）
export function buildCopyPhotoStatements(
  db: D1Database,
  sourcePhotoIds: string[],
  targetRevisionId: string,
  now: string,
  newId: () => string,
): D1PreparedStatement[] {
  return sourcePhotoIds.map((photoId, index) =>
    db
      .prepare(
        `INSERT INTO revision_photos (id, revision_id, photo_id, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(newId(), targetRevisionId, photoId, index, now),
  )
}

// 读取版本引用的照片 ID 列表
export async function listRevisionPhotoIds(
  db: D1Database,
  revisionId: string,
): Promise<string[]> {
  const rows = await queryAll<{ photo_id: string }>(
    db,
    'SELECT photo_id FROM revision_photos WHERE revision_id = ? ORDER BY sort_order ASC',
    [revisionId],
  )
  return rows.map((row) => row.photo_id)
}

// 检查版本照片是否全部为已上传状态
export async function countNotReadyPhotos(
  db: D1Database,
  revisionId: string,
): Promise<number> {
  const row = await queryOne<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total
       FROM revision_photos rp
       JOIN photos p ON p.id = rp.photo_id
      WHERE rp.revision_id = ?
        AND (p.upload_status <> 'uploaded' OR p.deleted_at IS NOT NULL)`,
    [revisionId],
  )
  return row?.total ?? 0
}
