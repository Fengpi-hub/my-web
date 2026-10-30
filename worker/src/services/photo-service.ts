// 照片业务服务：上传意向 / 原图与缩略图上传 / 管理 / 受控访问 / 删除与清理
import type { Env } from '../env'
import { AppError } from '../utils/errors'
import { newId, nowIso } from '../utils/id'
import { randomToken } from '../utils/crypto'
import { buildPreview } from '../utils/http'
import {
  ALLOWED_ORIGINAL_MIME,
  ALLOWED_THUMBNAIL_MIME,
  MAX_ORIGINAL_BYTES,
  MAX_THUMBNAIL_BYTES,
  detectImageType,
  mimeForType,
  readImageDimensions,
  validateDimensions,
} from '../utils/image'
import * as photoRepo from '../repositories/photo-repository'
import * as revisionRepo from '../repositories/revision-repository'
import * as diaryRepo from '../repositories/diary-repository'
import * as authRepo from '../repositories/auth-repository'

const MAX_FILENAME_LENGTH = 200
const MAX_IDEMPOTENCY_LENGTH = 128
const UPLOAD_WINDOW_MS = 60 * 60 * 1000
const MAX_UPLOADS_PER_WINDOW = 60

export interface AdminPhotoListItem {
  id: string
  originalName: string
  mimeType: string
  fileSize: number
  width: number | null
  height: number | null
  uploadStatus: string
  uploadedAt: string | null
  createdAt: string
  thumbnailUrl: string
  imageUrl: string
  diaries: Array<{ id: string; recordDate: string; status: string }>
}

export interface PhotoDetail {
  id: string
  originalName: string
  mimeType: string
  fileSize: number
  width: number | null
  height: number | null
  uploadStatus: string
  uploadedAt: string | null
  createdAt: string
  thumbnailUrl: string
  imageUrl: string
  associations: Array<{
    revisionId: string
    revisionType: string
    diaryId: string
    recordDate: string
    diaryStatus: string
  }>
}

// ---- 上传 ----

export async function createUploadIntent(
  env: Env,
  adminId: string,
  input: {
    filename: string
    mimeType: string
    fileSize: number
    idempotencyKey: string
  },
): Promise<{ photoId: string; uploadUrl: string; status: string }> {
  const db = env.DB
  const filename = sanitizeFilename(input.filename)
  if (!filename) {
    throw new AppError('VALIDATION_ERROR', '文件名不能为空')
  }
  if (!ALLOWED_ORIGINAL_MIME.has(input.mimeType)) {
    throw new AppError('VALIDATION_ERROR', '仅支持 JPEG、PNG、WebP、GIF 图片', 415)
  }
  if (
    !Number.isFinite(input.fileSize) ||
    input.fileSize <= 0 ||
    input.fileSize > MAX_ORIGINAL_BYTES
  ) {
    throw new AppError('VALIDATION_ERROR', '单张照片不能超过 10MB', 413)
  }
  const idempotencyKey = input.idempotencyKey.trim()
  if (idempotencyKey.length < 8 || idempotencyKey.length > MAX_IDEMPOTENCY_LENGTH) {
    throw new AppError('VALIDATION_ERROR', '幂等标识长度不合法')
  }

  const existing = await photoRepo.findUploadIntent(db, idempotencyKey)
  if (existing) {
    if (
      existing.admin_id !== adminId ||
      existing.filename !== filename ||
      existing.mime_type !== input.mimeType ||
      existing.file_size !== input.fileSize
    ) {
      throw new AppError('IDEMPOTENCY_CONFLICT', '幂等标识已被其他请求使用')
    }
    return {
      photoId: existing.photo_id,
      uploadUrl: `/api/admin/photos/${existing.photo_id}/upload`,
      status: (await photoRepo.findPhotoById(db, existing.photo_id))?.upload_status ?? 'pending',
    }
  }

  const since = new Date(Date.now() - UPLOAD_WINDOW_MS).toISOString()
  const recent = await photoRepo.countRecentUploadEvents(db, adminId, since)
  if (recent >= MAX_UPLOADS_PER_WINDOW) {
    throw new AppError('RATE_LIMITED', '上传过于频繁，请稍后再试')
  }

  const photoId = newId()
  const now = nowIso()
  const ext = extensionForMime(input.mimeType)
  const r2Key = `original/${photoId}/${randomToken(8)}.${ext}`

  await db.batch([
    db
      .prepare(
        `INSERT INTO photos (id, r2_key, thumbnail_key, original_name, mime_type, file_size,
           width, height, upload_status, uploaded_at, created_at, updated_at, deleted_at)
         VALUES (?, ?, NULL, ?, ?, ?, NULL, NULL, 'pending', NULL, ?, ?, NULL)`,
      )
      .bind(photoId, r2Key, filename, input.mimeType, input.fileSize, now, now),
    db
      .prepare(
        `INSERT INTO photo_upload_intents (idempotency_key, photo_id, admin_id, filename,
           mime_type, file_size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(idempotencyKey, photoId, adminId, filename, input.mimeType, input.fileSize, now),
  ])

  await photoRepo.recordUploadEvent(db, { id: newId(), adminId, now })

  return {
    photoId,
    uploadUrl: `/api/admin/photos/${photoId}/upload`,
    status: 'pending',
  }
}

export async function uploadOriginal(
  env: Env,
  adminId: string,
  photoId: string,
  request: Request,
): Promise<{
  photoId: string
  status: string
  width: number
  height: number
  mimeType: string
  fileSize: number
  thumbnailUrl: string
  imageUrl: string
}> {
  const db = env.DB
  const photo = await photoRepo.findPhotoById(db, photoId)
  if (!photo || photo.deleted_at !== null) {
    throw new AppError('NOT_FOUND', '照片不存在')
  }
  if (!['pending', 'uploading', 'failed'].includes(photo.upload_status)) {
    throw new AppError('IDEMPOTENCY_CONFLICT', '照片已完成上传，不能重复覆盖')
  }

  const declared = Number(request.headers.get('Content-Length') ?? '0')
  if (declared > MAX_ORIGINAL_BYTES) {
    throw new AppError('VALIDATION_ERROR', '单张照片不能超过 10MB', 413)
  }

  const buffer = await request.arrayBuffer()
  if (buffer.byteLength === 0) {
    throw new AppError('VALIDATION_ERROR', '上传内容为空')
  }
  if (buffer.byteLength > MAX_ORIGINAL_BYTES) {
    throw new AppError('VALIDATION_ERROR', '单张照片不能超过 10MB', 413)
  }

  const bytes = new Uint8Array(buffer)
  const type = detectImageType(bytes)
  if (!type) {
    throw new AppError('VALIDATION_ERROR', '文件不是受支持的图片格式', 415)
  }
  const mimeType = mimeForType(type)
  const dimensions = readImageDimensions(bytes, type)
  if (!dimensions || !validateDimensions(dimensions)) {
    throw new AppError('VALIDATION_ERROR', '图片尺寸异常或文件已损坏', 415)
  }

  const now = nowIso()
  const changed = await photoRepo.markPhotoUploading(db, photoId, now)
  if (changed === 0) {
    throw new AppError('IDEMPOTENCY_CONFLICT', '照片状态已变化，请刷新后重试')
  }

  try {
    await env.IMAGES_BUCKET.put(photo.r2_key, buffer, {
      httpMetadata: {
        contentType: mimeType,
        cacheControl: 'private, no-store',
      },
    })
  } catch (err) {
    await photoRepo.markPhotoFailed(db, photoId, nowIso())
    console.error('R2 upload failed:', err)
    throw new AppError('PHOTO_UPLOAD_FAILED', '照片保存失败，请重试')
  }

  await photoRepo.markPhotoUploaded(db, {
    photoId,
    mimeType,
    fileSize: buffer.byteLength,
    width: dimensions.width,
    height: dimensions.height,
    now: nowIso(),
  })

  await authRepo.insertOperationLog(db, {
    id: newId(),
    adminId,
    actionType: 'photo_upload',
    targetId: photoId,
    summary: `上传照片 ${buildPreview(photo.original_name, 60)}`,
    now: nowIso(),
  })

  return {
    photoId,
    status: 'uploaded',
    width: dimensions.width,
    height: dimensions.height,
    mimeType,
    fileSize: buffer.byteLength,
    thumbnailUrl: `/api/admin/photos/${photoId}/thumbnail`,
    imageUrl: `/api/admin/photos/${photoId}/original`,
  }
}

export async function uploadThumbnail(
  env: Env,
  adminId: string,
  photoId: string,
  request: Request,
): Promise<{ photoId: string; thumbnailUrl: string }> {
  const db = env.DB
  const photo = await photoRepo.findPhotoById(db, photoId)
  if (!photo || photo.deleted_at !== null) {
    throw new AppError('NOT_FOUND', '照片不存在')
  }
  if (photo.upload_status !== 'uploaded') {
    throw new AppError('PHOTO_NOT_UPLOADED', '请先完成原图上传')
  }

  const buffer = await request.arrayBuffer()
  if (buffer.byteLength === 0) {
    throw new AppError('VALIDATION_ERROR', '缩略图内容为空')
  }
  if (buffer.byteLength > MAX_THUMBNAIL_BYTES) {
    throw new AppError('VALIDATION_ERROR', '缩略图不能超过 2MB', 413)
  }

  const bytes = new Uint8Array(buffer)
  const type = detectImageType(bytes)
  if (!type) {
    throw new AppError('VALIDATION_ERROR', '缩略图不是受支持的图片格式', 415)
  }
  const mimeType = mimeForType(type)
  if (!ALLOWED_THUMBNAIL_MIME.has(mimeType)) {
    throw new AppError('VALIDATION_ERROR', '缩略图仅支持 JPEG、PNG、WebP', 415)
  }

  const thumbnailKey = photo.thumbnail_key ?? `thumbnail/${photoId}/${randomToken(8)}.${extensionForMime(mimeType)}`
  try {
    await env.IMAGES_BUCKET.put(thumbnailKey, buffer, {
      httpMetadata: { contentType: mimeType, cacheControl: 'private, no-store' },
    })
  } catch (err) {
    console.error('R2 thumbnail upload failed:', err)
    throw new AppError('PHOTO_UPLOAD_FAILED', '缩略图保存失败，请重试')
  }

  await photoRepo.updateThumbnailKey(db, photoId, thumbnailKey, nowIso())
  await authRepo.insertOperationLog(db, {
    id: newId(),
    adminId,
    actionType: 'photo_thumbnail',
    targetId: photoId,
    summary: '上传照片缩略图',
    now: nowIso(),
  })

  return { photoId, thumbnailUrl: `/api/admin/photos/${photoId}/thumbnail` }
}

// ---- 管理 ----

export async function listPhotos(
  db: D1Database,
  params: {
    page: number
    limit: number
    offset: number
    keyword: string | null
    status: string | null
    diaryId: string | null
    unassociated: boolean
  },
): Promise<{
  items: AdminPhotoListItem[]
  pagination: { page: number; limit: number; total: number; hasMore: boolean }
}> {
  const filter = {
    keyword: params.keyword,
    status: params.status,
    diaryId: params.diaryId,
    unassociated: params.unassociated,
  }
  const [rows, total] = await Promise.all([
    photoRepo.listAdminPhotos(db, {
      ...filter,
      limit: params.limit,
      offset: params.offset,
    }),
    photoRepo.countAdminPhotos(db, filter),
  ])

  const links = await photoRepo.listPhotoDiaryLinks(
    db,
    rows.map((row) => row.id),
  )
  const diariesByPhoto = new Map<string, Array<{ id: string; recordDate: string; status: string }>>()
  for (const link of links) {
    if (link.revision_type !== 'working' && link.diary_status !== 'published') continue
    const list = diariesByPhoto.get(link.photo_id) ?? []
    if (!list.some((item) => item.id === link.diary_id)) {
      list.push({ id: link.diary_id, recordDate: link.record_date, status: link.diary_status })
    }
    diariesByPhoto.set(link.photo_id, list)
  }

  return {
    items: rows.map((row) => ({
      id: row.id,
      originalName: row.original_name,
      mimeType: row.mime_type,
      fileSize: row.file_size,
      width: row.width,
      height: row.height,
      uploadStatus: row.upload_status,
      uploadedAt: row.uploaded_at,
      createdAt: row.created_at,
      thumbnailUrl: `/api/admin/photos/${row.id}/thumbnail`,
      imageUrl: `/api/admin/photos/${row.id}/original`,
      diaries: diariesByPhoto.get(row.id) ?? [],
    })),
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      hasMore: params.offset + rows.length < total,
    },
  }
}

export async function getPhotoDetail(
  db: D1Database,
  photoId: string,
): Promise<PhotoDetail> {
  const photo = await photoRepo.findPhotoById(db, photoId)
  if (!photo || photo.deleted_at !== null) {
    throw new AppError('NOT_FOUND', '照片不存在')
  }
  const associations = await photoRepo.listPhotoAssociations(db, photoId)

  return {
    id: photo.id,
    originalName: photo.original_name,
    mimeType: photo.mime_type,
    fileSize: photo.file_size,
    width: photo.width,
    height: photo.height,
    uploadStatus: photo.upload_status,
    uploadedAt: photo.uploaded_at,
    createdAt: photo.created_at,
    thumbnailUrl: `/api/admin/photos/${photoId}/thumbnail`,
    imageUrl: `/api/admin/photos/${photoId}/original`,
    associations: associations.map((item) => ({
      revisionId: item.revision_id,
      revisionType: item.revision_type,
      diaryId: item.diary_id,
      recordDate: item.record_date,
      diaryStatus: item.diary_status,
    })),
  }
}

// 删除照片：先校验全部引用，再创建清理任务并尝试删除 R2 对象
export async function deletePhoto(
  env: Env,
  adminId: string,
  photoId: string,
): Promise<{
  photoId: string
  status: 'deleted' | 'deleting'
  taskId: string
  message: string
}> {
  const db = env.DB
  const photo = await photoRepo.findPhotoById(db, photoId)
  if (!photo || photo.deleted_at !== null) {
    throw new AppError('NOT_FOUND', '照片不存在')
  }

  const publishedRefs = await photoRepo.countPublishedReferences(db, photoId)
  if (publishedRefs > 0) {
    throw new AppError('PHOTO_IN_USE', '照片仍被公开日记引用，请先取消发布或移除关联')
  }
  const anyRefs = await photoRepo.countAnyReferences(db, photoId)
  if (anyRefs > 0) {
    throw new AppError('PHOTO_IN_USE', '照片仍被日记版本引用，请先移除关联')
  }

  const now = nowIso()
  const taskId = newId()
  await photoRepo.createCleanupTask(db, { id: taskId, photoId, now })
  await photoRepo.markCleanupTaskRunning(db, taskId, now)

  let success = true
  let errorMessage: string | null = null
  try {
    if (photo.r2_key) {
      await env.IMAGES_BUCKET.delete(photo.r2_key)
    }
    if (photo.thumbnail_key) {
      await env.IMAGES_BUCKET.delete(photo.thumbnail_key)
    }
  } catch (err) {
    success = false
    errorMessage = err instanceof Error ? err.message.slice(0, 200) : '未知错误'
    console.error('R2 delete failed:', err)
  }

  if (success) {
    await photoRepo.markPhotoDeleted(db, photoId, nowIso())
    await photoRepo.markCleanupTaskResult(db, taskId, true, null, nowIso())
  } else {
    await photoRepo.markCleanupTaskResult(db, taskId, false, errorMessage, nowIso())
  }

  await authRepo.insertOperationLog(db, {
    id: newId(),
    adminId,
    actionType: 'photo_delete',
    targetId: photoId,
    summary: success ? '删除照片及文件' : '删除照片文件失败，已保留清理任务',
    now: nowIso(),
  })

  if (!success) {
    throw new AppError('PHOTO_DELETE_FAILED', '照片文件删除失败，已记录清理任务以便重试')
  }

  return { photoId, status: 'deleted', taskId, message: '照片已删除' }
}

// 调整工作版本照片顺序（同一组照片重新排序）
export async function reorderDraftPhotos(
  db: D1Database,
  adminId: string,
  diaryId: string,
  input: { revisionId: string; expectedVersion: number; photoIds: string[] },
): Promise<{ revisionId: string; revisionVersion: number; photoIds: string[] }> {
  const diary = await diaryRepo.findDiaryById(db, diaryId)
  if (!diary) {
    throw new AppError('NOT_FOUND', '日记不存在')
  }
  if (!diary.draft_revision_id || diary.draft_revision_id !== input.revisionId) {
    throw new AppError('REVISION_NOT_FOUND', '当前没有可编辑的工作版本')
  }

  const revision = await revisionRepo.findRevisionById(db, input.revisionId)
  if (!revision || revision.diary_id !== diaryId || revision.revision_type !== 'working') {
    throw new AppError('REVISION_NOT_FOUND', '工作版本不存在')
  }
  if (revision.revision_version !== input.expectedVersion) {
    throw new AppError('REVISION_CONFLICT', '内容已在其他窗口更新，请刷新后再试')
  }
  if (new Set(input.photoIds).size !== input.photoIds.length) {
    throw new AppError('VALIDATION_ERROR', '照片 ID 不能重复')
  }

  const currentIds = await revisionRepo.listRevisionPhotoIds(db, input.revisionId)
  const currentSet = new Set(currentIds)
  const nextSet = new Set(input.photoIds)
  if (
    currentIds.length !== input.photoIds.length ||
    [...currentSet].some((id) => !nextSet.has(id))
  ) {
    throw new AppError('VALIDATION_ERROR', '排序必须包含且仅包含当前版本的全部照片')
  }

  const now = nowIso()
  const changed = await revisionRepo.bumpWorkingRevision(db, {
    revisionId: input.revisionId,
    diaryId,
    expectedVersion: input.expectedVersion,
    now,
  })
  if (changed === 0) {
    throw new AppError('REVISION_CONFLICT', '内容已在其他窗口更新，请刷新后再试')
  }

  await db.batch([
    ...revisionRepo.buildReplacePhotoStatements(db, input.revisionId, input.photoIds, now, newId),
    db.prepare('UPDATE diaries SET updated_at = ? WHERE id = ?').bind(now, diaryId),
  ])

  await authRepo.insertOperationLog(db, {
    id: newId(),
    adminId,
    actionType: 'photo_reorder',
    targetId: diaryId,
    summary: `调整照片顺序（${input.photoIds.length} 张）`,
    now,
  })

  return {
    revisionId: input.revisionId,
    revisionVersion: input.expectedVersion + 1,
    photoIds: input.photoIds,
  }
}

// ---- 受控媒体访问 ----

export async function getMediaObject(
  env: Env,
  photoId: string,
  variant: 'original' | 'thumbnail',
  options: { publicAccess: boolean },
): Promise<{ object: R2ObjectBody; mimeType: string; cacheControl: string }> {
  const db = env.DB
  const photo = await photoRepo.findPhotoById(db, photoId)
  if (!photo || photo.deleted_at !== null || photo.upload_status !== 'uploaded') {
    throw new AppError('NOT_FOUND', '照片不存在')
  }
  if (options.publicAccess) {
    const refs = await photoRepo.countPublishedReferences(db, photoId)
    if (refs === 0) {
      throw new AppError('NOT_FOUND', '照片不存在')
    }
  }

  const key =
    variant === 'thumbnail' && photo.thumbnail_key ? photo.thumbnail_key : photo.r2_key
  const object = await env.IMAGES_BUCKET.get(key)
  if (!object) {
    throw new AppError('NOT_FOUND', '照片文件不存在')
  }
  return {
    object,
    mimeType: photo.mime_type,
    cacheControl: options.publicAccess
      ? 'public, max-age=300, stale-while-revalidate=60'
      : 'private, no-store',
  }
}

// 构造图片响应，支持 ETag 条件请求并避免 MIME 嗅探
export function buildMediaResponse(
  request: Request,
  object: R2ObjectBody,
  mimeType: string,
  cacheControl: string,
): Response {
  const etag = object.httpEtag
  const headers: Record<string, string> = {
    'Content-Type': mimeType,
    'Content-Length': String(object.size),
    'Cache-Control': cacheControl,
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  }

  const ifNoneMatch = request.headers.get('If-None-Match')
  if (ifNoneMatch) {
    const candidates = ifNoneMatch.split(',').map((value) => value.trim())
    if (candidates.includes(etag) || candidates.includes('*')) {
      return new Response(null, { status: 304, headers })
    }
  }

  return new Response(object.body, { status: 200, headers })
}

// ---- 工具 ----

// 清理原文件名：去控制字符、路径分隔符，并限制长度
function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '_')
    .trim()
  if (!cleaned) return ''
  return cleaned.slice(0, MAX_FILENAME_LENGTH)
}

function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    default:
      return 'bin'
  }
}
