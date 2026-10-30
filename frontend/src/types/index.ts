// 领域类型定义：与 DATABASE.md / API 设计规范 V1.1 对齐

export type DiaryStatus = 'draft' | 'published'
export type RevisionType = 'working' | 'published'
export type PhotoUploadStatus =
  | 'pending'
  | 'uploading'
  | 'uploaded'
  | 'failed'
  | 'deleting'
  | 'deleted'

export interface Photo {
  id: string
  thumbnailUrl: string
  imageUrl?: string
}

export interface DiaryPhoto extends Photo {
  sortOrder: number
}

export interface DiaryListItem {
  id: string
  recordDate: string
  contentPreview: string
  photos: Photo[]
  publishedAt: string
}

export interface PublicDiary {
  id: string
  recordDate: string
  content: string
  photos: Array<{ id: string; sortOrder: number; imageUrl: string }>
  publishedAt: string
}

// ---- 访客端公开内容类型 ----

// 首页随机照片
export interface HomePhoto {
  id: string
  diaryId: string
  thumbnailUrl: string
  imageUrl: string
}

// 照片墙照片（带上传时间与所属日记）
export interface PublicPhotoSummary {
  id: string
  diaryId: string | null
  thumbnailUrl: string
  imageUrl: string
  uploadedAt: string
}

// 时间轴节点
export interface TimelineItem {
  id: string
  recordDate: string
  content: string
  representativePhoto: { id: string; thumbnailUrl: string } | null
}

// 可用年月
export interface PeriodSummary {
  years: Array<{ year: number; months: number[] }>
}

// 游标分页返回
export interface CursorPage<T> {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
}

// 访客端日记列表返回
export interface PublicDiaryListResult {
  items: DiaryListItem[]
  pagination: { page: number; limit: number; hasMore: boolean }
}

// ---- 管理端类型 ----

export interface AdminDiaryListItem {
  id: string
  recordDate: string
  status: DiaryStatus
  contentPreview: string
  photoCount: number
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  hasDraft: boolean
}

export interface AdminPhotoItem {
  id: string
  sortOrder: number
  originalName: string
  mimeType: string
  fileSize: number
  width: number | null
  height: number | null
  thumbnailUrl: string
  imageUrl: string
  uploadStatus?: string
  uploadedAt?: string | null
  diaries?: Array<{ id: string; recordDate: string; status: string }>
}

export interface AdminRevision {
  id: string
  revisionVersion: number
  content: string
  updatedAt: string
  photos: AdminPhotoItem[]
}

export interface AdminDiaryDetail {
  id: string
  status: DiaryStatus
  recordDate: string
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  publishedRevision: AdminRevision | null
  draftRevision: AdminRevision | null
}

export interface AdminDiaryListResult {
  items: AdminDiaryListItem[]
  pagination: { page: number; limit: number; total: number; hasMore: boolean }
}

export interface AdminPhotoDetail {
  id: string
  originalName: string
  mimeType: string
  fileSize: number
  width: number | null
  height: number | null
  uploadStatus: string
  uploadedAt: string | null
  createdAt: string
  thumbnailUrl: string
  imageUrl: string
  associations: Array<{
    revisionId: string
    revisionType: string
    diaryId: string
    recordDate: string
    diaryStatus: string
  }>
}

export interface AdminPhotoListResult {
  items: AdminPhotoItem[]
  pagination: { page: number; limit: number; total: number; hasMore: boolean }
}

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

export interface SiteSettings {
  siteName: string
  siteSubtitle: string
  browserTitle: string
}

export interface OperationLogItem {
  id: string
  actionType: string
  targetId: string | null
  summary: string
  createdAt: string
}

export interface OperationLogListResult {
  items: OperationLogItem[]
  pagination: { page: number; limit: number; total: number; hasMore: boolean }
}

export interface DataTaskResult {
  taskId: string
  taskType: 'export' | 'import'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  scope: string | null
  downloadAvailable: boolean
  counts: Record<string, number> | null
  errorMessage: string | null
  createdAt: string
  expiresAt: string | null
}

export interface ImportPreview {
  previewId: string
  newRecords: number
  existingRecords: number
  conflicts: number
  invalidRecords: number
  missingPhotos: number
  expiresAt: string
}

export interface AdminSessionResult {
  authenticated: boolean
  admin?: { id: string; username: string }
}

export interface PageInfo {
  page?: number
  limit?: number
  hasMore: boolean
  nextCursor?: string
}

// 统一响应结构
export interface ApiSuccess<T> {
  success: true
  data: T
  message?: string
}

export interface ApiFailure {
  success: false
  error: {
    code: string
    message: string
  }
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure