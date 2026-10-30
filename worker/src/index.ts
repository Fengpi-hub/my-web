import type { Env } from './env'
import { error as errorResponse, json } from './utils/response'
import { AppError } from './utils/errors'
import { nowIso } from './utils/id'
import { Router } from './utils/router'
import { registerAdminAuthRoutes } from './routes/admin-auth'
import { registerAdminDiaryRoutes } from './routes/admin-diaries'
import { registerAdminPhotoRoutes } from './routes/admin-photos'
import { registerPublicDiaryRoutes } from './routes/public-diaries'
import { registerPublicContentRoutes } from './routes/public-content'
import { registerAdminSiteRoutes } from './routes/admin-site'
import { registerAdminDataRoutes } from './routes/admin-data'
import { registerMediaRoutes } from './routes/media'

const router = new Router<Env>()

// 健康检查
router.get('/api/status', () => json({ status: 'ok', time: nowIso() }))

// 管理员认证
registerAdminAuthRoutes(router)

// 日记管理
registerAdminDiaryRoutes(router)

// 照片管理
registerAdminPhotoRoutes(router)

// 访客端日记
registerPublicDiaryRoutes(router)

// 访客端照片墙 / 时间轴 / 首页随机照片
registerPublicContentRoutes(router)

// 管理端 Dashboard / 站点配置 / 操作记录
registerAdminSiteRoutes(router)

// 数据导出与恢复
registerAdminDataRoutes(router)

// 受控图片访问
registerMediaRoutes(router)

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // CORS 预检（同源部署时通常无需跨域，此处预留）
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204 })
    }

    try {
      const response = await router.handle(request, env, ctx)
      if (response) {
        return response
      }
      return errorResponse('NOT_FOUND', '接口不存在', 404)
    } catch (err) {
      // 业务错误：返回结构化错误，不暴露内部细节
      if (err instanceof AppError) {
        return errorResponse(err.code, err.message, err.status)
      }
      // 未预期错误：记录日志，返回统一内部错误
      console.error('Unexpected error:', err)
      return errorResponse('INTERNAL_ERROR', '服务器内部错误', 500)
    }
  },
}