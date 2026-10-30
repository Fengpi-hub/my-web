// 日记管理接口
import type { Env } from '../env'
import type { RouteHandler, Router } from '../utils/router'
import { AppError } from '../utils/errors'
import { json } from '../utils/response'
import { requireAdmin } from '../middleware/auth'
import { verifyTrustedOrigin } from '../middleware/csrf'
import {
  getBoolean,
  getNumber,
  getString,
  getStringArray,
  parsePagination,
  readJsonBody,
  readOptionalJsonBody,
  validateMonth,
  validateYear,
} from '../utils/http'
import * as diaryService from '../services/diary-service'
import * as photoService from '../services/photo-service'
import * as dataService from '../services/data-service'
import { findExistingDiaryIds } from '../repositories/data-repository'

const MAX_BATCH_IDS = 50

export function registerAdminDiaryRoutes(router: Router<Env>): void {
  router.get('/api/admin/diaries', handleList)
  router.post('/api/admin/diaries', handleCreate)
  // 批量操作必须注册在 :id 之前，避免路径冲突
  router.post('/api/admin/diaries/batch', handleBatch)
  router.get('/api/admin/diaries/:id', handleDetail)
  router.put('/api/admin/diaries/:id/draft', handleSaveDraft)
  router.put('/api/admin/diaries/:id/draft/photos/order', handleReorderPhotos)
  router.post('/api/admin/diaries/:id/draft', handleEnsureDraft)
  router.post('/api/admin/diaries/:id/publish', handlePublish)
  router.post('/api/admin/diaries/:id/commit', handleCommit)
  router.post('/api/admin/diaries/:id/unpublish', handleUnpublish)
  router.post('/api/admin/diaries/:id/duplicate', handleDuplicate)
  router.delete('/api/admin/diaries/:id', handleDelete)
}

const handleList: RouteHandler<Env> = async ({ request, env, url }) => {
  const db = env.DB
  await requireAdmin(db, request)
  const pagination = parsePagination(url, 20, 100)

  const rawStatus = url.searchParams.get('status')
  const status = rawStatus === 'draft' || rawStatus === 'published' ? rawStatus : null
  if (rawStatus && rawStatus !== 'all' && status === null) {
    throw new AppError('VALIDATION_ERROR', '状态参数不正确')
  }

  const yearParam = url.searchParams.get('year')
  const monthParam = url.searchParams.get('month')
  const rawHasPhotos = url.searchParams.get('hasPhotos')
  const hasPhotos =
    rawHasPhotos === 'true' ? true : rawHasPhotos === 'false' ? false : null

  const keywordRaw = url.searchParams.get('keyword')
  const keyword = keywordRaw?.trim() ? keywordRaw.trim().slice(0, 64) : null

  const data = await diaryService.listAdminDiaries(db, {
    ...pagination,
    keyword,
    year: yearParam ? validateYear(yearParam) : null,
    month: monthParam ? validateMonth(monthParam) : null,
    status,
    sort: url.searchParams.get('sort'),
    hasPhotos,
  })
  return json(data)
}

const handleDetail: RouteHandler<Env> = async ({ request, env, params }) => {
  const db = env.DB
  await requireAdmin(db, request)
  return json(await diaryService.getAdminDiary(db, params.id))
}

const handleCreate: RouteHandler<Env> = async ({ request, env }) => {
  verifyTrustedOrigin(request, env.APP_ORIGIN)
  const db = env.DB
  const admin = await requireAdmin(db, request)
  const body = await readJsonBody(request)
  const recordDate = getString(body, 'recordDate')
  if (!recordDate) {
    throw new AppError('VALIDATION_ERROR', '记录日期不能为空')
  }
  return json(await diaryService.createDiary(db, admin.id, { recordDate }), 201)
}

const handleSaveDraft: RouteHandler<Env> = async ({ request, env, params }) => {
  verifyTrustedOrigin(request, env.APP_ORIGIN)
  const db = env.DB
  const admin = await requireAdmin(db, request)
  const body = await readJsonBody(request)

  const revisionId = getString(body, 'revisionId')
  if (!revisionId) {
    throw new AppError('VALIDATION_ERROR', 'revisionId 不能为空')
  }
  const expectedVersion = getNumber(body, 'expectedVersion')
  if (expectedVersion === null || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new AppError('VALIDATION_ERROR', 'expectedVersion 必须为正整数')
  }
  const content = getString(body, 'content')
  if (content === null) {
    throw new AppError('VALIDATION_ERROR', 'content 必须是字符串')
  }
  const photoIds = getStringArray(body, 'photoIds')
  if (body.photoIds !== undefined && photoIds === null) {
    throw new AppError('VALIDATION_ERROR', 'photoIds 必须是字符串数组')
  }
  const recordDate = body.recordDate === undefined ? null : getString(body, 'recordDate')
  if (body.recordDate !== undefined && recordDate === null) {
    throw new AppError('VALIDATION_ERROR', 'recordDate 必须是字符串')
  }

  return json(
    await diaryService.saveDraft(db, admin.id, params.id, {
      revisionId,
      expectedVersion,
      content,
      photoIds,
      recordDate,
    }),
  )
}

// 调整工作版本照片顺序
const handleReorderPhotos: RouteHandler<Env> = async ({ request, env, params }) => {
  verifyTrustedOrigin(request, env.APP_ORIGIN)
  const db = env.DB
  const admin = await requireAdmin(db, request)
  const body = await readJsonBody(request)

  const revisionId = getString(body, 'revisionId')
  if (!revisionId) {
    throw new AppError('VALIDATION_ERROR', 'revisionId 不能为空')
  }
  const expectedVersion = getNumber(body, 'expectedVersion')
  if (expectedVersion === null || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new AppError('VALIDATION_ERROR', 'expectedVersion 必须为正整数')
  }
  const photoIds = getStringArray(body, 'photoIds')
  if (!photoIds) {
    throw new AppError('VALIDATION_ERROR', 'photoIds 必须是字符串数组')
  }

  return json(
    await photoService.reorderDraftPhotos(db, admin.id, params.id, {
      revisionId,
      expectedVersion,
      photoIds,
    }),
  )
}

const handleEnsureDraft: RouteHandler<Env> = async ({ request, env, params }) => {
  verifyTrustedOrigin(request, env.APP_ORIGIN)
  const db = env.DB
  const admin = await requireAdmin(db, request)
  return json(await diaryService.ensureDraftRevision(db, admin.id, params.id))
}

const handlePublish: RouteHandler<Env> = async ({ request, env, params }) => {
  verifyTrustedOrigin(request, env.APP_ORIGIN)
  const db = env.DB
  const admin = await requireAdmin(db, request)
  const body = await readJsonBody(request)
  const input = readRevisionInput(body)
  return json(await diaryService.publishDiary(db, admin.id, params.id, input, 'publish'))
}

const handleCommit: RouteHandler<Env> = async ({ request, env, params }) => {
  verifyTrustedOrigin(request, env.APP_ORIGIN)
  const db = env.DB
  const admin = await requireAdmin(db, request)
  const body = await readJsonBody(request)
  const input = readRevisionInput(body)
  return json(await diaryService.publishDiary(db, admin.id, params.id, input, 'commit'))
}

const handleUnpublish: RouteHandler<Env> = async ({ request, env, params }) => {
  verifyTrustedOrigin(request, env.APP_ORIGIN)
  const db = env.DB
  const admin = await requireAdmin(db, request)
  return json(await diaryService.unpublishDiary(db, admin.id, params.id))
}

const handleDuplicate: RouteHandler<Env> = async ({ request, env, params }) => {
  verifyTrustedOrigin(request, env.APP_ORIGIN)
  const db = env.DB
  const admin = await requireAdmin(db, request)
  return json(await diaryService.duplicateDiary(db, admin.id, params.id), 201)
}

const handleDelete: RouteHandler<Env> = async ({ request, env, params, url }) => {
  verifyTrustedOrigin(request, env.APP_ORIGIN)
  const db = env.DB
  const admin = await requireAdmin(db, request)
  const body = await readOptionalJsonBody(request)
  const queryFlag = url.searchParams.get('deleteUnreferencedPhotos') === 'true'
  const flag = getBoolean(body, 'deleteUnreferencedPhotos') === true || queryFlag
  return json(
    await diaryService.deleteDiary(db, admin.id, params.id, flag),
  )
}

const handleBatch: RouteHandler<Env> = async ({ request, env, ctx }) => {
  verifyTrustedOrigin(request, env.APP_ORIGIN)
  const db = env.DB
  const admin = await requireAdmin(db, request)
  const body = await readJsonBody(request)

  const action = getString(body, 'action')
  if (!action) {
    throw new AppError('VALIDATION_ERROR', 'action 不能为空')
  }
  const ids = getStringArray(body, 'ids')
  if (!ids || ids.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'ids 必须是非空字符串数组')
  }
  if (ids.length > MAX_BATCH_IDS) {
    throw new AppError('VALIDATION_ERROR', `单次批量操作最多 ${MAX_BATCH_IDS} 篇日记`)
  }

  // 批量导出：选中日记生成一个 ZIP 任务，逐条返回是否纳入
  if (action === 'export') {
    const existing = await findExistingDiaryIds(db, ids)
    const existingIds = ids.filter((id) => existing.has(id))
    if (existingIds.length === 0) {
      throw new AppError('VALIDATION_ERROR', '所选日记均不存在')
    }
    const task = await dataService.createExportTask(env, admin.id, 'selected', ctx, existingIds)
    return json({
      results: ids.map((id) => ({
        id,
        success: existing.has(id),
        ...(existing.has(id)
          ? {}
          : { error: { code: 'NOT_FOUND', message: '日记不存在' } }),
      })),
      taskId: task.taskId,
    })
  }

  const deleteUnreferencedPhotos = getBoolean(body, 'deleteUnreferencedPhotos') === true
  return json(
    await diaryService.batchOperate(
      db,
      admin.id,
      action,
      ids,
      deleteUnreferencedPhotos,
    ),
  )
}

function readRevisionInput(body: Record<string, unknown>): {
  revisionId: string
  expectedVersion: number
} {
  const revisionId = getString(body, 'revisionId')
  if (!revisionId) {
    throw new AppError('VALIDATION_ERROR', 'revisionId 不能为空')
  }
  const expectedVersion = getNumber(body, 'expectedVersion')
  if (expectedVersion === null || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new AppError('VALIDATION_ERROR', 'expectedVersion 必须为正整数')
  }
  return { revisionId, expectedVersion }
}
