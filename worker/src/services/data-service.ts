// 数据管理服务：ZIP 导出、任务查询、下载、导入预览与合并恢复
import type { Env } from '../env'
import { AppError } from '../utils/errors'
import { newId, nowIso } from '../utils/id'
import { randomToken } from '../utils/crypto'
import { createZip, readZip } from '../utils/zip'
import * as dataRepo from '../repositories/data-repository'
import * as authRepo from '../repositories/auth-repository'

export type ExportScope = 'all' | 'published' | 'draft' | 'selected'

const MAX_EXPORT_BYTES = 100 * 1024 * 1024
const MAX_IMPORT_BYTES = 100 * 1024 * 1024
const MAX_IMPORT_ENTRIES = 5000
const MAX_IMPORT_ENTRY_BYTES = 100 * 1024 * 1024
const MAX_IMPORT_TOTAL_BYTES = 120 * 1024 * 1024
const MAX_IMPORT_DIARIES = 2000
const MAX_IMPORT_PHOTOS = 5000
const EXPORT_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000
const PREVIEW_EXPIRES_MS = 30 * 60 * 1000

interface ExportRevisionJson {
  id: string
  content: string
  revisionVersion: number
  createdAt: string
  updatedAt: string
  photos: Array<{ photoId: string; sortOrder: number }>
}

interface ExportDiaryJson {
  id: string
  recordDate: string
  status: 'draft' | 'published'
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  publishedRevision: ExportRevisionJson | null
  draftRevision: ExportRevisionJson | null
}

interface ExportPhotoJson {
  id: string
  originalName: string
  mimeType: string
  fileSize: number
  width: number | null
  height: number | null
  uploadedAt: string | null
  createdAt: string
  file: string
}

interface ExportDocument {
  version: 1
  exportedAt: string
  scope: ExportScope
  diaries: ExportDiaryJson[]
  photos: ExportPhotoJson[]
}

interface ParsedImport {
  diaries: ExportDiaryJson[]
  photos: ExportPhotoJson[]
  invalidRecords: number
  conflicts: number
}

// ---- 导出 ----

export async function createExportTask(
  env: Env,
  adminId: string,
  scope: ExportScope,
  ctx: ExecutionContext,
  diaryIds: string[] = [],
): Promise<{ taskId: string; status: string }> {
  if (!['all', 'published', 'draft', 'selected'].includes(scope)) {
    throw new AppError('VALIDATION_ERROR', '导出范围不正确')
  }
  if (scope === 'selected' && diaryIds.length === 0) {
    throw new AppError('VALIDATION_ERROR', '请选择要导出的日记')
  }
  const taskId = newId()
  const now = nowIso()
  await dataRepo.createDataTask(env.DB, {
    id: taskId,
    taskType: 'export',
    status: 'pending',
    scope,
    now,
  })

  // 后台生成，避免阻塞响应
  ctx.waitUntil(runExport(env, adminId, taskId, scope, diaryIds))
  return { taskId, status: 'pending' }
}

export async function runExport(
  env: Env,
  adminId: string,
  taskId: string,
  scope: ExportScope,
  diaryIds: string[] = [],
): Promise<void> {
  try {
    await dataRepo.updateTaskProgress(env.DB, taskId, 5, nowIso())

    const diaries =
      scope === 'selected'
        ? await dataRepo.listExportDiariesByIds(env.DB, diaryIds)
        : await dataRepo.listExportDiaries(env.DB, scope)
    const revisionIds: string[] = []
    for (const diary of diaries) {
      if (diary.published_revision_id) revisionIds.push(diary.published_revision_id)
      if (diary.draft_revision_id) revisionIds.push(diary.draft_revision_id)
    }
    const links = await dataRepo.listRevisionPhotoLinks(env.DB, revisionIds)
    await dataRepo.updateTaskProgress(env.DB, taskId, 35, nowIso())

    const photoIds = Array.from(new Set(links.map((link) => link.photo_id)))
    const mediaRows = await dataRepo.listPhotoMedia(env.DB, photoIds)
    const mediaById = new Map(
      mediaRows
        .filter((row) => row.upload_status === 'uploaded' && row.deleted_at === null)
        .map((row) => [row.id, row]),
    )

    const linksByRevision = new Map<string, Array<{ photoId: string; sortOrder: number }>>()
    for (const link of links) {
      if (!mediaById.has(link.photo_id)) continue
      const list = linksByRevision.get(link.revision_id) ?? []
      list.push({ photoId: link.photo_id, sortOrder: link.sort_order })
      linksByRevision.set(link.revision_id, list)
    }

    const photos: ExportPhotoJson[] = Array.from(mediaById.values()).map((row) => ({
      id: row.id,
      originalName: row.original_name,
      mimeType: row.mime_type,
      fileSize: row.file_size,
      width: row.width,
      height: row.height,
      uploadedAt: row.uploaded_at,
      createdAt: row.created_at,
      file: `photos/${row.id}.${extensionForMime(row.mime_type)}`,
    }))

    const buildRevision = (
      id: string | null,
      content: string | null,
      version: number | null,
      createdAt: string | null,
      updatedAt: string | null,
    ): ExportRevisionJson | null => {
      if (!id || content === null) return null
      return {
        id,
        content,
        revisionVersion: version ?? 1,
        createdAt: createdAt ?? nowIso(),
        updatedAt: updatedAt ?? nowIso(),
        photos: linksByRevision.get(id) ?? [],
      }
    }

    const document: ExportDocument = {
      version: 1,
      exportedAt: nowIso(),
      scope,
      diaries: diaries.map((diary) => ({
        id: diary.id,
        recordDate: diary.record_date,
        status: diary.status === 'published' ? 'published' : 'draft',
        createdAt: diary.created_at,
        updatedAt: diary.updated_at,
        publishedAt: diary.published_at,
        publishedRevision: buildRevision(
          diary.published_revision_id,
          diary.pub_content,
          diary.pub_version,
          diary.pub_created_at,
          diary.pub_updated_at,
        ),
        draftRevision: buildRevision(
          diary.draft_revision_id,
          diary.draft_content,
          diary.draft_version,
          diary.draft_created_at,
          diary.draft_updated_at,
        ),
      })),
      photos,
    }

    const entries = [
      { path: 'diary-data.json', data: textBytes(JSON.stringify(document, null, 2)) },
      { path: 'diary-data.csv', data: textBytes(buildCsv(document)) },
      { path: 'README.txt', data: textBytes(buildReadme()) },
    ]

    let exportedBytes = entries.reduce((sum, entry) => sum + entry.data.length, 0)
    let missingFiles = 0
    let photoIndex = 0

    for (const photo of photos) {
      photoIndex += 1
      if (photoIndex % 10 === 0) {
        await dataRepo.updateTaskProgress(
          env.DB,
          taskId,
          35 + Math.round((photoIndex / photos.length) * 45),
          nowIso(),
        )
      }
      const media = mediaById.get(photo.id)
      if (!media) continue
      const object = await env.IMAGES_BUCKET.get(media.r2_key)
      if (!object) {
        missingFiles += 1
        continue
      }
      const bytes = new Uint8Array(await object.arrayBuffer())
      exportedBytes += bytes.length
      if (exportedBytes > MAX_EXPORT_BYTES) {
        throw new AppError('VALIDATION_ERROR', '导出内容超过 100MB，请缩小导出范围')
      }
      entries.push({ path: photo.file, data: bytes })
    }

    await dataRepo.updateTaskProgress(env.DB, taskId, 85, nowIso())
    const zip = createZip(entries)
    const r2Key = `exports/${taskId}.zip`
    await env.IMAGES_BUCKET.put(r2Key, zip, {
      httpMetadata: { contentType: 'application/zip', cacheControl: 'private, no-store' },
    })

    const summary = JSON.stringify({
      scope,
      diaries: document.diaries.length,
      photos: photos.length - missingFiles,
      missingFiles,
      bytes: zip.length,
    })
    await dataRepo.completeDataTask(env.DB, {
      id: taskId,
      summary,
      now: nowIso(),
      r2Key,
      expiresAt: new Date(Date.now() + EXPORT_EXPIRES_MS).toISOString(),
    })

    await authRepo.insertOperationLog(env.DB, {
      id: newId(),
      adminId,
      actionType: 'data_export',
      targetId: taskId,
      summary: `导出数据（${scopeLabel(scope)}）：${document.diaries.length} 篇日记、${photos.length} 张照片`,
      now: nowIso(),
    })
  } catch (err) {
    console.error('Export task failed:', err)
    await dataRepo.failDataTask(
      env.DB,
      taskId,
      err instanceof AppError ? err.message : '导出失败，请稍后再试',
      nowIso(),
    )
  }
}

// ---- 任务查询与下载 ----

export async function getTask(
  db: D1Database,
  taskId: string,
): Promise<{
  taskId: string
  taskType: string
  status: string
  progress: number
  scope: string | null
  downloadAvailable: boolean
  counts: Record<string, number> | null
  errorMessage: string | null
  createdAt: string
  expiresAt: string | null
}> {
  const task = await dataRepo.findDataTask(db, taskId)
  if (!task) {
    throw new AppError('NOT_FOUND', '任务不存在')
  }
  let counts: Record<string, number> | null = null
  if (task.result_summary) {
    try {
      counts = JSON.parse(task.result_summary) as Record<string, number>
    } catch {
      counts = null
    }
  }
  return {
    taskId: task.id,
    taskType: task.task_type,
    status: task.status,
    progress: task.progress,
    scope: task.scope,
    downloadAvailable: task.status === 'completed' && task.task_type === 'export' && !!task.r2_key,
    counts,
    errorMessage: task.error_message,
    createdAt: task.created_at,
    expiresAt: task.expires_at,
  }
}

export async function getExportDownload(
  env: Env,
  taskId: string,
  request: Request,
): Promise<Response> {
  const task = await dataRepo.findDataTask(env.DB, taskId)
  if (!task || task.task_type !== 'export') {
    throw new AppError('NOT_FOUND', '导出任务不存在')
  }
  if (task.status !== 'completed' || !task.r2_key) {
    throw new AppError('TASK_NOT_READY', '导出文件尚未生成完成')
  }
  if (task.expires_at && new Date(task.expires_at).getTime() <= Date.now()) {
    throw new AppError('TASK_NOT_READY', '导出文件已过期，请重新导出')
  }

  const object = await env.IMAGES_BUCKET.get(task.r2_key)
  if (!object) {
    throw new AppError('NOT_FOUND', '导出文件不存在')
  }

  const filename = `life-diary-export-${task.created_at.slice(0, 10)}.zip`
  return new Response(request.method === 'HEAD' ? null : object.body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(object.size),
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}

// ---- 导入 ----

export async function uploadImportZip(
  env: Env,
  request: Request,
): Promise<{ uploadId: string; size: number; expiresAt: string }> {
  const declared = Number(request.headers.get('Content-Length') ?? '0')
  if (declared > MAX_IMPORT_BYTES) {
    throw new AppError('VALIDATION_ERROR', '恢复文件不能超过 100MB', 413)
  }
  const buffer = await request.arrayBuffer()
  if (buffer.byteLength === 0) {
    throw new AppError('VALIDATION_ERROR', '上传文件为空')
  }
  if (buffer.byteLength > MAX_IMPORT_BYTES) {
    throw new AppError('VALIDATION_ERROR', '恢复文件不能超过 100MB', 413)
  }
  const bytes = new Uint8Array(buffer)
  if (
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  ) {
    throw new AppError('IMPORT_INVALID', '文件不是有效的 ZIP 压缩包')
  }

  const uploadId = newId()
  const expiresAt = new Date(Date.now() + PREVIEW_EXPIRES_MS * 2).toISOString()
  await env.IMAGES_BUCKET.put(`temp/imports/${uploadId}.zip`, buffer, {
    httpMetadata: { contentType: 'application/zip', cacheControl: 'private, no-store' },
  })
  await dataRepo.createDataTask(env.DB, {
    id: uploadId,
    taskType: 'import',
    status: 'pending',
    scope: 'upload',
    now: nowIso(),
    expiresAt,
  })
  return { uploadId, size: buffer.byteLength, expiresAt }
}

export async function previewImport(
  env: Env,
  uploadId: string,
): Promise<{
  previewId: string
  newRecords: number
  existingRecords: number
  conflicts: number
  invalidRecords: number
  missingPhotos: number
  expiresAt: string
}> {
  const task = await dataRepo.findDataTask(env.DB, uploadId)
  if (!task || task.task_type !== 'import' || task.scope !== 'upload') {
    throw new AppError('NOT_FOUND', '上传记录不存在，请重新上传')
  }
  if (task.expires_at && new Date(task.expires_at).getTime() <= Date.now()) {
    throw new AppError('IMPORT_INVALID', '上传文件已过期，请重新上传')
  }

  const document = await loadImportDocument(env, uploadId)
  const entries = await readZipEntries(env, uploadId)
  const parsed = parseImportDocument(document, entries)

  const existingDiaries = await dataRepo.findExistingDiaryIds(
    env.DB,
    parsed.diaries.map((diary) => diary.id),
  )
  const existingPhotos = await dataRepo.findExistingPhotoIds(
    env.DB,
    parsed.photos.map((photo) => photo.id),
  )

  let newRecords = 0
  let existingRecords = 0
  let missingPhotos = 0
  const photoPathById = new Map(parsed.photos.map((photo) => [photo.id, photo.file]))

  for (const diary of parsed.diaries) {
    if (existingDiaries.has(diary.id)) {
      existingRecords += 1
      continue
    }
    newRecords += 1
    for (const revision of [diary.publishedRevision, diary.draftRevision]) {
      if (!revision) continue
      for (const link of revision.photos) {
        if (existingPhotos.has(link.photoId)) continue
        const path = photoPathById.get(link.photoId)
        if (!path || !entries.has(path)) {
          missingPhotos += 1
        }
      }
    }
  }

  const expiresAt = new Date(Date.now() + PREVIEW_EXPIRES_MS).toISOString()
  const summary = JSON.stringify({
    newRecords,
    existingRecords,
    conflicts: parsed.conflicts,
    invalidRecords: parsed.invalidRecords,
    missingPhotos,
  })
  await dataRepo.markTaskPreview(env.DB, {
    id: uploadId,
    summary,
    now: nowIso(),
    expiresAt,
  })

  return {
    previewId: uploadId,
    newRecords,
    existingRecords,
    conflicts: parsed.conflicts,
    invalidRecords: parsed.invalidRecords,
    missingPhotos,
    expiresAt,
  }
}

export async function confirmImport(
  env: Env,
  adminId: string,
  previewId: string,
): Promise<{ taskId: string; status: string }> {
  const task = await dataRepo.findDataTask(env.DB, previewId)
  if (!task || task.task_type !== 'import' || task.scope !== 'preview') {
    throw new AppError('NOT_FOUND', '恢复预览不存在，请重新上传并预览')
  }
  if (task.status !== 'pending') {
    throw new AppError('IMPORT_CONFLICT', '该恢复任务已处理，不能重复提交')
  }
  if (task.expires_at && new Date(task.expires_at).getTime() <= Date.now()) {
    throw new AppError('IMPORT_INVALID', '恢复预览已过期，请重新上传')
  }

  const document = await loadImportDocument(env, previewId)
  const entries = await readZipEntries(env, previewId)
  const parsed = parseImportDocument(document, entries)

  // 重新检查当前数据，避免预览后数据变化
  const existingDiaries = await dataRepo.findExistingDiaryIds(
    env.DB,
    parsed.diaries.map((diary) => diary.id),
  )
  const existingPhotos = await dataRepo.findExistingPhotoIds(
    env.DB,
    parsed.photos.map((photo) => photo.id),
  )
  const photoById = new Map(parsed.photos.map((photo) => [photo.id, photo]))

  let imported = 0
  let skipped = 0
  let errors = 0
  let missingPhotos = 0
  let photosImported = 0
  const errorMessages: string[] = []

  for (const diary of parsed.diaries) {
    if (existingDiaries.has(diary.id)) {
      skipped += 1
      continue
    }
    try {
      const photoStatements: D1PreparedStatement[] = []
      const revisionPhotos: Array<{ revisionId: string; photoId: string; sortOrder: number }> = []
      const newPhotoIds = new Set<string>()

      for (const revision of [diary.publishedRevision, diary.draftRevision]) {
        if (!revision) continue
        for (const link of revision.photos) {
          if (existingPhotos.has(link.photoId)) {
            revisionPhotos.push({
              revisionId: revision.id,
              photoId: link.photoId,
              sortOrder: link.sortOrder,
            })
            continue
          }
          if (newPhotoIds.has(link.photoId)) {
            revisionPhotos.push({
              revisionId: revision.id,
              photoId: link.photoId,
              sortOrder: link.sortOrder,
            })
            continue
          }
          const photo = photoById.get(link.photoId)
          if (!photo) {
            missingPhotos += 1
            continue
          }
          const bytes = entries.get(photo.file)
          if (!bytes) {
            missingPhotos += 1
            continue
          }
          const ext = extensionForMime(photo.mimeType)
          const r2Key = `original/${photo.id}/${randomToken(8)}.${ext}`
          await env.IMAGES_BUCKET.put(r2Key, bytes, {
            httpMetadata: {
              contentType: photo.mimeType,
              cacheControl: 'private, no-store',
            },
          })
          photoStatements.push(
            dataRepo.buildImportPhotoStatement(
              env.DB,
              {
                id: photo.id,
                r2Key,
                originalName: photo.originalName,
                mimeType: photo.mimeType,
                fileSize: photo.fileSize,
                width: photo.width,
                height: photo.height,
                uploadedAt: photo.uploadedAt,
                createdAt: photo.createdAt,
              },
              nowIso(),
            ),
          )
          newPhotoIds.add(photo.id)
          revisionPhotos.push({
            revisionId: revision.id,
            photoId: link.photoId,
            sortOrder: link.sortOrder,
          })
        }
      }

      const revisions = [diary.publishedRevision, diary.draftRevision]
        .filter((revision): revision is ExportRevisionJson => revision !== null)
        .map((revision) => {
          const revisionType: 'published' | 'working' =
            revision.id === diary.publishedRevision?.id ? 'published' : 'working'
          return {
            id: revision.id,
            content: revision.content,
            revisionType,
            version: revision.revisionVersion,
            createdAt: revision.createdAt,
            updatedAt: revision.updatedAt,
          }
        })

      const statements = [
        ...photoStatements,
        ...dataRepo.buildImportDiaryStatements(
          env.DB,
          {
            diaryId: diary.id,
            recordDate: diary.recordDate,
            status: diary.status,
            createdAt: diary.createdAt,
            updatedAt: diary.updatedAt,
            publishedAt: diary.publishedAt,
            publishedRevisionId: diary.publishedRevision?.id ?? null,
            draftRevisionId: diary.draftRevision?.id ?? null,
            revisions,
            revisionPhotos,
          },
          nowIso(),
        ),
      ]

      await env.DB.batch(statements)
      imported += 1
      photosImported += newPhotoIds.size
    } catch (err) {
      errors += 1
      errorMessages.push(
        `${diary.recordDate}：${err instanceof Error ? err.message.slice(0, 80) : '导入失败'}`,
      )
    }
  }

  const summary = JSON.stringify({
    imported,
    skipped,
    errors,
    missingPhotos,
    photosImported,
  })
  await dataRepo.completeDataTask(env.DB, {
    id: previewId,
    summary,
    now: nowIso(),
  })
  await dataRepo.clearTaskR2Key(env.DB, previewId)
  await env.IMAGES_BUCKET.delete(`temp/imports/${previewId}.zip`)

  await authRepo.insertOperationLog(env.DB, {
    id: newId(),
    adminId,
    actionType: 'data_import',
    targetId: previewId,
    summary: `恢复数据：新增 ${imported} 篇，跳过 ${skipped} 篇，失败 ${errors} 篇`,
    now: nowIso(),
  })

  return { taskId: previewId, status: 'completed' }
}

async function loadImportDocument(env: Env, uploadId: string): Promise<unknown> {
  const entries = await readZipEntries(env, uploadId)
  const data = entries.get('diary-data.json')
  if (!data) {
    throw new AppError('IMPORT_INVALID', '压缩包缺少 diary-data.json')
  }
  try {
    return JSON.parse(new TextDecoder().decode(data)) as unknown
  } catch {
    throw new AppError('IMPORT_INVALID', 'diary-data.json 格式不正确')
  }
}

async function readZipEntries(env: Env, uploadId: string): Promise<Map<string, Uint8Array>> {
  const object = await env.IMAGES_BUCKET.get(`temp/imports/${uploadId}.zip`)
  if (!object) {
    throw new AppError('IMPORT_INVALID', '恢复文件不存在或已过期')
  }
  const bytes = new Uint8Array(await object.arrayBuffer())
  return readZip(bytes, {
    maxEntries: MAX_IMPORT_ENTRIES,
    maxEntryBytes: MAX_IMPORT_ENTRY_BYTES,
    maxTotalBytes: MAX_IMPORT_TOTAL_BYTES,
  })
}

// 校验恢复文件结构；无效记录计数而不整体失败
function parseImportDocument(
  input: unknown,
  entries: Map<string, Uint8Array>,
): ParsedImport {
  if (!input || typeof input !== 'object') {
    throw new AppError('IMPORT_INVALID', 'diary-data.json 结构不正确')
  }
  const root = input as Record<string, unknown>
  if (root.version !== 1) {
    throw new AppError('IMPORT_INVALID', '不支持的导出文件版本')
  }
  const rawDiaries = Array.isArray(root.diaries) ? root.diaries : null
  const rawPhotos = Array.isArray(root.photos) ? root.photos : null
  if (!rawDiaries || !rawPhotos) {
    throw new AppError('IMPORT_INVALID', 'diary-data.json 缺少必要字段')
  }
  if (rawDiaries.length > MAX_IMPORT_DIARIES || rawPhotos.length > MAX_IMPORT_PHOTOS) {
    throw new AppError('IMPORT_INVALID', '恢复记录数量超出限制')
  }

  const diaries: ExportDiaryJson[] = []
  const photos: ExportPhotoJson[] = []
  let invalidRecords = 0
  let conflicts = 0
  const seenDiaries = new Set<string>()
  const seenPhotos = new Set<string>()

  for (const item of rawDiaries) {
    const diary = validateDiary(item)
    if (!diary) {
      invalidRecords += 1
      continue
    }
    if (seenDiaries.has(diary.id)) {
      conflicts += 1
      continue
    }
    seenDiaries.add(diary.id)
    diaries.push(diary)
  }

  for (const item of rawPhotos) {
    const photo = validatePhoto(item)
    if (!photo) {
      invalidRecords += 1
      continue
    }
    if (seenPhotos.has(photo.id)) {
      conflicts += 1
      continue
    }
    seenPhotos.add(photo.id)
    photos.push(photo)
  }

  return { diaries, photos, invalidRecords, conflicts }
}

function validateDiary(input: unknown): ExportDiaryJson | null {
  if (!input || typeof input !== 'object') return null
  const value = input as Record<string, unknown>
  const id = optionalString(value.id, 64)
  const recordDate = optionalString(value.recordDate, 10)
  if (!id || !recordDate || !/^\d{4}-\d{2}-\d{2}$/.test(recordDate)) return null
  const status = value.status === 'published' ? 'published' : value.status === 'draft' ? 'draft' : null
  if (!status) return null

  const publishedRevision = validateRevision(value.publishedRevision)
  const draftRevision = validateRevision(value.draftRevision)
  if (publishedRevision === 'invalid' || draftRevision === 'invalid') return null
  if (status === 'published' && !publishedRevision) return null

  return {
    id,
    recordDate,
    status,
    createdAt: optionalString(value.createdAt, 40) ?? nowIso(),
    updatedAt: optionalString(value.updatedAt, 40) ?? nowIso(),
    publishedAt: optionalString(value.publishedAt, 40),
    publishedRevision: publishedRevision ?? null,
    draftRevision: draftRevision ?? null,
  }
}

function validateRevision(input: unknown): ExportRevisionJson | null | 'invalid' {
  if (input === undefined || input === null) return null
  if (typeof input !== 'object') return 'invalid'
  const value = input as Record<string, unknown>
  const id = optionalString(value.id, 64)
  if (!id) return 'invalid'
  const content = typeof value.content === 'string' ? value.content : ''
  if (content.length > 20000) return 'invalid'
  const rawPhotos = Array.isArray(value.photos) ? value.photos : []
  if (rawPhotos.length > MAX_IMPORT_PHOTOS) return 'invalid'
  const photos: Array<{ photoId: string; sortOrder: number }> = []
  for (const item of rawPhotos) {
    if (!item || typeof item !== 'object') return 'invalid'
    const link = item as Record<string, unknown>
    const photoId = optionalString(link.photoId, 64)
    const sortOrder = typeof link.sortOrder === 'number' ? link.sortOrder : null
    if (!photoId || sortOrder === null || sortOrder < 0) return 'invalid'
    photos.push({ photoId, sortOrder })
  }
  return {
    id,
    content,
    revisionVersion: typeof value.revisionVersion === 'number' ? value.revisionVersion : 1,
    createdAt: optionalString(value.createdAt, 40) ?? nowIso(),
    updatedAt: optionalString(value.updatedAt, 40) ?? nowIso(),
    photos,
  }
}

function validatePhoto(input: unknown): ExportPhotoJson | null {
  if (!input || typeof input !== 'object') return null
  const value = input as Record<string, unknown>
  const id = optionalString(value.id, 64)
  const originalName = optionalString(value.originalName, 200)
  const mimeType = optionalString(value.mimeType, 80)
  const file = optionalString(value.file, 300)
  const fileSize = typeof value.fileSize === 'number' ? value.fileSize : null
  if (!id || !originalName || !mimeType || !file || fileSize === null || fileSize <= 0) {
    return null
  }
  if (!file.startsWith('photos/') || file.includes('..')) return null
  return {
    id,
    originalName,
    mimeType,
    fileSize,
    width: typeof value.width === 'number' ? value.width : null,
    height: typeof value.height === 'number' ? value.height : null,
    uploadedAt: optionalString(value.uploadedAt, 40),
    createdAt: optionalString(value.createdAt, 40) ?? nowIso(),
    file,
  }
}

// ---- 辅助 ----

function optionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength) return null
  return trimmed
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

function textBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function scopeLabel(scope: ExportScope): string {
  return scope === 'all'
    ? '全部'
    : scope === 'published'
      ? '仅已发布'
      : scope === 'draft'
        ? '仅草稿'
        : '选中日记'
}

function buildCsv(document: ExportDocument): string {
  const lines = ['日期,状态,发布时间,文字,照片数量,照片文件名']
  for (const diary of document.diaries) {
    const revision = diary.publishedRevision ?? diary.draftRevision
    const photoNames = (revision?.photos ?? [])
      .map((link) => document.photos.find((photo) => photo.id === link.photoId)?.originalName ?? '')
      .filter(Boolean)
      .join('; ')
    lines.push(
      [
        diary.recordDate,
        diary.status === 'published' ? '已发布' : '草稿',
        diary.publishedAt ?? '',
        escapeCsv(revision?.content ?? ''),
        String(revision?.photos.length ?? 0),
        escapeCsv(photoNames),
      ].join(','),
    )
  }
  return `${lines.join('\n')}\n`
}

function escapeCsv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function buildReadme(): string {
  return [
    '生活记录网站 - 数据导出包',
    '',
    '文件结构：',
    '  diary-data.json  完整数据（用于恢复）',
    '  diary-data.csv   便于查看和整理的表格',
    '  photos/          原始照片文件',
    '',
    '说明：',
    '  1. 请妥善保管本文件，其中包含未公开的草稿内容。',
    '  2. 恢复时请使用完整 ZIP，不要修改内部结构或文件名。',
    '  3. 恢复采用合并方式：已存在相同编号的记录会被跳过，不会覆盖现有数据。',
    '  4. 导出的文件为临时文件，请在有效期内下载。',
    '',
    `导出时间：${nowIso()}`,
    '',
  ].join('\n')
}
