import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, LogIn } from 'lucide-react'
import { adminApi } from '../../services/adminApi'
import { ApiClientError } from '../../services/api'
import '../../styles/admin.css'

// 管理员登录：密码默认隐藏，失败显示通用提示
export default function AdminLogin() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 已登录则直接进入后台
  useEffect(() => {
    adminApi
      .me()
      .then((result) => {
        if (result.authenticated) navigate('/admin', { replace: true })
      })
      .catch(() => {
        // 忽略：停留在登录页
      })
  }, [navigate])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return
    setError('')

    if (!username.trim() || !password) {
      setError('请输入用户名和密码')
      return
    }

    setSubmitting(true)
    try {
      await adminApi.login(username.trim(), password)
      navigate('/admin', { replace: true })
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message)
      } else {
        setError('登录失败，请稍后再试')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <h1 className="login-title">生活记录</h1>
        <p className="login-subtitle">管理员登录</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="admin-field">
            <label className="admin-label" htmlFor="login-username">
              用户名
            </label>
            <input
              id="login-username"
              className="admin-input"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="管理员用户名"
            />
          </div>

          <div className="admin-field">
            <label className="admin-label" htmlFor="login-password">
              密码
            </label>
            <div className="login-field">
              <input
                id="login-password"
                className="admin-input"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入密码"
              />
              <button
                type="button"
                className="login-eye"
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && <p className="login-error">{error}</p>}

          <button type="submit" className="admin-btn admin-btn-primary login-submit" disabled={submitting}>
            <LogIn size={15} />
            {submitting ? '登录中…' : '登录'}
          </button>
        </form>
      </section>
    </main>
  )
}
