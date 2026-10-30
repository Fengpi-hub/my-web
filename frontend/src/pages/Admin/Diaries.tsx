import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, Pencil, Trash2, EyeOff, ChevronLeft, ChevronRight } from 'lucide-react'
import ConfirmDialog from '../../components/admin/ConfirmDialog'
import { adminApi } from '../../services/adminApi'
import { ApiClientError } from '../../services/api'
import { formatDateTime } from '../../utils/format'
import type { AdminDiaryListItem } from '../../types'

type StatusFilter = 'all' | 'draft' | 'published'
type SortFilter = 'record_date' | 'published'
type PhotosFilter = 'all' | 'with' | 'without'

type PendingAction =
  | { kind: 'delete'; ids: string[] }
  | { kind: 'unpublish'; ids: string[] }

const PAGE_SIZE = 20

// 日记管理：搜索、筛选、排序、单篇与批量操作
export default function AdminDiaries() {
  const navigate = useNavigate()
  const [items, setItems] = useState<AdminDiaryListItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [year, setYear] = useState<number | null>(null)
  const [month, setMonth] = useState<number | null>(null)
  const [photosFilter, setPhotosFilter] = useState<PhotosFilter>('all')
  const [sort, setSort] = useState<SortFilter>('record_date')

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [deletePhotos, setDeletePhotos] = useState(false)
  const [busy, setBusy] = useState(false)
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

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear()
    return Array.from({ length: 9 }, (_, index) => current - index)
  }, [])

  const load = async () => {
    setState('loading')
    setError('')
    try {
      const result = await adminApi.diaries({
        page,
        limit: PAGE_SIZE,
        keyword: keyword || null,
        status: status === 'all' ? null : status,
        year,
        month,
        sort,
        hasPhotos: photosFilter === 'all' ? null : photosFilter === 'with',
      })
      setItems(result.items)
      setTotal(result.pagination.total)
      setState('ready')
    } catch (err) {
      setState('error')
      setError(err instanceof ApiClientError ? err.message : '日记列表加载失败')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, keyword, status, year, month, photosFilter, sort])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id))
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(items.map((item) => item.id)))
    }
  }

  // 复制为新日记
  const handleDuplicate = async (id: string) => {
    setError('')
    setNotice('')
    try {
      await adminApi.duplicate(id)
      setNotice('已复制为新的草稿')
      load()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '复制失败，请稍后再试')
    }
  }

  // 执行确认操作
  const handleConfirm = async () => {
    if (!pending) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (pending.ids.length === 1) {
        const id = pending.ids[0]
        if (pending.kind === 'delete') {
          await adminApi.deleteDiary(id, deletePhotos)
        } else {
          await adminApi.unpublish(id)
        }
        setNotice(pending.kind === 'delete' ? '日记已删除' : '已取消发布，转为草稿')
      } else {
        // 批量操作逐项返回结果
        const result = await adminApi.batch(
          pending.kind === 'delete' ? 'delete' : 'unpublish',
          pending.ids,
          deletePhotos,
        )
        const failed = result.results.filter((item) => !item.success)
        if (failed.length === 0) {
          setNotice(
            pending.kind === 'delete'
              ? `已删除 ${pending.ids.length} 篇日记`
              : `已取消发布 ${pending.ids.length} 篇日记`,
          )
        } else {
          const firstMessage = failed[0]?.error?.message ?? '部分操作失败'
          setError(`${failed.length} 项操作失败：${firstMessage}`)
        }
      }
      setSelected(new Set())
      setPending(null)
      setDeletePhotos(false)
      load()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '操作失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  const batchAction = (kind: 'publish' | 'unpublish' | 'delete') => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    if (kind === 'delete') {
      setPending({ kind: 'delete', ids })
      return
    }
    if (kind === 'unpublish') {
      setPending({ kind: 'unpublish', ids })
      return
    }
    // 发布草稿无需二次确认
    setBusy(true)
    setError('')
    setNotice('')
    adminApi
      .batch('publish', ids)
      .then((result) => {
        const failed = result.results.filter((item) => !item.success)
        if (failed.length === 0) {
          setNotice(`已发布 ${ids.length} 篇草稿`)
          setSelected(new Set())
        } else {
          setError(`${failed.length} 项发布失败：${failed[0]?.error?.message ?? '未知原因'}`)
        }
        load()
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err.message : '批量发布失败')
      })
      .finally(() => setBusy(false))
  }

  // 批量导出选中日记
  const handleBatchExport = async () => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await adminApi.batch('export', ids)
      const failed = result.results.filter((item) => !item.success)
      if (failed.length > 0) {
        setError(`${failed.length} 篇日记无法导出：${failed[0]?.error?.message ?? '未知原因'}`)
      }
      if (result.taskId) {
        navigate(`/admin/data?task=${encodeURIComponent(result.taskId)}`)
        return
      }
      setNotice('导出任务已创建，请前往数据管理页查看')
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '批量导出失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <header className="admin-heading">
        <div>
          <h1 className="admin-heading-title">日记管理</h1>
          <p className="admin-heading-desc">共 {total} 篇日记</p>
        </div>
        <div className="admin-heading-actions">
          <button
            type="button"
            className="admin-btn admin-btn-primary"
            onClick={() => navigate('/admin/diaries/new')}
          >
            新建日记
          </button>
        </div>
      </header>

      {notice && <div className="admin-notice is-success">{notice}</div>}
      {error && <div className="admin-notice is-error">{error}</div>}

      <div className="admin-filter-bar">
        <input
          className="admin-input admin-search"
          type="search"
          placeholder="搜索碎碎念文字"
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
          <option value="published">已发布</option>
          <option value="draft">草稿</option>
        </select>
        <select
          className="admin-select"
          value={year ?? ''}
          onChange={(event) => {
            setYear(event.target.value ? Number(event.target.value) : null)
            setMonth(null)
            setPage(1)
          }}
        >
          <option value="">全部年份</option>
          {yearOptions.map((option) => (
            <option key={option} value={option}>
              {option} 年
            </option>
          ))}
        </select>
        <select
          className="admin-select"
          value={month ?? ''}
          onChange={(event) => {
            setMonth(event.target.value ? Number(event.target.value) : null)
            setPage(1)
          }}
          disabled={year === null}
        >
          <option value="">全部月份</option>
          {Array.from({ length: 12 }, (_, index) => index + 1).map((option) => (
            <option key={option} value={option}>
              {option} 月
            </option>
          ))}
        </select>
        <select
          className="admin-select"
          value={photosFilter}
          onChange={(event) => {
            setPhotosFilter(event.target.value as PhotosFilter)
            setPage(1)
          }}
        >
          <option value="all">照片不限</option>
          <option value="with">有照片</option>
          <option value="without">纯文字</option>
        </select>
        <select
          className="admin-select"
          value={sort}
          onChange={(event) => {
            setSort(event.target.value as SortFilter)
            setPage(1)
          }}
        >
          <option value="record_date">按记录日期</option>
          <option value="published">按发布时间</option>
        </select>
      </div>

      {selected.size > 0 && (
        <div className="admin-batch-bar">
          <span>已选择 {selected.size} 篇</span>
          <button type="button" className="admin-btn admin-btn-sm" onClick={toggleSelectAll}>
            {allSelected ? '取消全选' : '全选本页'}
          </button>
          <button
            type="button"
            className="admin-btn admin-btn-sm"
            onClick={() => batchAction('publish')}
            disabled={busy}
          >
            发布草稿
          </button>
          <button
            type="button"
            className="admin-btn admin-btn-sm"
            onClick={() => batchAction('unpublish')}
            disabled={busy}
          >
            取消发布
          </button>
          <button
            type="button"
            className="admin-btn admin-btn-sm"
            onClick={handleBatchExport}
            disabled={busy}
          >
            导出选中
          </button>
          <button
            type="button"
            className="admin-btn admin-btn-sm admin-btn-danger"
            onClick={() => batchAction('delete')}
            disabled={busy}
          >
            删除
          </button>
          <button type="button" className="admin-btn admin-btn-sm admin-btn-ghost" onClick={() => setSelected(new Set())}>
            清空选择
          </button>
        </div>
      )}

      {state === 'loading' && (
        <div className="diary-admin-list">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="admin-skeleton" />
          ))}
        </div>
      )}

      {state === 'error' && (
        <div className="admin-empty">
          <p>{error || '日记列表加载失败'}</p>
          <button type="button" className="admin-btn" onClick={load}>
            重新加载
          </button>
        </div>
      )}

      {state === 'ready' && items.length === 0 && (
        <div className="admin-empty">没有符合条件的日记</div>
      )}

      {state === 'ready' && items.length > 0 && (
        <>
          <div className="diary-admin-list">
            {items.map((item) => (
              <div className="diary-admin-row" key={item.id}>
                <input
                  type="checkbox"
                  className="diary-admin-check"
                  checked={selected.has(item.id)}
                  onChange={() => toggleSelect(item.id)}
                  aria-label={`选择 ${item.recordDate}`}
                />
                <div className="diary-admin-main">
                  <div className="diary-admin-title">
                    <span className="diary-admin-date">{item.recordDate}</span>
                    <span className={`status-badge ${item.status === 'published' ? 'is-published' : 'is-draft'}`}>
                      {item.status === 'published' ? '已发布' : '草稿'}
                    </span>
                    {item.hasDraft && item.status === 'published' && (
                      <span className="status-badge is-muted">有未提交修改</span>
                    )}
                    {item.photoCount > 0 && (
                      <span className="diary-admin-meta">{item.photoCount} 张照片</span>
                    )}
                  </div>
                  {item.contentPreview && (
                    <p className="diary-admin-preview">{item.contentPreview}</p>
                  )}
                  <div className="diary-admin-meta">
                    最后更新 {formatDateTime(item.updatedAt)}
                    {item.publishedAt ? ` · 发布于 ${formatDateTime(item.publishedAt)}` : ''}
                  </div>
                </div>
                <div className="diary-admin-actions">
                  <button
                    type="button"
                    className="admin-btn admin-btn-sm"
                    onClick={() => navigate(`/admin/diaries/${item.id}/edit`)}
                  >
                    <Pencil size={13} />
                    编辑
                  </button>
                  <button type="button" className="admin-btn admin-btn-sm" onClick={() => handleDuplicate(item.id)}>
                    <Copy size={13} />
                    复制
                  </button>
                  {item.status === 'published' && (
                    <button
                      type="button"
                      className="admin-btn admin-btn-sm"
                      onClick={() => setPending({ kind: 'unpublish', ids: [item.id] })}
                    >
                      <EyeOff size={13} />
                      取消发布
                    </button>
                  )}
                  <button
                    type="button"
                    className="admin-btn admin-btn-sm admin-btn-danger"
                    onClick={() => setPending({ kind: 'delete', ids: [item.id] })}
                  >
                    <Trash2 size={13} />
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="admin-pagination">
              <button
                type="button"
                className="admin-btn admin-btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
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
                disabled={page >= totalPages}
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
              >
                下一页
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={pending?.kind === 'delete' ? '删除日记' : '取消发布'}
        message={
          pending?.kind === 'delete'
            ? `确定删除${pending.ids.length > 1 ? `这 ${pending.ids.length} 篇日记` : '这篇日记'}吗？删除后不可恢复。`
            : `确定取消发布${pending && pending.ids.length > 1 ? `这 ${pending.ids.length} 篇日记` : '这篇日记'}吗？将转为草稿并保留文字与照片。`
        }
        confirmText={pending?.kind === 'delete' ? '删除' : '取消发布'}
        danger={pending?.kind === 'delete'}
        busy={busy}
        onCancel={() => {
          if (busy) return
          setPending(null)
          setDeletePhotos(false)
        }}
        onConfirm={handleConfirm}
      >
        {pending?.kind === 'delete' && (
          <label className="settings-row" style={{ fontSize: 13 }}>
            <span>同时删除不再被其他日记引用的照片</span>
            <input
              type="checkbox"
              checked={deletePhotos}
              onChange={(event) => setDeletePhotos(event.target.checked)}
            />
          </label>
        )}
      </ConfirmDialog>
    </div>
  )
}
