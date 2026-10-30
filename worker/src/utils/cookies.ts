// Session Cookie 构建与读取

export const SESSION_COOKIE = 'admin_session'

export type SessionSameSite = 'Lax' | 'None'

// 构建安全的 Session Cookie
// sameSite 为 None 时按规范必须同时设置 Secure（跨站部署场景）
export function buildSessionCookie(
  token: string,
  maxAgeSeconds: number,
  secure: boolean,
  sameSite: SessionSameSite = 'Lax',
): string {
  const needSecure = secure || sameSite === 'None'
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (needSecure) {
    parts.push('Secure')
  }
  return parts.join('; ')
}

// 清除 Session Cookie
export function clearSessionCookie(secure: boolean, sameSite: SessionSameSite = 'Lax'): string {
  const needSecure = secure || sameSite === 'None'
  const parts = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    'Max-Age=0',
  ]
  if (needSecure) {
    parts.push('Secure')
  }
  return parts.join('; ')
}

// 从请求 Cookie 中读取指定名称的值
export function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get('Cookie')
  if (!cookie) return null
  for (const part of cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) {
      return rest.join('=')
    }
  }
  return null
}
