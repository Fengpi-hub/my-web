import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Database, HardDrive, Images, History } from 'lucide-react'
import { adminApi } from '../../services/adminApi'
import { ApiClientError } from '../../services/api'
import { formatBytes } from '../../utils/format'
import type { DashboardData, SiteSettings } from '../../types'

const EMPTY_SETTINGS: SiteSettings = {
  siteName: '',
  siteSubtitle: '',
  browserTitle: '',
}

// 站点设置：站点文案、密码修改、存储用量与数据入口
export default function AdminSettings() {
  const [settings, setSettings] = useState<SiteSettings>(EMPTY_SETTINGS)
  const [username, setUsername] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [settingError, setSettingError] = useState('')
  const [settingNotice, setSettingNotice] = useState('')

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changing, setChanging] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordNotice, setPasswordNotice] = useState('')

  const [stats, setStats] = useState<DashboardData | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([adminApi.settings(), adminApi.me(), adminApi.dashboard()])
      .then(([siteSettings, session, dashboard]) => {
        if (cancelled) return
        setSettings(siteSettings)
        setUsername(session.admin?.username ?? '')
        setStats(dashboard)
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleSaveSettings = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    setSettingError('')
    setSettingNotice('')

    if (!settings.siteName.trim() || !settings.siteSubtitle.trim() || !settings.browserTitle.trim()) {
      setSettingError('站点名称、副标题和浏览器标题都不能为空')
      return
    }

    setSaving(true)
    try {
      const saved = await adminApi.updateSettings({
        siteName: settings.siteName.trim(),
        siteSubtitle: settings.siteSubtitle.trim(),
        browserTitle: settings.browserTitle.trim(),
      })
      setSettings(saved)
      setSettingNotice('站点设置已保存')
    } catch (err) {
      setSettingError(err instanceof ApiClientError ? err.message : '保存失败，请稍后再试')
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async (event: FormEvent) => {
    event.preventDefault()
    if (changing) return
    setPasswordError('')
    setPasswordNotice('')

    if (!currentPassword || !newPassword) {
      setPasswordError('请填写当前密码和新密码')
      return
    }
    if (newPassword.length < 8) {
      setPasswordError('新密码至少需要 8 位字符')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的新密码不一致')
      return
    }

    setChanging(true)
    try {
      await adminApi.changePassword(currentPassword, newPassword)
      setPasswordNotice('密码已修改，其他设备上的登录状态会失效')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setPasswordError(err instanceof ApiClientError ? err.message : '修改失败，请稍后再试')
    } finally {
      setChanging(false)
    }
  }

  if (state === 'loading') {
    return <div className="admin-loading">正在加载设置…</div>
  }

  if (state === 'error') {
    return (
      <div className="admin-empty">
        <p>设置加载失败</p>
        <button
          type="button"
          className="admin-btn"
          onClick={() => window.location.reload()}
        >
          重新加载
        </button>
      </div>
    )
  }

  return (
    <div>
      <header className="admin-heading">
        <div>
          <h1 className="admin-heading-title">设置</h1>
          <p className="admin-heading-desc">
            当前登录：{username || '管理员'}
          </p>
        </div>
      </header>

      <div className="settings-stack">
        <section className="admin-card">
          <h2 className="dashboard-section-title">站点信息</h2>
          <form onSubmit={handleSaveSettings}>
            <div className="settings-grid">
              <div className="admin-field">
                <label className="admin-label" htmlFor="site-name">
                  站点名称
                </label>
                <input
                  id="site-name"
                  className="admin-input"
                  value={settings.siteName}
                  maxLength={50}
                  onChange={(event) => setSettings({ ...settings, siteName: event.target.value })}
                />
              </div>
              <div className="admin-field">
                <label className="admin-label" htmlFor="site-title">
                  浏览器标题
                </label>
                <input
                  id="site-title"
                  className="admin-input"
                  value={settings.browserTitle}
                  maxLength={100}
                  onChange={(event) =>
                    setSettings({ ...settings, browserTitle: event.target.value })
                  }
                />
              </div>
            </div>
            <div className="admin-field" style={{ marginTop: 14 }}>
              <label className="admin-label" htmlFor="site-subtitle">
                站点副标题
              </label>
              <input
                id="site-subtitle"
                className="admin-input"
                value={settings.siteSubtitle}
                maxLength={100}
                onChange={(event) =>
                  setSettings({ ...settings, siteSubtitle: event.target.value })
                }
              />
            </div>

            {settingError && <div className="admin-notice is-error">{settingError}</div>}
            {settingNotice && <div className="admin-notice is-success">{settingNotice}</div>}

            <div className="settings-actions">
              <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>
                {saving ? '保存中…' : '保存设置'}
              </button>
            </div>
          </form>
        </section>

        <section className="admin-card">
          <h2 className="dashboard-section-title">账户安全</h2>
          <form onSubmit={handleChangePassword}>
            <div className="settings-grid">
              <div className="admin-field">
                <label className="admin-label" htmlFor="current-password">
                  当前密码
                </label>
                <input
                  id="current-password"
                  className="admin-input"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </div>
              <div className="admin-field">
                <label className="admin-label" htmlFor="new-password">
                  新密码
                </label>
                <input
                  id="new-password"
                  className="admin-input"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </div>
            </div>
            <div className="admin-field" style={{ marginTop: 14 }}>
              <label className="admin-label" htmlFor="confirm-password">
                确认新密码
              </label>
              <input
                id="confirm-password"
                className="admin-input"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </div>

            {passwordError && <div className="admin-notice is-error">{passwordError}</div>}
            {passwordNotice && <div className="admin-notice is-success">{passwordNotice}</div>}

            <div className="settings-actions">
              <button type="submit" className="admin-btn admin-btn-primary" disabled={changing}>
                {changing ? '修改中…' : '修改密码'}
              </button>
            </div>
          </form>
        </section>

        <section className="admin-card">
          <h2 className="dashboard-section-title">存储与记录</h2>
          <div className="settings-grid">
            <div className="settings-row">
              <span className="stat-hint">
                <Images size={11} /> 照片总数
              </span>
              <strong>{stats?.totalPhotos ?? '—'}</strong>
            </div>
            <div className="settings-row">
              <span className="stat-hint">
                <HardDrive size={11} /> 照片存储
              </span>
              <strong>{stats ? formatBytes(stats.storageUsed) : '—'}</strong>
            </div>
          </div>
          <div className="settings-actions">
            <Link to="/admin/photos" className="admin-btn admin-btn-sm">
              <Images size={14} />
              照片管理
            </Link>
            <Link to="/admin/logs" className="admin-btn admin-btn-sm">
              <History size={14} />
              操作记录
            </Link>
            <Link to="/admin/data" className="admin-btn admin-btn-sm">
              <Database size={14} />
              数据管理
            </Link>
          </div>
        </section>
      </div>
    </div>
  )
}
