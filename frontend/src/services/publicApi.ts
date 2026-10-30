import { api } from './api'
import type {
  CursorPage,
  HomePhoto,
  PeriodSummary,
  PublicDiary,
  PublicDiaryListResult,
  PublicPhotoSummary,
  TimelineItem,
} from '../types'

// 拼接查询参数，忽略空值
function buildQuery(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue
    search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

// 访客端公开接口
export const publicApi = {
  // 首页随机照片
  randomPhotos(limit = 14): Promise<{ photos: HomePhoto[] }> {
    return api.get(`/api/public/home/random-photos${buildQuery({ limit })}`)
  },

  // 照片墙照片（游标分页）
  photos(params: {
    limit?: number
    year?: number | null
    month?: number | null
    cursor?: string | null
  }): Promise<CursorPage<PublicPhotoSummary>> {
    return api.get(`/api/public/photos${buildQuery(params)}`)
  },

  // 照片墙可用年月
  photoPeriods(): Promise<PeriodSummary> {
    return api.get('/api/public/photos/periods')
  },

  // 时间轴（游标分页）
  timeline(params: {
    limit?: number
    year?: number | null
    month?: number | null
    cursor?: string | null
  }): Promise<CursorPage<TimelineItem>> {
    return api.get(`/api/public/timeline${buildQuery(params)}`)
  },

  // 时间轴可用年月
  timelinePeriods(): Promise<PeriodSummary> {
    return api.get('/api/public/timeline/periods')
  },

  // 日记列表（页码分页）
  diaries(params: { page?: number; limit?: number; year?: number | null; month?: number | null }): Promise<PublicDiaryListResult> {
    return api.get(`/api/public/diaries${buildQuery(params)}`)
  },

  // 日记详情
  diary(id: string): Promise<PublicDiary> {
    return api.get(`/api/public/diaries/${encodeURIComponent(id)}`)
  },
}
