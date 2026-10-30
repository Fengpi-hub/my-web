// 数据导出与恢复接口
import type { Env } from '../env'
import type { RouteHandler, Router } from '../utils/router'
import { AppError } from '../utils/errors'
import { json } from '../utils/response'
import { requireAdmin } from '../middleware/auth'
import { verifyTrustedOrigin } from '../middleware/csrf'
import { getBoolean, getString, readJsonBody } from '../utils/http'
import * as dataService from '../services/data-service'

export function registerAdminDataRoutes(router: Router<Env>): void {
  router.post('/api/admin/data/export', handleExport)
  router.get('/api/admin/data/tasks/:taskId', handleTask)
  router.get('/api/admin/data/tasks/:taskId/download', handleDownload)
  router.post('/api/admin/data/import/upload', handleImportUpload)
  router.post('/api/admin/data/import/preview', handleImportPreview)
  router.post('/api/admin/data/import/confirm', handleImportConfirm)
}

const handleExport: RouteHandler<Env> = async ({ request, env, ctx }) => {
  verifyTrustedOrigin(request, env.APP_ORIGIN)
  const admin = await requireAdmin(env.DB, request)
  const body = await readJsonBody(request)
  const scope = getString(body, 'scope')
  if (scope !== 'all' && scope !== 'published' && scope !== 'draft') {
    throw new AppError('VALIDATION_ERROR', '导出范围不正确')
  }
  const result = await dataService.createExportTask(env, admin.id, scope, ctx)
  return json(result, 202)
}

const handleTask: RouteHandler<Env> = async ({ request, env, params }) => {
  await requireAdmin(env.DB, request)
  return json(await dataService.getTask(env.DB, params.taskId))
}

const handleDownload: RouteHandler<Env> = async ({ request, env, params }) => {
  await requireAdmin(env.DB, request)
  return dataService.getExportDownload(env, params.taskId, request)
}

const handleImportUpload: RouteHandler<Env> = async ({ request, env }) => {
  verifyTrustedOrigin(request, env.APP_ORIGIN)
  await requireAdmin(env.DB, request)
  const contentType = (request.headers.get('Content-Type') ?? '').split(';')[0].trim()
  if (
    contentType &&
    !['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(
      contentType,
    )
  ) {
    throw new AppError('IMPORT_INVALID', '仅支持 ZIP 文件', 415)
  }
  return json(await dataService.uploadImportZip(env, request), 201)
}

const handleImportPreview: RouteHandler<Env> = async ({ request, env }) => {
  verifyTrustedOrigin(request, env.APP_ORIGIN)
  await requireAdmin(env.DB, request)
  const body = await readJsonBody(request)
  const uploadId = getString(body, 'uploadId')
  if (!uploadId) {
    throw new AppError('VALIDATION_ERROR', '缺少 uploadId')
  }
  return json(await dataService.previewImport(env, uploadId))
}

const handleImportConfirm: RouteHandler<Env> = async ({ request, env }) => {
  verifyTrustedOrigin(request, env.APP_ORIGIN)
  const admin = await requireAdmin(env.DB, request)
  const body = await readJsonBody(request)
  const previewId = getString(body, 'previewId')
  const confirmed = getBoolean(body, 'confirm')
  if (!previewId || confirmed !== true) {
    throw new AppError('VALIDATION_ERROR', '必须确认恢复操作')
  }
  return json(await dataService.confirmImport(env, admin.id, previewId))
}
