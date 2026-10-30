import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { adminApi } from '../../services/adminApi'
import { ApiClientError } from '../../services/api'
import { formatDateTime } from '../../utils/format'
import { LOG_ACTION_OPTIONS, getActionLabel } from '../../utils/adminLabels'
import type { OperationLogItem } from '../../types'

const PAGE_SIZE = 20

// 操作记录：按类型与日期筛选，分页展示
export default function AdminLogs() {
  const [items, setItems] = useState<OperationLogItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  const [actionType, setActionType] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const load = async () => {
    setState('loading')
    setError('')
    try {
      const result = await adminApi.logs({
        page,
        limit: PAGE_SIZE,
        actionType: actionType || null,
        startDate: startDate || null,
        endDate: endDate || null,
      })
      setItems(result.items)
      setTotal(result.pagination.total)
      setState('ready')
    } catch (err) {
      setState('error')
      setError(err instanceof ApiClientError ? err.message : '操作记录加载失败')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, actionType, startDate, endDate])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div>
      <header className="admin-heading">
        <div>
          <h1 className="admin-heading-title">操作记录</h1>
          <p className="admin-heading-desc">共 {total} 条记录，按时间倒序排列</p>
        </div>
      </header>

      <div className="admin-filter-bar">
        <select
          className="admin-select"
          value={actionType}
          onChange={(event) => {
            setActionType(event.target.value)
            setPage(1)
          }}
        >
          <option value="">全部类型</option>
          {LOG_ACTION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          className="admin-input"
          type="date"
          value={startDate}
          onChange={(event) => {
            setStartDate(event.target.value)
            setPage(1)
          }}
          aria-label="开始日期"
        />
        <input
          className="admin-input"
          type="date"
          value={endDate}
          onChange={(event) => {
            setEndDate(event.target.value)
            setPage(1)
          }}
          aria-label="结束日期"
        />
      </div>

      {state === 'loading' && <div className="admin-loading">正在加载操作记录…</div>}

      {state === 'error' && (
        <div className="admin-empty">
          <p>{error || '操作记录加载失败'}</p>
          <button type="button" className="admin-btn" onClick={load}>
            重新加载
          </button>
        </div>
      )}

      {state === 'ready' && (
        <>
          {items.length === 0 ? (
            <div className="admin-empty">
              <p>没有符合条件的操作记录</p>
            </div>
          ) : (
            <div className="admin-card log-scroll">
              <table className="log-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>操作</th>
                    <th>摘要</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(item.createdAt)}</td>
                      <td>
                        <span className="log-action">{getActionLabel(item.actionType)}</span>
                      </td>
                      <td>{item.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
    </div>
  )
}
