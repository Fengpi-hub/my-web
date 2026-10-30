// HTTP 请求解析与参数校验工具
import { AppError } from './errors'

// 解析 JSON 请求体；格式不合法统一抛出校验错误
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json()
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>
    }
  } catch {
    // 忽略解析失败，统一抛出校验错误
  }
  throw new AppError('VALIDATION_ERROR', '请求体格式不正确')
}

// 读取可选 JSON 请求体（无请求体时返回空对象）
export async function readOptionalJsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const text = await request.text()
  if (!text.trim()) return {}
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>
    }
  } catch {
    // 统一抛出校验错误
  }
  throw new AppError('VALIDATION_ERROR', '请求体格式不正确')
}

export function getString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key]
  return typeof value === 'string' ? value : null
}

export function getNumber(body: Record<string, unknown>, key: string): number | null {
  const value = body[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function getBoolean(body: Record<string, unknown>, key: string): boolean | null {
  const value = body[key]
  return typeof value === 'boolean' ? value : null
}

// 读取字符串数组，元素必须均为字符串；类型错误时返回 null
export function getStringArray(
  body: Record<string, unknown>,
  key: string,
): string[] | null {
  const value = body[key]
  if (!Array.isArray(value)) return null
  if (!value.every((item) => typeof item === 'string')) return null
  return value as string[]
}

// 读取正整数参数（来自 query），非法时使用默认值
export function readPositiveInt(
  raw: string | null,
  fallback: number,
  max: number,
): number {
  if (raw === null) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

// 解析分页参数
export function parsePagination(
  url: URL,
  defaultLimit = 12,
  maxLimit = 100,
): { page: number; limit: number; offset: number } {
  const page = readPositiveInt(url.searchParams.get('page'), 1, 1000)
  const limit = readPositiveInt(url.searchParams.get('limit'), defaultLimit, maxLimit)
  return { page, limit, offset: (page - 1) * limit }
}

// 校验 YYYY-MM-DD 日期（含真实日期合法性）
export function validateRecordDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError('VALIDATION_ERROR', '记录日期格式应为 YYYY-MM-DD')
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AppError('VALIDATION_ERROR', '记录日期不是有效日期')
  }
  return value
}

// 校验年份（YYYY）
export function validateYear(value: string): string {
  if (!/^\d{4}$/.test(value)) {
    throw new AppError('VALIDATION_ERROR', '年份格式不正确')
  }
  return value
}

// 校验月份（1-12），返回两位字符串
export function validateMonth(value: string): string {
  const month = Number.parseInt(value, 10)
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    throw new AppError('VALIDATION_ERROR', '月份格式不正确')
  }
  return String(month).padStart(2, '0')
}

// 截取内容预览（去除多余空白）
export function buildPreview(content: string, maxLength = 160): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}…`
}
