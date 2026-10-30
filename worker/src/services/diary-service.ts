// 日记业务服务：创建 / 草稿保存 / 发布 / 提交 / 取消发布 / 删除 / 复制
import { AppError } from '../utils/errors'
import { newId, nowIso } from '../utils/id'
import { buildPreview, validateRecordDate } from '../utils/http'
import * as diaryRepo from '../repositories/diary-repository'
import * as revisionRepo from '../repositories/revision-repository'
import * as photoRepo from '../repositories/photo-repository'
import { insertOperationLog } from '../repositories/auth-repository'

const MAX_CONTENT_LENGTH = 20000
const MAX_PHOTOS = 100

export interface AdminDiaryListItem {
  id: string
  recordDate: string
  status: string
  contentPreview: string
  photoCount: number
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  hasDraft: boolean
}

export interface AdminPhotoItem {
  id: string
  sortOrder: number
  originalName: string
  mimeType: string
  fileSize: number
  width: number | null
  height: number | null
  thumbnailUrl: string
  imageUrl: string
}

export interface AdminRevisionItem {
  id: string
  revisionVersion: number
  content: string
  updatedAt: string
  photos: AdminPhotoItem[]
}

export interface AdminDiaryDetail {
  id: string
  status: string
  recordDate: string
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  publishedRevision: AdminRevisionItem | null
  draftRevision: AdminRevisionItem | null
}

export interface PublicDiaryListItem {
  id: string
  recordDate: string
  contentPreview: string
  photos: Array<{ id: string; thumbnailUrl: string }>
  publishedAt: string
}

export interface PublicDiaryDetail {
  id: string
  recordDate: string
  content: string
  photos: Array<{ id: string; sortOrder: number; imageUrl: string }>
  publishedAt: string
}

// ---- 管理端 ----

export async function listAdminDiaries(
  db: D1Database,
  query: {
    page: number
    limit: number
    offset: number
    keyword: string | null
    year: string | null
    month: string | null
    status: string | null
    sort: string | null
    hasPhotos: boolean | null
  },
): Promise<{
  items: AdminDiaryListItem[]
  pagination: { page: number; limit: number; total: number; hasMore: boolean }
}> {
  const filter = {
    keyword: query.keyword,
    year: query.year,
    month: query.month,
    status: query.status,
    hasPhotos: query.hasPhotos,
  }
  const [rows, total] = await Promise.all([
    diaryRepo.listAdminDiaries(db, { ...filter, limit: query.limit, offset: query.offset, sort: query.sort }),
    diaryRepo.countAdminDiaries(db, filter),
  ])

  // 多取一条判断是否还有下一页，这里通过总数直接判断
  return {
    items: rows.map((row) => ({
      id: row.id,
      recordDate: row.record_date,
      status: row.status,
      contentPreview: buildPreview(row.preview_content),
      photoCount: row.photo_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      publishedAt: row.published_at,
      hasDraft: row.draft_revision_id !== null,
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      hasMore: query.offset + rows.length < total,
    },
  }
}

export async function getAdminDiary(
  db: D1Database,
  diaryId: string,
): Promise<AdminDiaryDetail> {
  const diary = await diaryRepo.findDiaryById(db, diaryId)
  if (!diary) {
    throw new AppError('NOT_FOUND', '日记不存在')
  }

  const [publishedRevision, draftRevision] = await Promise.all([
    diary.published_revision_id
      ? loadRevisionItem(db, diary.published_revision_id)
      : Promise.resolve(null),
    diary.draft_revision_id
      ? loadRevisionItem(db, diary.draft_revision_id)
      : Promise.resolve(null),
  ])

  return {
    id: diary.id,
    status: diary.status,
    recordDate: diary.record_date,
    createdAt: diary.created_at,
    updatedAt: diary.updated_at,
    publishedAt: diary.published_at,
    publishedRevision,
    draftRevision,
  }
}

// 创建日记：主体与工作版本在同一事务中写入
export async function createDiary(
  db: D1Database,
  adminId: string,
  input: { recordDate: string },
): Promise<{ id: string; draftRevisionId: string; revisionVersion: number }> {
  const recordDate = validateRecordDate(input.recordDate)
  const diaryId = newId()
  const revisionId = newId()
  const now = nowIso()

  await db.batch([
    db
      .prepare(
        `INSERT INTO diaries (id, record_date, status, published_revision_id, draft_revision_id,
           created_at, updated_at, published_at, deleted_at)
         VALUES (?, ?, 'draft', NULL, ?, ?, ?, NULL, NULL)`,
      )
      .bind(diaryId, recordDate, revisionId, now, now),
    db
      .prepare(
        `INSERT INTO diary_revisions (id, diary_id, content, revision_type, revision_version,
           created_at, updated_at)
         VALUES (?, ?, '', 'working', 1, ?, ?)`,
      )
      .bind(revisionId, diaryId, now, now),
  ])

  await insertOperationLog(db, {
    id: newId(),
    adminId,
    actionType: 'diary_create',
    targetId: diaryId,
    summary: `创建日记 ${recordDate}`,
    now,
  })

  return { id: diaryId, draftRevisionId: revisionId, revisionVersion: 1 }
}

// 自动保存工作版本
export async function saveDraft(
  db: D1Database,
  adminId: string,
  diaryId: string,
  input: {
    revisionId: string
    expectedVersion: number
    content: string
    photoIds: string[] | null
    recordDate: string | null
  },
): Promise<{ revisionId: string; revisionVersion: number; savedAt: string }> {
  const diary = await diaryRepo.findDiaryById(db, diaryId)
  if (!diary) {
    throw new AppError('NOT_FOUND', '日记不存在')
  }
  if (!diary.draft_revision_id || diary.draft_revision_id !== input.revisionId) {
    throw new AppError('REVISION_NOT_FOUND', '当前没有可保存的工作版本')
  }

  const revision = await revisionRepo.findRevisionById(db, input.revisionId)
  if (!revision || revision.diary_id !== diaryId || revision.revision_type !== 'working') {
    throw new AppError('REVISION_NOT_FOUND', '工作版本不存在')
  }
  if (revision.revision_version !== input.expectedVersion) {
    throw new AppError('REVISION_CONFLICT', '内容已在其他窗口更新，请刷新后再试')
  }

  if (input.content.length > MAX_CONTENT_LENGTH) {
    throw new AppError('VALIDATION_ERROR', `日记内容不能超过 ${MAX_CONTENT_LENGTH} 个字符`)
  }
  const recordDate = input.recordDate === null ? null : validateRecordDate(input.recordDate)
  if (input.photoIds !== null) {
    await assertPhotosReady(db, input.photoIds)
  }

  const now = nowIso()

  // 第一步：带版本号条件更新工作版本，确保并发冲突时立即中止
  const changed = await revisionRepo.updateWorkingRevision(db, {
    revisionId: input.revisionId,
    diaryId,
    content: input.content,
    expectedVersion: input.expectedVersion,
    now,
  })
  if (changed === 0) {
    throw new AppError('REVISION_CONFLICT', '内容已在其他窗口更新，请刷新后再试')
  }

  // 第二步：替换照片关联并更新日记时间（同一批次原子执行）
  const statements: D1PreparedStatement[] = revisionRepo.buildReplacePhotoStatements(
    db,
    input.revisionId,
    input.photoIds ?? (await revisionRepo.listRevisionPhotoIds(db, input.revisionId)),
    now,
    newId,
  )
  if (recordDate) {
    statements.push(
      db
        .prepare('UPDATE diaries SET record_date = ?, updated_at = ? WHERE id = ?')
        .bind(recordDate, now, diaryId),
    )
  } else {
    statements.push(
      db.prepare('UPDATE diaries SET updated_at = ? WHERE id = ?').bind(now, diaryId),
    )
  }
  await db.batch(statements)

  await insertOperationLog(db, {
    id: newId(),
    adminId,
    actionType: 'diary_save_draft',
    targetId: diaryId,
    summary: `保存草稿版本 v${input.expectedVersion + 1}`,
    now,
  })

  return {
    revisionId: input.revisionId,
    revisionVersion: input.expectedVersion + 1,
    savedAt: now,
  }
}

// 基于公开版本创建工作版本；已存在则直接返回
export async function ensureDraftRevision(
  db: D1Database,
  adminId: string,
  diaryId: string,
): Promise<{ revisionId: string; revisionVersion: number; created: boolean }> {
  const diary = await diaryRepo.findDiaryById(db, diaryId)
  if (!diary) {
    throw new AppError('NOT_FOUND', '日记不存在')
  }
  if (diary.draft_revision_id) {
    const existing = await revisionRepo.findRevisionById(db, diary.draft_revision_id)
    if (existing) {
      return {
        revisionId: existing.id,
        revisionVersion: existing.revision_version,
        created: false,
      }
    }
  }
  if (!diary.published_revision_id) {
    throw new AppError('DIARY_NOT_PUBLISHED', '日记尚未发布，无法创建工作版本')
  }

  const published = await revisionRepo.findRevisionById(db, diary.published_revision_id)
  if (!published) {
    throw new AppError('REVISION_NOT_FOUND', '公开版本不存在')
  }

  const revisionId = newId()
  const now = nowIso()
  const publishedPhotoIds = await revisionRepo.listRevisionPhotoIds(db, published.id)
  await db.batch([
    db
      .prepare(
        `INSERT INTO diary_revisions (id, diary_id, content, revision_type, revision_version,
           created_at, updated_at)
         VALUES (?, ?, ?, 'working', 1, ?, ?)`,
      )
      .bind(revisionId, diaryId, published.content, now, now),
    ...revisionRepo.buildCopyPhotoStatements(db, publishedPhotoIds, revisionId, now, newId),
    db
      .prepare(
        `UPDATE diaries SET draft_revision_id = ?, updated_at = ?
          WHERE id = ? AND published_revision_id = ? AND deleted_at IS NULL`,
      )
      .bind(revisionId, now, diaryId, published.id),
  ])

  await insertOperationLog(db, {
    id: newId(),
    adminId,
    actionType: 'diary_create_draft',
    targetId: diaryId,
    summary: '基于公开版本创建工作版本',
    now,
  })

  return { revisionId, revisionVersion: 1, created: true }
}

// 发布 / 提交公开修改（必须使用当前工作版本）
export async function publishDiary(
  db: D1Database,
  adminId: string,
  diaryId: string,
  input: { revisionId: string; expectedVersion: number },
  mode: 'publish' | 'commit',
): Promise<{ id: string; publishedRevisionId: string; publishedAt: string }> {
  const diary = await diaryRepo.findDiaryById(db, diaryId)
  if (!diary) {
    throw new AppError('NOT_FOUND', '日记不存在')
  }
  if (mode === 'commit' && (!diary.published_revision_id || diary.status !== 'published')) {
    throw new AppError('DIARY_NOT_PUBLISHED', '日记尚未发布，无法提交修改')
  }
  if (!diary.draft_revision_id || diary.draft_revision_id !== input.revisionId) {
    throw new AppError('REVISION_NOT_FOUND', '工作版本不存在')
  }

  const revision = await revisionRepo.findRevisionById(db, input.revisionId)
  if (!revision || revision.diary_id !== diaryId || revision.revision_type !== 'working') {
    throw new AppError('REVISION_NOT_FOUND', '工作版本不存在')
  }
  if (revision.revision_version !== input.expectedVersion) {
    throw new AppError('REVISION_CONFLICT', '版本已发生变化，请刷新后再试')
  }
  if ((await revisionRepo.countNotReadyPhotos(db, input.revisionId)) > 0) {
    throw new AppError('PHOTO_NOT_UPLOADED', '存在尚未上传成功的照片，暂不能发布')
  }

  const now = nowIso()
  const oldPublishedId = diary.published_revision_id
  // 旧公开版本被新版本替换后不再被任何指针引用，随发布事务一并清理，避免遗留失效照片关联
  const pruneStatements: D1PreparedStatement[] =
    oldPublishedId && oldPublishedId !== input.revisionId
      ? [
          db
            .prepare(
              `DELETE FROM revision_photos WHERE revision_id = ?
                AND NOT EXISTS (
                  SELECT 1 FROM diaries
                   WHERE id = ? AND (published_revision_id = ? OR draft_revision_id = ?)
                )`,
            )
            .bind(oldPublishedId, diaryId, oldPublishedId, oldPublishedId),
          db
            .prepare(
              `DELETE FROM diary_revisions WHERE id = ?
                AND NOT EXISTS (
                  SELECT 1 FROM diaries
                   WHERE id = ? AND (published_revision_id = ? OR draft_revision_id = ?)
                )`,
            )
            .bind(oldPublishedId, diaryId, oldPublishedId, oldPublishedId),
        ]
      : []
  // 先切换公开指针，再转换版本类型：两条语句都以同一版本号做守卫
  const [diaryResult, revisionResult] = await db.batch([
    db
      .prepare(
        `UPDATE diaries
            SET published_revision_id = ?, draft_revision_id = NULL, status = 'published',
                published_at = ?, updated_at = ?
          WHERE id = ? AND draft_revision_id = ? AND deleted_at IS NULL
            AND EXISTS (
              SELECT 1 FROM diary_revisions
               WHERE id = ? AND revision_type = 'working' AND revision_version = ?
            )`,
      )
      .bind(
        input.revisionId,
        now,
        now,
        diaryId,
        input.revisionId,
        input.revisionId,
        input.expectedVersion,
      ),
    db
      .prepare(
        `UPDATE diary_revisions
            SET revision_type = 'published', revision_version = revision_version + 1,
                updated_at = ?
          WHERE id = ? AND revision_type = 'working' AND revision_version = ?`,
      )
      .bind(now, input.revisionId, input.expectedVersion),
    ...pruneStatements,
  ])

  if ((diaryResult.meta.changes ?? 0) === 0 || (revisionResult.meta.changes ?? 0) === 0) {
    throw new AppError('REVISION_CONFLICT', '版本已发生变化，请刷新后再试')
  }

  await insertOperationLog(db, {
    id: newId(),
    adminId,
    actionType: mode === 'publish' ? 'diary_publish' : 'diary_commit',
    targetId: diaryId,
    summary: mode === 'publish' ? '发布日记' : '提交公开修改',
    now,
  })

  return { id: diaryId, publishedRevisionId: input.revisionId, publishedAt: now }
}

// 取消发布：立即停止访客展示，保留可继续编辑的工作版本
export async function unpublishDiary(
  db: D1Database,
  adminId: string,
  diaryId: string,
): Promise<{ id: string; draftRevisionId: string }> {
  const diary = await diaryRepo.findDiaryById(db, diaryId)
  if (!diary) {
    throw new AppError('NOT_FOUND', '日记不存在')
  }
  if (!diary.published_revision_id) {
    throw new AppError('DIARY_NOT_PUBLISHED', '日记尚未发布')
  }

  const now = nowIso()
  const statements: D1PreparedStatement[] = []
  let draftRevisionId = diary.draft_revision_id
  let createdRevisionId: string | null = null

  if (!draftRevisionId) {
    const published = await revisionRepo.findRevisionById(db, diary.published_revision_id)
    if (!published) {
      throw new AppError('REVISION_NOT_FOUND', '公开版本不存在')
    }
    draftRevisionId = newId()
    createdRevisionId = draftRevisionId
    const publishedPhotoIds = await revisionRepo.listRevisionPhotoIds(db, published.id)
    statements.push(
      db
        .prepare(
          `INSERT INTO diary_revisions (id, diary_id, content, revision_type, revision_version,
             created_at, updated_at)
           VALUES (?, ?, ?, 'working', 1, ?, ?)`,
        )
        .bind(draftRevisionId, diaryId, published.content, now, now),
      ...revisionRepo.buildCopyPhotoStatements(db, publishedPhotoIds, draftRevisionId, now, newId),
    )
  }

  const pointerIndex = statements.length
  statements.push(
    db
      .prepare(
        `UPDATE diaries
            SET published_revision_id = NULL, draft_revision_id = ?, status = 'draft',
                published_at = NULL, updated_at = ?
          WHERE id = ? AND published_revision_id = ? AND deleted_at IS NULL`,
      )
      .bind(draftRevisionId, now, diaryId, diary.published_revision_id),
  )

  // 取消发布后旧公开版本不再被任何指针引用，随事务清理其照片关联与版本记录
  const oldPublishedId = diary.published_revision_id
  statements.push(
    db
      .prepare(
        `DELETE FROM revision_photos WHERE revision_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM diaries
             WHERE id = ? AND (published_revision_id = ? OR draft_revision_id = ?)
          )`,
      )
      .bind(oldPublishedId, diaryId, oldPublishedId, oldPublishedId),
    db
      .prepare(
        `DELETE FROM diary_revisions WHERE id = ?
          AND NOT EXISTS (
            SELECT 1 FROM diaries
             WHERE id = ? AND (published_revision_id = ? OR draft_revision_id = ?)
          )`,
      )
      .bind(oldPublishedId, diaryId, oldPublishedId, oldPublishedId),
  )

  const results = await db.batch(statements)
  const pointerChanged = results[pointerIndex].meta.changes ?? 0

  if (pointerChanged === 0) {
    // 并发下公开指针已被改动：清理刚创建的工作版本，避免孤立数据
    if (createdRevisionId) {
      await db.batch([
        db.prepare('DELETE FROM revision_photos WHERE revision_id = ?').bind(createdRevisionId),
        db.prepare('DELETE FROM diary_revisions WHERE id = ?').bind(createdRevisionId),
      ])
    }
    throw new AppError('REVISION_CONFLICT', '日记状态已发生变化，请刷新后再试')
  }

  await insertOperationLog(db, {
    id: newId(),
    adminId,
    actionType: 'diary_unpublish',
    targetId: diaryId,
    summary: '取消发布日记',
    now,
  })

  return { id: diaryId, draftRevisionId }
}

// 软删除日记；可选地把不再被引用的照片加入清理任务
export async function deleteDiary(
  db: D1Database,
  adminId: string,
  diaryId: string,
  deleteUnreferencedPhotos: boolean,
): Promise<{ id: string; deleted: true; photosQueuedForCleanup: number }> {
  const diary = await diaryRepo.findDiaryById(db, diaryId)
  if (!diary) {
    throw new AppError('NOT_FOUND', '日记不存在')
  }

  const now = nowIso()
  const changed = await diaryRepo.softDeleteDiary(db, diaryId, now)
  if (changed === 0) {
    throw new AppError('NOT_FOUND', '日记不存在或已删除')
  }

  let queued = 0
  if (deleteUnreferencedPhotos) {
    const candidates = await photoRepo.listDiaryPhotoIds(db, diaryId)
    const stillReferenced = await photoRepo.listStillReferencedPhotoIds(db, candidates, diaryId)
    const referencedSet = new Set(stillReferenced)
    const eligible = candidates.filter((photoId) => !referencedSet.has(photoId))
    await photoRepo.enqueuePhotoCleanup(db, { photoIds: eligible, now, newId })
    queued = eligible.length
  }

  await insertOperationLog(db, {
    id: newId(),
    adminId,
    actionType: 'diary_delete',
    targetId: diaryId,
    summary: `删除日记（清理照片 ${queued} 张）`,
    now,
  })

  return { id: diaryId, deleted: true, photosQueuedForCleanup: queued }
}

// 复制日记：生成独立草稿，不复制公开状态
export async function duplicateDiary(
  db: D1Database,
  adminId: string,
  diaryId: string,
): Promise<{ id: string; draftRevisionId: string }> {
  const source = await diaryRepo.findDiaryById(db, diaryId)
  if (!source) {
    throw new AppError('NOT_FOUND', '日记不存在')
  }

  const sourceRevisionId = source.draft_revision_id ?? source.published_revision_id
  if (!sourceRevisionId) {
    throw new AppError('REVISION_NOT_FOUND', '源日记没有可复制的版本')
  }
  const sourceRevision = await revisionRepo.findRevisionById(db, sourceRevisionId)
  if (!sourceRevision) {
    throw new AppError('REVISION_NOT_FOUND', '源日记版本不存在')
  }

  const diaryIdNew = newId()
  const revisionId = newId()
  const now = nowIso()
  const sourcePhotoIds = await revisionRepo.listRevisionPhotoIds(db, sourceRevision.id)

  await db.batch([
    db
      .prepare(
        `INSERT INTO diaries (id, record_date, status, published_revision_id, draft_revision_id,
           created_at, updated_at, published_at, deleted_at)
         VALUES (?, ?, 'draft', NULL, ?, ?, ?, NULL, NULL)`,
      )
      .bind(diaryIdNew, source.record_date, revisionId, now, now),
    db
      .prepare(
        `INSERT INTO diary_revisions (id, diary_id, content, revision_type, revision_version,
           created_at, updated_at)
         VALUES (?, ?, ?, 'working', 1, ?, ?)`,
      )
      .bind(revisionId, diaryIdNew, sourceRevision.content, now, now),
    ...revisionRepo.buildCopyPhotoStatements(db, sourcePhotoIds, revisionId, now, newId),
  ])

  await insertOperationLog(db, {
    id: newId(),
    adminId,
    actionType: 'diary_duplicate',
    targetId: diaryIdNew,
    summary: `复制日记（来源 ${diaryId}）`,
    now,
  })

  return { id: diaryIdNew, draftRevisionId: revisionId }
}

// 批量操作：逐条执行并返回独立结果
export async function batchOperate(
  db: D1Database,
  adminId: string,
  action: string,
  ids: string[],
  deleteUnreferencedPhotos: boolean,
): Promise<{ results: Array<{ id: string; success: boolean; error?: { code: string; message: string } }> }> {
  if (action !== 'publish' && action !== 'unpublish' && action !== 'delete') {
    throw new AppError('VALIDATION_ERROR', '暂不支持该批量操作')
  }
  const results: Array<{
    id: string
    success: boolean
    error?: { code: string; message: string }
  }> = []

  for (const id of ids) {
    try {
      if (action === 'publish') {
        const diary = await diaryRepo.findDiaryById(db, id)
        if (!diary || !diary.draft_revision_id) {
          throw new AppError('DIARY_NOT_PUBLISHED', '日记没有待发布的工作版本')
        }
        const revision = await revisionRepo.findRevisionById(db, diary.draft_revision_id)
        if (!revision) {
          throw new AppError('REVISION_NOT_FOUND', '工作版本不存在')
        }
        await publishDiary(
          db,
          adminId,
          id,
          { revisionId: revision.id, expectedVersion: revision.revision_version },
          'publish',
        )
      } else if (action === 'unpublish') {
        await unpublishDiary(db, adminId, id)
      } else {
        await deleteDiary(db, adminId, id, deleteUnreferencedPhotos)
      }
      results.push({ id, success: true })
    } catch (err) {
      if (err instanceof AppError) {
        results.push({ id, success: false, error: { code: err.code, message: err.message } })
      } else {
        results.push({
          id,
          success: false,
          error: { code: 'INTERNAL_ERROR', message: '操作失败' },
        })
      }
    }
  }

  return { results }
}

// ---- 访客端 ----

export async function listPublicDiaries(
  db: D1Database,
  query: { page: number; limit: number; offset: number; year: string | null; month: string | null },
): Promise<{
  items: PublicDiaryListItem[]
  pagination: { page: number; limit: number; hasMore: boolean }
}> {
  const [rows, total] = await Promise.all([
    diaryRepo.listPublishedDiaries(db, {
      limit: query.limit,
      offset: query.offset,
      year: query.year,
      month: query.month,
    }),
    diaryRepo.countPublishedDiaries(db, { year: query.year, month: query.month }),
  ])

  const revisionIds = rows.map((row) => row.revision_id)
  const photos = await revisionRepo.listPhotosForRevisions(db, revisionIds)
  const photosByRevision = new Map<string, Array<{ id: string; thumbnailUrl: string }>>()
  for (const photo of photos) {
    const list = photosByRevision.get(photo.revision_id) ?? []
    list.push({
      id: photo.photo_id,
      thumbnailUrl: thumbnailUrl(photo.photo_id),
    })
    photosByRevision.set(photo.revision_id, list)
  }

  return {
    items: rows.map((row) => ({
      id: row.id,
      recordDate: row.record_date,
      contentPreview: buildPreview(row.content),
      photos: photosByRevision.get(row.revision_id) ?? [],
      publishedAt: row.published_at,
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      hasMore: query.offset + rows.length < total,
    },
  }
}

export async function getPublicDiary(
  db: D1Database,
  diaryId: string,
): Promise<PublicDiaryDetail> {
  const diary = await diaryRepo.findPublishedDiary(db, diaryId)
  if (!diary) {
    throw new AppError('NOT_FOUND', '日记不存在或尚未发布')
  }

  const photos = await revisionRepo.listRevisionPhotos(db, diary.revision_id)

  return {
    id: diary.id,
    recordDate: diary.record_date,
    content: diary.content,
    photos: photos
      .filter((photo) => photo.upload_status === 'uploaded')
      .map((photo) => ({
        id: photo.photo_id,
        sortOrder: photo.sort_order,
        imageUrl: `/api/media/${photo.photo_id}/original`,
      })),
    publishedAt: diary.published_at,
  }
}

// ---- 内部工具 ----

async function loadRevisionItem(
  db: D1Database,
  revisionId: string,
): Promise<AdminRevisionItem | null> {
  const revision = await revisionRepo.findRevisionById(db, revisionId)
  if (!revision) return null
  const photos = await revisionRepo.listRevisionPhotos(db, revisionId)
  return {
    id: revision.id,
    revisionVersion: revision.revision_version,
    content: revision.content,
    updatedAt: revision.updated_at,
    photos: photos.map((photo) => ({
      id: photo.photo_id,
      sortOrder: photo.sort_order,
      originalName: photo.original_name,
      mimeType: photo.mime_type,
      fileSize: photo.file_size,
      width: photo.width,
      height: photo.height,
      thumbnailUrl: `${thumbnailUrl(photo.photo_id)}`,
      imageUrl: `/api/media/${photo.photo_id}/original`,
    })),
  }
}

// 校验照片存在、未删除且已上传，并检查重复 ID
async function assertPhotosReady(db: D1Database, photoIds: string[]): Promise<void> {
  if (photoIds.length > MAX_PHOTOS) {
    throw new AppError('VALIDATION_ERROR', `单篇日记最多关联 ${MAX_PHOTOS} 张照片`)
  }
  const unique = new Set(photoIds)
  if (unique.size !== photoIds.length) {
    throw new AppError('VALIDATION_ERROR', '照片 ID 不能重复')
  }
  if (photoIds.length === 0) return

  const rows = await photoRepo.findPhotoStatuses(db, photoIds)
  if (rows.length !== photoIds.length) {
    throw new AppError('VALIDATION_ERROR', '存在无效的照片 ID')
  }
  const invalid = rows.find(
    (row) => row.deleted_at !== null || row.upload_status !== 'uploaded',
  )
  if (invalid) {
    throw new AppError('PHOTO_NOT_UPLOADED', '存在尚未上传成功的照片')
  }
}

function thumbnailUrl(photoId: string): string {
  return `/api/media/${photoId}/thumbnail`
}
