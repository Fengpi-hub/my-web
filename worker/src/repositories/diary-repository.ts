// 日记数据访问层
import { execute, queryAll, queryOne } from '../db/client'

export type DiaryStatus = 'draft' | 'published'

export interface DiaryRow {
  id: string
  record_date: string
  status: DiaryStatus
  published_revision_id: string | null
  draft_revision_id: string | null
  created_at: string
  updated_at: string
  published_at: string | null
  deleted_at: string | null
}

export interface AdminDiaryListRow {
  id: string
  record_date: string
  status: DiaryStatus
  created_at: string
  updated_at: string
  published_at: string | null
  draft_revision_id: string | null
  published_revision_id: string | null
  preview_content: string
  photo_count: number
}

export interface PublicDiaryListRow {
  id: string
  record_date: string
  published_at: string
  revision_id: string
  content: string
}

export interface PublicDiaryRow extends PublicDiaryListRow {
  published_revision_id: string
}

const DIARY_COLUMNS = `id, record_date, status, published_revision_id, draft_revision_id,
  created_at, updated_at, published_at, deleted_at`

// 读取日记主体；默认排除已软删除记录
export async function findDiaryById(
  db: D1Database,
  id: string,
  includeDeleted = false,
): Promise<DiaryRow | null> {
  const sql = `SELECT ${DIARY_COLUMNS} FROM diaries
    WHERE id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`
  return queryOne<DiaryRow>(db, sql, [id])
}

// 创建日记主体（调用方负责在同一事务中创建工作版本）
export async function insertDiary(
  db: D1Database,
  params: {
    id: string
    recordDate: string
    status: DiaryStatus
    now: string
    publishedRevisionId?: string | null
    draftRevisionId?: string | null
    publishedAt?: string | null
  },
): Promise<void> {
  await execute(
    db,
    `INSERT INTO diaries (id, record_date, status, published_revision_id, draft_revision_id,
       created_at, updated_at, published_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      params.id,
      params.recordDate,
      params.status,
      params.publishedRevisionId ?? null,
      params.draftRevisionId ?? null,
      params.now,
      params.now,
      params.publishedAt ?? null,
    ],
  )
}

export async function setDraftRevisionId(
  db: D1Database,
  diaryId: string,
  revisionId: string,
): Promise<void> {
  await execute(db, 'UPDATE diaries SET draft_revision_id = ? WHERE id = ?', [
    revisionId,
    diaryId,
  ])
}

// 管理端列表（支持搜索、年月、状态、照片数、排序）
export async function listAdminDiaries(
  db: D1Database,
  params: {
    limit: number
    offset: number
    keyword: string | null
    year: string | null
    month: string | null
    status: string | null
    sort: string | null
    hasPhotos: boolean | null
  },
): Promise<AdminDiaryListRow[]> {
  const where: string[] = ['d.deleted_at IS NULL']
  const bindings: unknown[] = []

  if (params.year) {
    where.push('substr(d.record_date, 1, 4) = ?')
    bindings.push(params.year)
  }
  if (params.month) {
    where.push('substr(d.record_date, 6, 2) = ?')
    bindings.push(params.month)
  }
  if (params.status === 'draft' || params.status === 'published') {
    where.push('d.status = ?')
    bindings.push(params.status)
  }
  if (params.keyword) {
    where.push(
      `(COALESCE(w.content, '') LIKE ? ESCAPE '\\' OR COALESCE(p.content, '') LIKE ? ESCAPE '\\')`,
    )
    const like = `%${escapeLike(params.keyword)}%`
    bindings.push(like, like)
  }
  if (params.hasPhotos === true) {
    where.push(PHOTO_COUNT_EXPR + ' > 0')
  } else if (params.hasPhotos === false) {
    where.push(PHOTO_COUNT_EXPR + ' = 0')
  }

  let orderBy = 'd.record_date DESC, d.published_at DESC'
  if (params.sort === 'published') {
    orderBy = 'd.published_at IS NULL, d.published_at DESC'
  }

  const sql = `SELECT d.id, d.record_date, d.status, d.created_at, d.updated_at,
      d.published_at, d.draft_revision_id, d.published_revision_id,
      COALESCE(w.content, p.content, '') AS preview_content,
      ${PHOTO_COUNT_EXPR} AS photo_count
    FROM diaries d
    LEFT JOIN diary_revisions w ON w.id = d.draft_revision_id
    LEFT JOIN diary_revisions p ON p.id = d.published_revision_id
    WHERE ${where.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?`

  bindings.push(params.limit, params.offset)
  return queryAll<AdminDiaryListRow>(db, sql, bindings)
}

// 管理端列表总数
export async function countAdminDiaries(
  db: D1Database,
  params: {
    keyword: string | null
    year: string | null
    month: string | null
    status: string | null
    hasPhotos: boolean | null
  },
): Promise<number> {
  const where: string[] = ['d.deleted_at IS NULL']
  const bindings: unknown[] = []

  if (params.year) {
    where.push('substr(d.record_date, 1, 4) = ?')
    bindings.push(params.year)
  }
  if (params.month) {
    where.push('substr(d.record_date, 6, 2) = ?')
    bindings.push(params.month)
  }
  if (params.status === 'draft' || params.status === 'published') {
    where.push('d.status = ?')
    bindings.push(params.status)
  }
  if (params.keyword) {
    where.push(
      `(COALESCE(w.content, '') LIKE ? ESCAPE '\\' OR COALESCE(p.content, '') LIKE ? ESCAPE '\\')`,
    )
    const like = `%${escapeLike(params.keyword)}%`
    bindings.push(like, like)
  }
  if (params.hasPhotos === true) {
    where.push(PHOTO_COUNT_EXPR + ' > 0')
  } else if (params.hasPhotos === false) {
    where.push(PHOTO_COUNT_EXPR + ' = 0')
  }

  const row = await queryOne<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total
       FROM diaries d
       LEFT JOIN diary_revisions w ON w.id = d.draft_revision_id
       LEFT JOIN diary_revisions p ON p.id = d.published_revision_id
      WHERE ${where.join(' AND ')}`,
    bindings,
  )
  return row?.total ?? 0
}

// 公开列表：只读取当前公开版本
export async function listPublishedDiaries(
  db: D1Database,
  params: { limit: number; offset: number; year: string | null; month: string | null },
): Promise<PublicDiaryListRow[]> {
  const where: string[] = [
    'd.status = ?',
    'd.deleted_at IS NULL',
    'd.published_revision_id IS NOT NULL',
  ]
  const bindings: unknown[] = ['published']

  if (params.year) {
    where.push('substr(d.record_date, 1, 4) = ?')
    bindings.push(params.year)
  }
  if (params.month) {
    where.push('substr(d.record_date, 6, 2) = ?')
    bindings.push(params.month)
  }

  bindings.push(params.limit, params.offset)

  return queryAll<PublicDiaryListRow>(
    db,
    `SELECT d.id, d.record_date, d.published_at, d.published_revision_id AS revision_id,
            r.content
       FROM diaries d
       JOIN diary_revisions r ON r.id = d.published_revision_id
      WHERE ${where.join(' AND ')}
      ORDER BY d.published_at DESC, d.record_date DESC
      LIMIT ? OFFSET ?`,
    bindings,
  )
}

// 公开列表总数
export async function countPublishedDiaries(
  db: D1Database,
  params: { year: string | null; month: string | null },
): Promise<number> {
  const where: string[] = [
    'status = ?',
    'deleted_at IS NULL',
    'published_revision_id IS NOT NULL',
  ]
  const bindings: unknown[] = ['published']

  if (params.year) {
    where.push('substr(record_date, 1, 4) = ?')
    bindings.push(params.year)
  }
  if (params.month) {
    where.push('substr(record_date, 6, 2) = ?')
    bindings.push(params.month)
  }

  const row = await queryOne<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total FROM diaries WHERE ${where.join(' AND ')}`,
    bindings,
  )
  return row?.total ?? 0
}

// 公开详情：仅已发布且未删除
export async function findPublishedDiary(
  db: D1Database,
  id: string,
): Promise<PublicDiaryRow | null> {
  return queryOne<PublicDiaryRow>(
    db,
    `SELECT d.id, d.record_date, d.published_at, d.published_revision_id,
            d.published_revision_id AS revision_id, r.content
       FROM diaries d
       JOIN diary_revisions r ON r.id = d.published_revision_id
      WHERE d.id = ? AND d.status = 'published'
        AND d.deleted_at IS NULL AND d.published_revision_id IS NOT NULL`,
    [id],
  )
}

// 软删除日记（保留版本与照片关系）
export async function softDeleteDiary(
  db: D1Database,
  id: string,
  now: string,
): Promise<number> {
  return execute(
    db,
    `UPDATE diaries SET deleted_at = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL`,
    [now, now, id],
  )
}

const PHOTO_COUNT_EXPR = `(SELECT COUNT(*) FROM revision_photos rp
  WHERE rp.revision_id = COALESCE(d.draft_revision_id, d.published_revision_id))`

// LIKE 通配符转义，避免用户输入改变检索语义
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}
