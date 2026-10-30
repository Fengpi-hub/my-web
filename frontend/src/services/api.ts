import type { ApiResponse } from '../types'

// 公开 API 基础地址：留空表示同源 /api
const BASE_URL: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

// 拼接 API 绝对地址。后端返回的相对路径（/api/...）统一经此函数处理，
// 跨域部署（VITE_API_BASE 非空）时会指向 API 域名；同源部署时保持相对路径。
export function apiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path
  }
  return `${BASE_URL}${path}`
}

export class ApiClientError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'ApiClientError'
    this.code = code
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isForm = options.body instanceof FormData

  const response = await fetch(`${BASE_URL}${path}`, {
    credentials: 'include',
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers ?? {}),
    },
    ...options,
  })

  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null

  if (!response.ok || body === null || body.success === false) {
    const message =
      body !== null && body.success === false
        ? body.error.message
        : `请求失败（${response.status}）`
    const code = body !== null && body.success === false ? body.error.code : 'REQUEST_ERROR'
    throw new ApiClientError(code, message, response.status)
  }

  return body.data
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PUT', body: data === undefined ? undefined : JSON.stringify(data) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}