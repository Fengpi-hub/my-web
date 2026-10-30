import type { Env } from './env'
import { error as errorResponse, json } from './utils/response'
import { AppError } from './utils/errors'
import { nowIso } from './utils/id'
import { Router } from './utils/router'
import { allowedOrigins } from './middleware/csrf'
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

// 跨域支持：前端与 API 分域部署时（如 Pages 主域 + api 子域），
// 仅对可信来源（自身源 + APP_ORIGIN）回显 CORS 头，允许携带 Cookie。
function buildCorsHeaders(origin: string | null, preflight: boolean): Headers {
  const headers = new Headers()
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Credentials', 'true')
    headers.append('Vary', 'Origin')
  }
  if (preflight) {
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Content-Type')
    headers.set('Access-Control-Max-Age', '86400')
  }
  return headers
}

function withCors(response: Response, origin: string | null): Response {
  if (!origin) {
    return response
  }
  const next = new Response(response.body, response)
  next.headers.set('Access-Control-Allow-Origin', origin)
  next.headers.set('Access-Control-Allow-Credentials', 'true')
  next.headers.append('Vary', 'Origin')
  return next
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = request.headers.get('Origin')
    const trustedOrigin =
      origin && allowedOrigins(request, env.APP_ORIGIN).has(origin) ? origin : null

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: buildCorsHeaders(trustedOrigin, true) })
    }

    try {
      const response = await router.handle(request, env, ctx)
      if (response) {
        return withCors(response, trustedOrigin)
      }
      return withCors(errorResponse('NOT_FOUND', '接口不存在', 404), trustedOrigin)
    } catch (err) {
      // 业务错误：返回结构化错误，不暴露内部细节
      if (err instanceof AppError) {
        return withCors(errorResponse(err.code, err.message, err.status), trustedOrigin)
      }
      // 未预期错误：记录日志，返回统一内部错误
      console.error('Unexpected error:', err)
      return withCors(errorResponse('INTERNAL_ERROR', '服务器内部错误', 500), trustedOrigin)
    }
  },
}
