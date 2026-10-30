import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import ConfirmDialog from '../../components/admin/ConfirmDialog'
import { adminApi, adminPhotoUrl } from '../../services/adminApi'
import { ApiClientError } from '../../services/api'
import { formatBytes, formatDateTime } from '../../utils/format'
import type { AdminPhotoDetail, AdminPhotoItem } from '../../types'

type StatusFilter = 'all' | 'uploaded' | 'pending' | 'failed'

const PAGE_SIZE = 24

const STATUS_LABELS: Record<string, string> = {
  uploaded: '已上传',
  pending: '待上传',
  uploading: '上传中',
  failed: '上传失败',
}

// 照片管理：筛选、分页、详情查看与删除
export default function AdminPhotos() {
  const navigate = useNavigate()
  const [items, setItems] = useState<AdminPhotoItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [unassociated, setUnassociated] = useState(false)

  const [detail, setDetail] = useState<AdminPhotoDetail | null>(null)
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'error'>('idle')

  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  // 搜索输入防抖
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setKeyword(keywordInput.trim())
      setPage(1)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [keywordInput])

  const load = async () => {
    setState('loading')
    setError('')
    try {
      const result = await adminApi.photos({
        page,
        limit: PAGE_SIZE,
        keyword: keyword || null,
        status: status === 'all' ? null : status,
        unassociated,
      })
      setItems(result.items)
      setTotal(result.pagination.total)
      setState('ready')
    } catch (err) {
      setState('error')
      setError(err instanceof ApiClientError ? err.message : '照片列表加载失败')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, keyword, status, unassociated])

  const openDetail = async (photoId: string) => {
    setDetailState('loading')
    setDetail(null)
    setNotice('')
    setError('')
    try {
      const result = await adminApi.photo(photoId)
      setDetail(result)
      setDetailState('idle')
    } catch {
      setDetailState('error')
    }
  }

  const closeDetail = () => {
    setDetail(null)
    setDetailState('idle')
    setConfirmDelete(false)
  }

  const handleDelete = async () => {
    if (!detail || deleting) return
    setDeleting(true)
    setError('')
    try {
      const result = await adminApi.deletePhoto(detail.id)
      setNotice(result.message)
      setConfirmDelete(false)
      setDetail(null)
      setDetailState('idle')
      load()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '删除失败，请稍后再试')
      setConfirmDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div>
      <header className="admin-heading">
        <div>
          <h1 className="admin-heading-title">照片管理</h1>
          <p className="admin-heading-desc">共 {total} 张照片，点击可查看详情</p>
        </div>
      </header>

      <div className="admin-filter-bar">
        <input
          className="admin-input admin-search"
          type="search"
          placeholder="搜索文件名…"
          value={keywordInput}
          onChange={(event) => setKeywordInput(event.target.value)}
        />
        <select
          className="admin-select"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as StatusFilter)
            setPage(1)
          }}
        >
          <option value="all">全部状态</option>
          <option value="uploaded">已上传</option>
          <option value="pending">待上传</option>
          <option value="failed">上传失败</option>
        </select>
        <label className="admin-batch-bar" style={{ marginBottom: 0 }}>
          <input
            type="checkbox"
            className="diary-admin-check"
            checked={unassociated}
            onChange={(event) => {
              setUnassociated(event.target.checked)
              setPage(1)
            }}
          />
          仅看未关联照片
        </label>
      </div>

      {notice && <div className="admin-notice is-success">{notice}</div>}
      {error && !detail && <div className="admin-notice is-error">{error}</div>}

      {state === 'loading' && <div className="admin-loading">正在加载照片…</div>}

      {state === 'error' && (
        <div className="admin-empty">
          <p>{error || '照片列表加载失败'}</p>
          <button type="button" className="admin-btn" onClick={load}>
            重新加载
          </button>
        </div>
      )}

      {state === 'ready' && (
        <>
          {items.length === 0 ? (
            <div className="admin-empty">
              <p>没有符合条件的照片</p>
            </div>
          ) : (
            <div className="admin-photo-grid">
              {items.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  className="admin-photo-card"
                  onClick={() => openDetail(photo.id)}
                  title={photo.originalName}
                >
                  <img
                    src={adminPhotoUrl(photo.id, 'thumbnail')}
                    alt={photo.originalName}
                    loading="lazy"
                  />
                  {photo.uploadStatus && photo.uploadStatus !== 'uploaded' && (
                    <span className="admin-photo-card-status">
                      {STATUS_LABELS[photo.uploadStatus] ?? photo.uploadStatus}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {total > PAGE_SIZE && (
            <div className="admin-pagination">
              <button
                type="button"
                className="admin-btn admin-btn-sm"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft size={14} />
                上一页
              </button>
              <span>
                第 {page} / {totalPages} 页
              </span>
              <button
                type="button"
                className="admin-btn admin-btn-sm"
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                disabled={page >= totalPages}
              >
                下一页
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </>
      )}

      {(detailState === 'loading' || detailState === 'error') && (
        <div className="admin-modal-backdrop" onClick={closeDetail}>
          <div className="admin-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-loading">
              {detailState === 'loading' ? '正在加载照片详情…' : '照片详情加载失败，请重试'}
            </div>
            <div className="admin-modal-actions">
              <button type="button" className="admin-btn" onClick={closeDetail}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className="admin-modal-backdrop" onClick={closeDetail}>
          <div className="admin-modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="admin-modal-title">{detail.originalName}</h3>
            <p className="admin-modal-desc">上传时间：{formatDateTime(detail.uploadedAt ?? detail.createdAt)}</p>

            {detail.uploadStatus === 'uploaded' ? (
              <img
                className="admin-modal-image"
                src={adminPhotoUrl(detail.id, 'original')}
                alt={detail.originalName}
              />
            ) : (
              <div className="admin-notice is-error">
                照片状态：{STATUS_LABELS[detail.uploadStatus] ?? detail.uploadStatus}，暂无可用原图
              </div>
            )}

            {error && <div className="admin-notice is-error">{error}</div>}

            <div className="photo-meta-list">
              <div className="photo-meta-row">
                <span>文件大小</span>
                <strong>{formatBytes(detail.fileSize)}</strong>
              </div>
              <div className="photo-meta-row">
                <span>格式</span>
                <strong>{detail.mimeType}</strong>
              </div>
              <div className="photo-meta-row">
                <span>尺寸</span>
                <strong>
                  {detail.width && detail.height ? `${detail.width} × ${detail.height}` : '未知'}
                </strong>
              </div>
              <div className="photo-meta-row">
                <span>状态</span>
                <strong>{STATUS_LABELS[detail.uploadStatus] ?? detail.uploadStatus}</strong>
              </div>
              <div className="photo-meta-row">
                <span>所属日记</span>
                <strong>
                  {detail.associations.length === 0
                    ? '未关联'
                    : `${detail.associations.length} 篇`}
                </strong>
              </div>
            </div>

            {detail.associations.length > 0 && (
              <div className="settings-actions">
                {detail.associations.map((item) => (
                  <button
                    key={`${item.revisionId}-${item.diaryId}`}
                    type="button"
                    className="admin-btn admin-btn-sm"
                    onClick={() => navigate(`/admin/diaries/${item.diaryId}/edit`)}
                  >
                    {item.recordDate} · {item.diaryStatus === 'published' ? '已发布' : '草稿'}
                  </button>
                ))}
              </div>
            )}

            <div className="admin-modal-actions">
              <button type="button" className="admin-btn" onClick={closeDetail}>
                关闭
              </button>
              <button
                type="button"
                className="admin-btn admin-btn-danger"
                onClick={() => setConfirmDelete(true)}
                disabled={deleting || detail.uploadStatus !== 'uploaded'}
              >
                <Trash2 size={14} />
                删除照片
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="删除这张照片？"
        message="照片会从存储中移除，删除后无法恢复。若照片仍被日记引用，需要先移除关联。"
        confirmText="删除"
        danger
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
