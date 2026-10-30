import { api } from './api'
import type {
  AdminDiaryDetail,
  AdminDiaryListResult,
  AdminPhotoDetail,
  AdminPhotoListResult,
  AdminSessionResult,
  DashboardData,
  SiteSettings,
  OperationLogListResult,
  DataTaskResult,
  ImportPreview,
} from '../types'

// 管理端接口封装：所有请求均携带 Session Cookie
export const adminApi = {
  // ---- 认证 ----
  me(): Promise<AdminSessionResult> {
    return api.get('/api/admin/auth/me')
  },
  login(username: string, password: string): Promise<{ admin: { id: string; username: string } }> {
    return api.post('/api/admin/auth/login', { username, password })
  },
  logout(): Promise<{ loggedOut: boolean }> {
    return api.post('/api/admin/auth/logout')
  },
  changePassword(currentPassword: string, newPassword: string): Promise<{ changed: boolean }> {
    return api.post('/api/admin/auth/change-password', { currentPassword, newPassword })
  },

  // ---- Dashboard ----
  dashboard(): Promise<DashboardData> {
    return api.get('/api/admin/dashboard')
  },

  // ---- 日记 ----
  diaries(params: {
    page?: number
    limit?: number
    keyword?: string | null
    year?: number | null
    month?: number | null
    status?: 'draft' | 'published' | null
    sort?: string | null
    hasPhotos?: boolean | null
  }): Promise<AdminDiaryListResult> {
    const search = new URLSearchParams()
    search.set('page', String(params.page ?? 1))
    search.set('limit', String(params.limit ?? 20))
    if (params.keyword) search.set('keyword', params.keyword)
    if (params.year !== null && params.year !== undefined) search.set('year', String(params.year))
    if (params.month !== null && params.month !== undefined) search.set('month', String(params.month))
    if (params.status) search.set('status', params.status)
    if (params.sort) search.set('sort', params.sort)
    if (params.hasPhotos !== null && params.hasPhotos !== undefined) {
      search.set('hasPhotos', String(params.hasPhotos))
    }
    return api.get(`/api/admin/diaries?${search.toString()}`)
  },
  diary(id: string): Promise<AdminDiaryDetail> {
    return api.get(`/api/admin/diaries/${encodeURIComponent(id)}`)
  },
  createDiary(recordDate: string): Promise<{ id: string; draftRevisionId: string; revisionVersion: number }> {
    return api.post('/api/admin/diaries', { recordDate })
  },
  saveDraft(
    id: string,
    payload: {
      revisionId: string
      expectedVersion: number
      content: string
      photoIds: string[]
      recordDate?: string
    },
  ): Promise<{ revisionId: string; revisionVersion: number; savedAt: string }> {
    return api.put(`/api/admin/diaries/${encodeURIComponent(id)}/draft`, payload)
  },
  ensureDraft(id: string): Promise<{ revisionId: string; revisionVersion: number; created: boolean }> {
    return api.post(`/api/admin/diaries/${encodeURIComponent(id)}/draft`)
  },
  publish(id: string, revisionId: string, expectedVersion: number): Promise<{ id: string; publishedAt: string }> {
    return api.post(`/api/admin/diaries/${encodeURIComponent(id)}/publish`, { revisionId, expectedVersion })
  },
  commit(id: string, revisionId: string, expectedVersion: number): Promise<{ id: string; publishedAt: string }> {
    return api.post(`/api/admin/diaries/${encodeURIComponent(id)}/commit`, { revisionId, expectedVersion })
  },
  unpublish(id: string): Promise<unknown> {
    return api.post(`/api/admin/diaries/${encodeURIComponent(id)}/unpublish`)
  },
  duplicate(id: string): Promise<{ id: string }> {
    return api.post(`/api/admin/diaries/${encodeURIComponent(id)}/duplicate`)
  },
  deleteDiary(id: string, deleteUnreferencedPhotos: boolean): Promise<unknown> {
    return api.delete(`/api/admin/diaries/${encodeURIComponent(id)}${
      deleteUnreferencedPhotos ? '?deleteUnreferencedPhotos=true' : ''
    }`)
  },
  batch(
    action: 'publish' | 'unpublish' | 'delete' | 'export',
    ids: string[],
    deleteUnreferencedPhotos = false,
  ): Promise<{
    results: Array<{ id: string; success: boolean; error?: { code: string; message: string } }>
    taskId?: string
  }> {
    return api.post('/api/admin/diaries/batch', { action, ids, deleteUnreferencedPhotos })
  },

  // ---- 照片 ----
  photos(params: {
    page?: number
    limit?: number
    keyword?: string | null
    status?: string | null
    unassociated?: boolean
  }): Promise<AdminPhotoListResult> {
    const search = new URLSearchParams()
    search.set('page', String(params.page ?? 1))
    search.set('limit', String(params.limit ?? 24))
    if (params.keyword) search.set('keyword', params.keyword)
    if (params.status) search.set('status', params.status)
    if (params.unassociated) search.set('unassociated', 'true')
    return api.get(`/api/admin/photos?${search.toString()}`)
  },
  photo(id: string): Promise<AdminPhotoDetail> {
    return api.get(`/api/admin/photos/${encodeURIComponent(id)}`)
  },
  deletePhoto(id: string): Promise<{ photoId: string; status: string; message: string }> {
    return api.delete(`/api/admin/photos/${encodeURIComponent(id)}`)
  },
  uploadIntent(payload: {
    filename: string
    mimeType: string
    fileSize: number
    idempotencyKey: string
  }): Promise<{ photoId: string; uploadUrl: string; status: string }> {
    return api.post('/api/admin/photos/upload-intents', payload)
  },

  // ---- 站点 ----
  settings(): Promise<SiteSettings> {
    return api.get('/api/public/settings')
  },
  updateSettings(input: SiteSettings): Promise<SiteSettings> {
    return api.put('/api/admin/settings', input)
  },
  logs(params: {
    page?: number
    limit?: number
    actionType?: string | null
    startDate?: string | null
    endDate?: string | null
  }): Promise<OperationLogListResult> {
    const search = new URLSearchParams()
    search.set('page', String(params.page ?? 1))
    search.set('limit', String(params.limit ?? 20))
    if (params.actionType) search.set('actionType', params.actionType)
    if (params.startDate) search.set('startDate', params.startDate)
    if (params.endDate) search.set('endDate', params.endDate)
    return api.get(`/api/admin/logs?${search.toString()}`)
  },

  // ---- 数据导出与恢复 ----
  exportData(scope: 'all' | 'published' | 'draft'): Promise<{ taskId: string; status: string }> {
    return api.post('/api/admin/data/export', { scope })
  },
  dataTask(taskId: string): Promise<DataTaskResult> {
    return api.get(`/api/admin/data/tasks/${encodeURIComponent(taskId)}`)
  },
  downloadDataUrl(taskId: string): string {
    return `/api/admin/data/tasks/${encodeURIComponent(taskId)}/download`
  },
  uploadImportZip(file: File, onProgress?: (ratio: number) => void): Promise<{
    uploadId: string
    size: number
    expiresAt: string
  }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/admin/data/import/upload')
      xhr.withCredentials = true
      xhr.setRequestHeader('Content-Type', 'application/zip')
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          onProgress(event.loaded / event.total)
        }
      }
      xhr.onload = () => {
        let body: { success?: boolean; data?: unknown; error?: { message?: string } } | null = null
        try {
          body = JSON.parse(xhr.responseText)
        } catch {
          body = null
        }
        if (xhr.status >= 200 && xhr.status < 300 && body?.success) {
          resolve(body.data as { uploadId: string; size: number; expiresAt: string })
          return
        }
        reject(new Error(body?.error?.message ?? `上传失败（${xhr.status}）`))
      }
      xhr.onerror = () => reject(new Error('网络错误，上传失败'))
      xhr.send(file)
    })
  },
  previewImport(uploadId: string): Promise<ImportPreview> {
    return api.post('/api/admin/data/import/preview', { uploadId })
  },
  confirmImport(previewId: string): Promise<{ taskId: string; status: string }> {
    return api.post('/api/admin/data/import/confirm', { previewId, confirm: true })
  },
}

// 管理端图片地址（草稿照片也必须通过管理接口读取）
export function adminPhotoUrl(photoId: string, variant: 'thumbnail' | 'original'): string {
  return `/api/admin/photos/${encodeURIComponent(photoId)}/${variant}`
}

// 带进度的二进制上传（PUT 原图 / 缩略图）
export function uploadBinary(
  path: string,
  blob: Blob,
  onProgress?: (ratio: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', path)
    xhr.withCredentials = true
    xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(event.loaded / event.total)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
        return
      }
      let message = `上传失败（${xhr.status}）`
      try {
        const body = JSON.parse(xhr.responseText) as { error?: { message?: string } }
        if (body?.error?.message) message = body.error.message
      } catch {
        // 忽略解析失败
      }
      reject(new Error(message))
    }
    xhr.onerror = () => reject(new Error('网络错误，上传失败'))
    xhr.send(blob)
  })
}

// 浏览器端生成缩略图（最长边 480px，JPEG）
export async function generateThumbnail(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const maxSide = 480
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
  } catch {
    // 某些格式（如 GIF）无法解码时，跳过缩略图，服务端会回退使用原图
    return null
  }
}
