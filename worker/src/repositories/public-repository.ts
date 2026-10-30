// 访客端公开内容数据访问层：仅读取已发布日记的公开版本与其照片
import { queryAll } from '../db/client'

export interface PublicRandomPhotoRow {
  photo_id: string
  diary_id: string
}

export interface PublicPhotoRow {
  id: string
  uploaded_at: string
  diary_id: string | null
}

export interface PublicTimelineRow {
  id: string
  record_date: string
  published_at: string
  revision_id: string
  content: string
}

export interface PeriodRow {
  year: string
  month: string
  total: number
}

// 首页随机照片：只取公开版本引用且已上传成功的照片
export async function listRandomPublishedPhotos(
  db: D1Database,
  limit: number,
): Promise<PublicRandomPhotoRow[]> {
  return queryAll<PublicRandomPhotoRow>(
    db,
    `SELECT p.id AS photo_id, d.id AS diary_id
       FROM diaries d
       JOIN revision_photos rp ON rp.revision_id = d.published_revision_id
       JOIN photos p ON p.id = rp.photo_id
      WHERE d.status = 'published' AND d.deleted_at IS NULL
        AND d.published_revision_id IS NOT NULL
        AND p.upload_status = 'uploaded' AND p.deleted_at IS NULL
      ORDER BY RANDOM()
      LIMIT ?`,
    [limit],
  )
}

// 照片墙：游标分页，按照片上传时间倒序；同一照片只返回一次
export async function listPublicPhotos(
  db: D1Database,
  params: {
    limit: number
    year: string | null
    month: string | null
    cursor: { uploadedAt: string; id: string } | null
  },
): Promise<PublicPhotoRow[]> {
  const where: string[] = [
    "p.upload_status = 'uploaded'",
    'p.deleted_at IS NULL',
    'p.uploaded_at IS NOT NULL',
    `EXISTS (
      SELECT 1 FROM revision_photos rp
        JOIN diaries d ON d.published_revision_id = rp.revision_id
       WHERE rp.photo_id = p.id AND d.status = 'published' AND d.deleted_at IS NULL
    )`,
  ]
  const bindings: unknown[] = []

  if (params.year) {
    where.push("substr(p.uploaded_at, 1, 4) = ?")
    bindings.push(params.year)
  }
  if (params.month) {
    where.push("substr(p.uploaded_at, 6, 2) = ?")
    bindings.push(params.month)
  }
  if (params.cursor) {
    where.push('(p.uploaded_at < ? OR (p.uploaded_at = ? AND p.id < ?))')
    bindings.push(params.cursor.uploadedAt, params.cursor.uploadedAt, params.cursor.id)
  }

  bindings.push(params.limit)

  return queryAll<PublicPhotoRow>(
    db,
    `SELECT p.id, p.uploaded_at,
            (SELECT d2.id FROM diaries d2
               JOIN revision_photos rp2 ON rp2.revision_id = d2.published_revision_id
              WHERE rp2.photo_id = p.id AND d2.status = 'published'
                AND d2.deleted_at IS NULL AND d2.published_revision_id IS NOT NULL
              ORDER BY d2.published_at DESC, d2.id DESC
              LIMIT 1) AS diary_id
       FROM photos p
      WHERE ${where.join(' AND ')}
      ORDER BY p.uploaded_at DESC, p.id DESC
      LIMIT ?`,
    bindings,
  )
}

// 时间轴：按发布时间倒序的公开日记
export async function listPublicTimeline(
  db: D1Database,
  params: {
    limit: number
    year: string | null
    month: string | null
    cursor: { publishedAt: string; id: string } | null
  },
): Promise<PublicTimelineRow[]> {
  const where: string[] = [
    "d.status = 'published'",
    'd.deleted_at IS NULL',
    'd.published_revision_id IS NOT NULL',
  ]
  const bindings: unknown[] = []

  if (params.year) {
    where.push('substr(d.record_date, 1, 4) = ?')
    bindings.push(params.year)
  }
  if (params.month) {
    where.push('substr(d.record_date, 6, 2) = ?')
    bindings.push(params.month)
  }
  if (params.cursor) {
    where.push('(d.published_at < ? OR (d.published_at = ? AND d.id < ?))')
    bindings.push(params.cursor.publishedAt, params.cursor.publishedAt, params.cursor.id)
  }

  bindings.push(params.limit)

  return queryAll<PublicTimelineRow>(
    db,
    `SELECT d.id, d.record_date, d.published_at,
            d.published_revision_id AS revision_id, r.content
       FROM diaries d
       JOIN diary_revisions r ON r.id = d.published_revision_id
      WHERE ${where.join(' AND ')}
      ORDER BY d.published_at DESC, d.id DESC
      LIMIT ?`,
    bindings,
  )
}

// 时间轴年月：仅统计已发布日记的记录日期
export async function listPublishedDiaryPeriods(db: D1Database): Promise<PeriodRow[]> {
  return queryAll<PeriodRow>(
    db,
    `SELECT substr(record_date, 1, 4) AS year, substr(record_date, 6, 2) AS month,
            COUNT(*) AS total
       FROM diaries
      WHERE status = 'published' AND deleted_at IS NULL AND published_revision_id IS NOT NULL
      GROUP BY year, month
      ORDER BY year DESC, month DESC`,
  )
}

// 照片墙年月：仅统计被公开版本引用且已上传的照片（按照片上传时间）
export async function listPublishedPhotoPeriods(db: D1Database): Promise<PeriodRow[]> {
  return queryAll<PeriodRow>(
    db,
    `SELECT substr(p.uploaded_at, 1, 4) AS year, substr(p.uploaded_at, 6, 2) AS month,
            COUNT(*) AS total
       FROM photos p
      WHERE p.upload_status = 'uploaded' AND p.deleted_at IS NULL AND p.uploaded_at IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM revision_photos rp
            JOIN diaries d ON d.published_revision_id = rp.revision_id
           WHERE rp.photo_id = p.id AND d.status = 'published' AND d.deleted_at IS NULL
        )
      GROUP BY year, month
      ORDER BY year DESC, month DESC`,
  )
}

// 批量读取多个公开版本的第一张照片（时间轴代表照片）
export async function listFirstPhotosForRevisions(
  db: D1Database,
  revisionIds: string[],
): Promise<Array<{ revision_id: string; photo_id: string }>> {
  if (revisionIds.length === 0) return []
  const placeholders = revisionIds.map(() => '?').join(', ')
  return queryAll<{ revision_id: string; photo_id: string }>(
    db,
    `SELECT rp.revision_id, rp.photo_id
       FROM revision_photos rp
       JOIN photos p ON p.id = rp.photo_id
      WHERE rp.revision_id IN (${placeholders})
        AND p.upload_status = 'uploaded' AND p.deleted_at IS NULL
      ORDER BY rp.revision_id, rp.sort_order ASC`,
    revisionIds,
  )
}
