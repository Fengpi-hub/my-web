// CSRF 防护：对状态修改请求校验可信来源（Origin + Fetch Metadata）
import { AppError } from '../utils/errors'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// 校验请求来源；不可信时抛出 FORBIDDEN
// 规则：
//   1. 浏览器跨站请求（Sec-Fetch-Site 非 same-origin/none）直接拒绝。
//   2. Origin 存在时必须与可信来源一致。
//   3. Origin 与 Sec-Fetch-Site 均缺失时视为非浏览器客户端（放行）。
export function verifyTrustedOrigin(request: Request, expectedOrigin?: string): void {
  if (SAFE_METHODS.has(request.method)) {
    return
  }

  const allowedOrigin = expectedOrigin ?? new URL(request.url).origin
  const origin = request.headers.get('Origin')
  const fetchSite = request.headers.get('Sec-Fetch-Site')

  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new AppError('FORBIDDEN', '请求来源不可信')
  }
  if (origin && origin !== allowedOrigin) {
    throw new AppError('FORBIDDEN', '请求来源不可信')
  }
}
