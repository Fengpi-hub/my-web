import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BookOpen, FileText, Images, HardDrive, Plus } from 'lucide-react'
import { adminApi } from '../../services/adminApi'
import { ApiClientError } from '../../services/api'
import { formatBytes, formatDateTime, todayDateString } from '../../utils/format'
import { getActionLabel } from '../../utils/adminLabels'
import type { DashboardData } from '../../types'

// 概览：真实统计 + 最近编辑记录 + 快捷新建
export default function AdminDashboard() {
  const navigate = useNavigate()
  const [data, setData] = useState<DashboardData | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const load = () => {
    setState('loading')
    adminApi
      .dashboard()
      .then((result) => {
        setData(result)
        setState('ready')
      })
      .catch(() => setState('error'))
  }

  useEffect(() => {
    load()
  }, [])

  const handleQuickCreate = async () => {
    if (creating) return
    setCreating(true)
    setError('')
    try {
      const result = await adminApi.createDiary(todayDateString())
      navigate(`/admin/diaries/${result.id}/edit`)
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '新建失败，请稍后再试')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div>
      <header className="admin-heading">
        <div>
          <h1 className="admin-heading-title">概览</h1>
          <p className="admin-heading-desc">今天的记录，也在慢慢长成一段故事</p>
        </div>
        <div className="admin-heading-actions">
          <button type="button" className="admin-btn admin-btn-primary" onClick={handleQuickCreate} disabled={creating}>
            <Plus size={15} />
            {creating ? '创建中…' : '新建日记'}
          </button>
        </div>
      </header>

      {error && <div className="admin-notice is-error">{error}</div>}

      {state === 'loading' && <div className="admin-loading">正在加载统计…</div>}

      {state === 'error' && (
        <div className="admin-empty">
          <p>统计数据加载失败</p>
          <button type="button" className="admin-btn" onClick={load}>
            重新加载
          </button>
        </div>
      )}

      {state === 'ready' && data && (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <p className="stat-label">已发布日记</p>
              <p className="stat-value">{data.publishedDiaries}</p>
              <p className="stat-hint">
                <BookOpen size={11} /> 访客可以看到
              </p>
            </div>
            <div className="stat-card">
              <p className="stat-label">草稿</p>
              <p className="stat-value">{data.draftDiaries}</p>
              <p className="stat-hint">
                <FileText size={11} /> 尚未公开
              </p>
            </div>
            <div className="stat-card">
              <p className="stat-label">照片总数</p>
              <p className="stat-value">{data.totalPhotos}</p>
              <p className="stat-hint">
                <Images size={11} /> 已成功上传
              </p>
            </div>
            <div className="stat-card">
              <p className="stat-label">照片存储</p>
              <p className="stat-value">{formatBytes(data.storageUsed)}</p>
              <p className="stat-hint">
                <HardDrive size={11} /> 原图占用（R2）
              </p>
            </div>
          </div>

          <div className="dashboard-columns">
            <section className="admin-card">
              <h2 className="dashboard-section-title">最近编辑记录</h2>
              {data.recentActivities.length === 0 ? (
                <p className="admin-empty" style={{ padding: '24px 0' }}>
                  还没有操作记录
                </p>
              ) : (
                <ul className="activity-list">
                  {data.recentActivities.map((item) => (
                    <li className="activity-item" key={item.id}>
                      <div>
                        <div className="activity-summary">{item.summary}</div>
                        <div className="diary-admin-meta">{getActionLabel(item.actionType)}</div>
                      </div>
                      <span className="activity-time">{formatDateTime(item.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="settings-actions">
                <Link to="/admin/logs" className="admin-btn admin-btn-sm">
                  查看全部操作记录
                </Link>
              </div>
            </section>

            <section className="admin-card">
              <h2 className="dashboard-section-title">快捷入口</h2>
              <div className="quick-create">
                <p className="admin-heading-desc" style={{ margin: 0 }}>
                  记录今天的心情，照片与文字都会自动保存为草稿。
                </p>
                <button type="button" className="admin-btn admin-btn-primary" onClick={handleQuickCreate} disabled={creating}>
                  <Plus size={15} />
                  写今天的日记
                </button>
                <Link to="/admin/diaries" className="admin-btn">
                  查看全部日记
                </Link>
                <Link to="/admin/photos" className="admin-btn">
                  管理照片
                </Link>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
