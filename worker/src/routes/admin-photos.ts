// 照片管理接口
import type { Env } from '../env'
import type { RouteHandler, Router } from '../utils/router'
import { AppError } from '../utils/errors'
import { json } from '../utils/response'
import { requireAdmin } from '../middleware/auth'
import { verifyTrustedOrigin } from '../middleware/csrf'
import { getNumber, getString, parsePagination, readJsonBody } from '../utils/http'
import * as photoService from '../services/photo-service'

export function registerAdminPhotoRoutes(router: Router<Env>): void {
  router.post('/api/admin/photos/upload-intents', handleUploadIntent)
  router.get('/api/admin/photos', handleList)
  router.get('/api/admin/photos/:photoId', handleDetail)
  router.get('/api/admin/photos/:photoId/original', handleMedia('original'))
  router.get('/api/admin/photos/:photoId/thumbnail', handleMedia('thumbnail'))
  router.put('/api/admin/photos/:photoId/upload', handleUpload)
  router.put('/api/admin/photos/:photoId/thumbnail', handleThumbnail)
  router.delete('/api/admin/photos/:photoId', handleDelete)
}

const handleUploadIntent: RouteHandler<Env> = async ({ request, env }) => {
  verifyTrustedOrigin(request, env.APP_ORIGIN)
  const admin = await requireAdmin(env.DB, request)
  const body = await readJsonBody(request)

  const filename = getString(body, 'filename')
  const mimeType = getString(body, 'mimeType')
  const fileSize = getNumber(body, 'fileSize')
  const idempotencyKey = getString(body, 'idempotencyKey')
  if (!filename || !mimeType || fileSize === null || !idempotencyKey) {
    throw new AppError('VALIDATION_ERROR', '文件名、类型、大小与幂等标识不能为空')
  }

  return json(
    await photoService.createUploadIntent(env, admin.id, {
      filename,
      mimeType,
      fileSize,
      idempotencyKey,
    }),
    201,
  )
}

const handleUpload: RouteHandler<Env> = async ({ request, env, params }) => {
  verifyTrustedOrigin(request, env.APP_ORIGIN)
  const admin = await requireAdmin(env.DB, request)
  return json(await photoService.uploadOriginal(env, admin.id, params.photoId, request))
}

const handleThumbnail: RouteHandler<Env> = async ({ request, env, params }) => {
  verifyTrustedOrigin(request, env.APP_ORIGIN)
  const admin = await requireAdmin(env.DB, request)
  return json(await photoService.uploadThumbnail(env, admin.id, params.photoId, request))
}

const handleList: RouteHandler<Env> = async ({ request, env, url }) => {
  await requireAdmin(env.DB, request)
  const pagination = parsePagination(url, 20, 100)

  const keywordRaw = url.searchParams.get('keyword')
  const keyword = keywordRaw?.trim() ? keywordRaw.trim().slice(0, 64) : null
  const status = url.searchParams.get('status')
  const diaryId = url.searchParams.get('diaryId')
  const unassociated = url.searchParams.get('unassociated') === 'true'

  return json(
    await photoService.listPhotos(env.DB, {
      ...pagination,
      keyword,
      status,
      diaryId,
      unassociated,
    }),
  )
}

const handleDetail: RouteHandler<Env> = async ({ request, env, params }) => {
  await requireAdmin(env.DB, request)
  return json(await photoService.getPhotoDetail(env.DB, params.photoId))
}

const handleMedia = (variant: 'original' | 'thumbnail'): RouteHandler<Env> => {
  return async ({ request, env, params }) => {
    await requireAdmin(env.DB, request)
    const media = await photoService.getMediaObject(env, params.photoId, variant, {
      publicAccess: false,
    })
    return photoService.buildMediaResponse(
      request,
      media.object,
      media.mimeType,
      media.cacheControl,
    )
  }
}

const handleDelete: RouteHandler<Env> = async ({ request, env, params }) => {
  verifyTrustedOrigin(request, env.APP_ORIGIN)
  const admin = await requireAdmin(env.DB, request)
  return json(await photoService.deletePhoto(env, admin.id, params.photoId))
}
