import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminApi } from '../../services/adminApi'
import { ApiClientError } from '../../services/api'
import { todayDateString } from '../../utils/format'

// 新建日记中转页：创建今天的草稿并跳转编辑器
export default function AdminNewDiary() {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [retrying, setRetrying] = useState(false)

  const create = useCallback(async () => {
    setError('')
    try {
      const result = await adminApi.createDiary(todayDateString())
      navigate(`/admin/diaries/${result.id}/edit`, { replace: true })
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '创建日记失败，请稍后再试')
    } finally {
      setRetrying(false)
    }
  }, [navigate])

  useEffect(() => {
    create()
  }, [create])

  if (error) {
    return (
      <div className="admin-empty">
        <p>{error}</p>
        <button
          type="button"
          className="admin-btn"
          onClick={() => {
            setRetrying(true)
            create()
          }}
          disabled={retrying}
        >
          {retrying ? '重试中…' : '重新创建'}
        </button>
      </div>
    )
  }

  return <div className="admin-loading">正在创建今天的日记…</div>
}
