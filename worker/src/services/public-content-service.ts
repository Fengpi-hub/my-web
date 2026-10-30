// 访客端公开内容服务：首页随机照片、照片墙、时间轴与年月统计
import { AppError } from '../utils/errors'
import * as publicRepo from '../repositories/public-repository'

export interface PublicPhotoSummary {
  id: string
  diaryId: string | null
  thumbnailUrl: string
  imageUrl: string
  uploadedAt: string
}

export interface TimelineItem {
  id: string
  recordDate: string
  content: string
  representativePhoto: { id: string; thumbnailUrl: string } | null
}

export interface PeriodSummary {
  years: Array<{ year: number; months: number[] }>
}

const MAX_RANDOM = 24
const DEFAULT_RANDOM = 12

// 首页随机照片（不包含日记文字与日期）
export async function getHomeRandomPhotos(
  db: D1Database,
  limit: number,
): Promise<{ photos: Array<{ id: string; diaryId: string; thumbnailUrl: string; imageUrl: string }> }> {
  const safeLimit = Math.min(Math.max(limit, 1), MAX_RANDOM) || DEFAULT_RANDOM
  const rows = await publicRepo.listRandomPublishedPhotos(db, safeLimit)
  return {
    photos: rows.map((row) => ({
      id: row.photo_id,
      diaryId: row.diary_id,
      thumbnailUrl: thumbnailUrl(row.photo_id),
      imageUrl: imageUrl(row.photo_id),
    })),
  }
}

// 照片墙游标分页
export async function getPublicPhotos(
  db: D1Database,
  query: {
    limit: number
    year: string | null
    month: string | null
    cursor: string | null
  },
): Promise<{
  items: PublicPhotoSummary[]
  nextCursor: string | null
  hasMore: boolean
}> {
  const parsed = parseCursor(query.cursor, 'uploadedAt')
  const rows = await publicRepo.listPublicPhotos(db, {
    limit: query.limit + 1,
    year: query.year,
    month: query.month,
    cursor: parsed ? { uploadedAt: parsed[0], id: parsed[1] } : null,
  })

  const hasMore = rows.length > query.limit
  const items = hasMore ? rows.slice(0, query.limit) : rows
  const last = items[items.length - 1]

  return {
    items: items.map((row) => ({
      id: row.id,
      diaryId: row.diary_id,
      thumbnailUrl: thumbnailUrl(row.id),
      imageUrl: imageUrl(row.id),
      uploadedAt: row.uploaded_at,
    })),
    nextCursor: hasMore && last ? encodeCursor(last.uploaded_at, last.id) : null,
    hasMore,
  }
}

// 时间轴游标分页
export async function getPublicTimeline(
  db: D1Database,
  query: {
    limit: number
    year: string | null
    month: string | null
    cursor: string | null
  },
): Promise<{ items: TimelineItem[]; nextCursor: string | null; hasMore: boolean }> {
  const parsed = parseCursor(query.cursor, 'publishedAt')
  const rows = await publicRepo.listPublicTimeline(db, {
    limit: query.limit + 1,
    year: query.year,
    month: query.month,
    cursor: parsed ? { publishedAt: parsed[0], id: parsed[1] } : null,
  })

  const hasMore = rows.length > query.limit
  const items = hasMore ? rows.slice(0, query.limit) : rows
  const last = items[items.length - 1]

  const revisionIds = items.map((row) => row.revision_id)
  const photoRows = await publicRepo.listFirstPhotosForRevisions(db, revisionIds)
  const firstPhotoByRevision = new Map<string, string>()
  for (const row of photoRows) {
    if (!firstPhotoByRevision.has(row.revision_id)) {
      firstPhotoByRevision.set(row.revision_id, row.photo_id)
    }
  }

  return {
    items: items.map((row) => {
      const photoId = firstPhotoByRevision.get(row.revision_id) ?? null
      return {
        id: row.id,
        recordDate: row.record_date,
        content: row.content,
        representativePhoto: photoId
          ? { id: photoId, thumbnailUrl: thumbnailUrl(photoId) }
          : null,
      }
    }),
    nextCursor: hasMore && last ? encodeCursor(last.published_at, last.id) : null,
    hasMore,
  }
}

// 时间轴可用年月
export async function getTimelinePeriods(db: D1Database): Promise<PeriodSummary> {
  return buildPeriodSummary(await publicRepo.listPublishedDiaryPeriods(db))
}

// 照片墙可用年月
export async function getPhotoPeriods(db: D1Database): Promise<PeriodSummary> {
  return buildPeriodSummary(await publicRepo.listPublishedPhotoPeriods(db))
}

// ---- 内部工具 ----

function buildPeriodSummary(rows: Array<{ year: string; month: string; total: number }>): PeriodSummary {
  const yearMap = new Map<number, number[]>()
  for (const row of rows) {
    const year = Number.parseInt(row.year, 10)
    const month = Number.parseInt(row.month, 10)
    if (!Number.isInteger(year) || !Number.isInteger(month)) continue
    const months = yearMap.get(year) ?? []
    months.push(month)
    yearMap.set(year, months)
  }

  return {
    years: Array.from(yearMap.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([year, months]) => ({
        year,
        months: months.sort((a, b) => b - a),
      })),
  }
}

function encodeCursor(time: string, id: string): string {
  return btoa(`${time}|${id}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function parseCursor(cursor: string | null, _field: string): [string, string] | null {
  if (!cursor) return null
  let decoded: string
  try {
    const normalized = cursor.replace(/-/g, '+').replace(/_/g, '/')
    decoded = atob(normalized)
  } catch {
    throw new AppError('VALIDATION_ERROR', '分页游标无效')
  }
  const index = decoded.indexOf('|')
  if (index <= 0 || index === decoded.length - 1) {
    throw new AppError('VALIDATION_ERROR', '分页游标无效')
  }
  return [decoded.slice(0, index), decoded.slice(index + 1)]
}

function thumbnailUrl(photoId: string): string {
  return `/api/media/${photoId}/thumbnail`
}

function imageUrl(photoId: string): string {
  return `/api/media/${photoId}/original`
}
