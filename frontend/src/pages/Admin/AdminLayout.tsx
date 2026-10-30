import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  BookOpen,
  PenLine,
  Images,
  Settings,
  History,
  Database,
  LogOut,
} from 'lucide-react'
import { adminApi } from '../../services/adminApi'
import '../../styles/admin.css'

interface NavItem {
  to: string
  label: string
  shortLabel: string
  icon: typeof LayoutDashboard
  match: (pathname: string) => boolean
}

const NAV_ITEMS: NavItem[] = [
  {
    to: '/admin',
    label: '概览',
    shortLabel: '概览',
    icon: LayoutDashboard,
    match: (pathname) => pathname === '/admin',
  },
  {
    to: '/admin/diaries',
    label: '日记管理',
    shortLabel: '日记',
    icon: BookOpen,
    match: (pathname) =>
      pathname === '/admin/diaries' || /^\/admin\/diaries\/[^/]+(?:\/edit)?$/.test(pathname),
  },
  {
    to: '/admin/diaries/new',
    label: '新建日记',
    shortLabel: '新建',
    icon: PenLine,
    match: (pathname) => pathname === '/admin/diaries/new',
  },
  {
    to: '/admin/photos',
    label: '照片管理',
    shortLabel: '照片',
    icon: Images,
    match: (pathname) => pathname.startsWith('/admin/photos'),
  },
  {
    to: '/admin/settings',
    label: '设置',
    shortLabel: '设置',
    icon: Settings,
    match: (pathname) => pathname.startsWith('/admin/settings'),
  },
  {
    to: '/admin/logs',
    label: '操作记录',
    shortLabel: '记录',
    icon: History,
    match: (pathname) => pathname.startsWith('/admin/logs'),
  },
  {
    to: '/admin/data',
    label: '数据管理',
    shortLabel: '数据',
    icon: Database,
    match: (pathname) => pathname.startsWith('/admin/data'),
  },
]

// 移动端底部导航（不含操作记录与数据管理，从设置页进入）
const BOTTOM_ITEMS = NAV_ITEMS.filter(
  (item) => item.to !== '/admin/logs' && item.to !== '/admin/data',
)

// 管理端布局：桌面左侧固定侧边栏，手机底部固定导航
export default function AdminLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'checking' | 'ready'>('checking')
  const [username, setUsername] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)

  // 进入后台前校验登录状态
  useEffect(() => {
    let cancelled = false
    adminApi
      .me()
      .then((result) => {
        if (cancelled) return
        if (!result.authenticated) {
          navigate('/admin/login', { replace: true })
          return
        }
        setUsername(result.admin?.username ?? '')
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) navigate('/admin/login', { replace: true })
      })
    return () => {
      cancelled = true
    }
  }, [navigate])

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await adminApi.logout()
    } catch {
      // 即使请求失败也返回登录页，服务端 Session 可能已失效
    } finally {
      setLoggingOut(false)
      navigate('/admin/login', { replace: true })
    }
  }

  if (status === 'checking') {
    return (
      <div className="admin-shell">
        <div className="admin-loading">正在验证登录状态…</div>
      </div>
    )
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link to="/admin" className="admin-brand">
          生活记录
          <span className="admin-brand-sub">管理后台</span>
        </Link>
        <nav className="admin-nav" aria-label="后台导航">
          {NAV_ITEMS.map((item) => {
            const active = item.match(location.pathname)
            const Icon = item.icon
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`admin-nav-link${active ? ' is-active' : ''}`}
              >
                <Icon size={17} />
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="admin-user">
          <span>{username || '管理员'}</span>
          <button
            type="button"
            className="admin-logout"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            <LogOut size={13} />
            {loggingOut ? '退出中…' : '退出'}
          </button>
        </div>
      </aside>

      <header className="admin-topbar">
        <div>
          <p className="admin-topbar-title">生活记录</p>
          <p className="admin-topbar-sub">管理后台</p>
        </div>
        <button type="button" className="admin-logout" onClick={handleLogout} disabled={loggingOut}>
          <LogOut size={13} />
          退出
        </button>
      </header>

      <main className="admin-content">
        <Outlet />
      </main>

      <nav className="admin-bottom-nav" aria-label="手机后台导航">
        {BOTTOM_ITEMS.map((item) => {
          const active = item.match(location.pathname)
          const Icon = item.icon
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`admin-bottom-link${active ? ' is-active' : ''}`}
            >
              <Icon size={19} />
              {item.shortLabel}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
