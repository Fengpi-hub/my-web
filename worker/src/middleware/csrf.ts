
// CSRF 防护：对状态修改请求校验可信来源（Origin + Fetch Metadata）
import { AppError } from '../utils/errors'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// 可信来源集合：请求自身源 + APP_ORIGIN（支持逗号分隔多个，用于跨域前端）
export function allowedOrigins(request: Request, configuredOrigin?: string): Set<string> {
  const origins = new Set<string>([new URL(request.url).origin])
  if (configuredOrigin) {
    for (const item of configuredOrigin.split(',')) {
      const trimmed = item.trim()
      if (trimmed) {
        origins.add(trimmed)
      }
    }
  }
  return origins
}

// 校验请求来源；不可信时抛出 FORBIDDEN
// 规则：
//   1. 允许 same-origin、same-site 和 none。
//   2. Origin 存在时必须属于可信来源集合。
//   3. Origin 与 Sec-Fetch-Site 均缺失时视为非浏览器客户端（放行）。
export function verifyTrustedOrigin(request: Request, configuredOrigin?: string): void {
  if (SAFE_METHODS.has(request.method)) {
    return
  }

  const allowed = allowedOrigins(request, configuredOrigin)
  const origin = request.headers.get('Origin')
  const fetchSite = request.headers.get('Sec-Fetch-Site')

  if (
    fetchSite &&
    fetchSite !== 'same-origin' &&
    fetchSite !== 'same-site' &&
    fetchSite !== 'none'
  ) {
    throw new AppError('FORBIDDEN', '请求来源不可信')
  }

  if (origin && !allowed.has(origin)) {
    throw new AppError('FORBIDDEN', '请求来源不可信')
  }
}
