// 管理端站点接口：Dashboard 统计、站点配置、操作记录
import type { Env } from '../env'
import type { RouteHandler, Router } from '../utils/router'
import { AppError } from '../utils/errors'
import { json } from '../utils/response'
import { requireAdmin } from '../middleware/auth'
import { verifyTrustedOrigin } from '../middleware/csrf'
import { getString, parsePagination, readJsonBody } from '../utils/http'
import { getDashboard } from '../services/dashboard-service'
import { getSiteSettings, updateSiteSettings } from '../services/settings-service'
import * as siteRepo from '../repositories/site-repository'

export function registerAdminSiteRoutes(router: Router<Env>): void {
  router.get('/api/admin/dashboard', handleDashboard)
  router.get('/api/public/settings', handlePublicSettings)
  router.put('/api/admin/settings', handleUpdateSettings)
  router.get('/api/admin/logs', handleLogs)
}

const handleDashboard: RouteHandler<Env> = async ({ request, env }) => {
  await requireAdmin(env.DB, request)
  return json(await getDashboard(env.DB))
}

// 公开配置：仅网站名称、副标题、浏览器标题
const handlePublicSettings: RouteHandler<Env> = async ({ env }) => {
  return json(await getSiteSettings(env.DB))
}

const handleUpdateSettings: RouteHandler<Env> = async ({ request, env }) => {
  verifyTrustedOrigin(request, env.APP_ORIGIN)
  const admin = await requireAdmin(env.DB, request)
  const body = await readJsonBody(request)
  return json(
    await updateSiteSettings(env.DB, admin.id, {
      siteName: getString(body, 'siteName') ?? undefined,
      siteSubtitle: getString(body, 'siteSubtitle') ?? undefined,
      browserTitle: getString(body, 'browserTitle') ?? undefined,
    }),
  )
}

const handleLogs: RouteHandler<Env> = async ({ request, env, url }) => {
  await requireAdmin(env.DB, request)
  const pagination = parsePagination(url, 20, 100)

  const actionType = sanitizeActionType(url.searchParams.get('actionType'))
  const startDate = sanitizeDate(url.searchParams.get('startDate'))
  const endDate = sanitizeDate(url.searchParams.get('endDate'))

  const { rows, total } = await siteRepo.listLogs(env.DB, {
    ...pagination,
    actionType,
    startDate: startDate ? startDate : null,
    endDate: endDate ? `${endDate}T23:59:59.999Z` : null,
  })

  return json({
    items: rows.map((row) => ({
      id: row.id,
      actionType: row.action_type,
      targetId: row.target_id,
      summary: row.summary,
      createdAt: row.created_at,
    })),
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      hasMore: pagination.offset + rows.length < total,
    },
  })
}

function sanitizeActionType(value: string | null): string | null {
  if (!value) return null
  const normalized = value.trim()
  if (!/^[a-z_]{1,64}$/.test(normalized)) {
    throw new AppError('VALIDATION_ERROR', '操作类型参数不正确')
  }
  return normalized
}

function sanitizeDate(value: string | null): string | null {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError('VALIDATION_ERROR', '日期参数格式不正确')
  }
  return value
}
