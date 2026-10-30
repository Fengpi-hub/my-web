// 公开照片访问接口（仅允许读取被公开版本引用的已上传照片）
import type { Env } from '../env'
import type { RouteHandler, Router } from '../utils/router'
import * as photoService from '../services/photo-service'

export function registerMediaRoutes(router: Router<Env>): void {
  router.get('/api/media/:photoId/original', handleMedia('original'))
  router.get('/api/media/:photoId/thumbnail', handleMedia('thumbnail'))
}

const handleMedia = (variant: 'original' | 'thumbnail'): RouteHandler<Env> => {
  return async ({ request, env, params }) => {
    const media = await photoService.getMediaObject(env, params.photoId, variant, {
      publicAccess: true,
    })
    return photoService.buildMediaResponse(
      request,
      media.object,
      media.mimeType,
      media.cacheControl,
    )
  }
}
