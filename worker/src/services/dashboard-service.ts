// Dashboard 统计服务
import * as siteRepo from '../repositories/site-repository'

export interface DashboardData {
  publishedDiaries: number
  draftDiaries: number
  totalPhotos: number
  storageUsed: number
  recentActivities: Array<{
    id: string
    actionType: string
    targetId: string | null
    summary: string
    createdAt: string
  }>
}

const RECENT_LIMIT = 6

export async function getDashboard(db: D1Database): Promise<DashboardData> {
  const [statusCounts, photoAggregate, recentLogs] = await Promise.all([
    siteRepo.getDiaryStatusCounts(db),
    siteRepo.getPhotoAggregate(db),
    siteRepo.listRecentLogs(db, RECENT_LIMIT),
  ])

  return {
    publishedDiaries: statusCounts.published,
    draftDiaries: statusCounts.drafts,
    totalPhotos: photoAggregate.total,
    storageUsed: photoAggregate.storageUsed,
    recentActivities: recentLogs.map((row) => ({
      id: row.id,
      actionType: row.action_type,
      targetId: row.target_id,
      summary: row.summary,
      createdAt: row.created_at,
    })),
  }
}
