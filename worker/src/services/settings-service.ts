// 站点配置服务：网站名称、副标题、浏览器标题
import { AppError } from '../utils/errors'
import { newId, nowIso } from '../utils/id'
import { insertOperationLog } from '../repositories/auth-repository'
import * as siteRepo from '../repositories/site-repository'

export interface SiteSettings {
  siteName: string
  siteSubtitle: string
  browserTitle: string
}

// 默认站点配置（首次访问时使用）
export const DEFAULT_SETTINGS: SiteSettings = {
  siteName: '生活记录',
  siteSubtitle: '记录生活中的每一个瞬间',
  browserTitle: '生活记录',
}

// 字段与数据库键的映射及长度限制
const FIELD_MAP: Array<{ field: keyof SiteSettings; key: string; max: number }> = [
  { field: 'siteName', key: 'site_name', max: 50 },
  { field: 'siteSubtitle', key: 'site_subtitle', max: 100 },
  { field: 'browserTitle', key: 'browser_title', max: 100 },
]

// 获取站点配置（缺失字段回退默认值）
export async function getSiteSettings(db: D1Database): Promise<SiteSettings> {
  const rows = await siteRepo.listSettings(db)
  const map = new Map(rows.map((row) => [row.key, row.value]))
  const result = { ...DEFAULT_SETTINGS }
  for (const item of FIELD_MAP) {
    const value = map.get(item.key)
    if (value !== undefined) {
      result[item.field] = value
    }
  }
  return result
}

// 修改站点配置
export async function updateSiteSettings(
  db: D1Database,
  adminId: string,
  input: Partial<SiteSettings>,
): Promise<SiteSettings> {
  const entries: Array<{ key: string; value: string }> = []

  for (const item of FIELD_MAP) {
    const raw = input[item.field]
    if (raw === undefined) continue
    if (typeof raw !== 'string') {
      throw new AppError('VALIDATION_ERROR', `${item.field} 必须是字符串`)
    }
    const value = raw.trim()
    if (value.length === 0) {
      throw new AppError('VALIDATION_ERROR', `${item.field} 不能为空`)
    }
    if (value.length > item.max) {
      throw new AppError('VALIDATION_ERROR', `${item.field} 不能超过 ${item.max} 个字符`)
    }
    entries.push({ key: item.key, value })
  }

  if (entries.length === 0) {
    throw new AppError('VALIDATION_ERROR', '没有需要更新的配置')
  }

  const now = nowIso()
  await siteRepo.saveSettings(db, entries, now)
  await insertOperationLog(db, {
    id: newId(),
    adminId,
    actionType: 'settings_update',
    targetId: null,
    summary: `更新站点配置：${entries.map((entry) => entry.key).join(', ')}`,
    now,
  })

  return getSiteSettings(db)
}
