import { useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import '../styles/public.css'

const NAV_ITEMS = [
  { to: '/', label: '首页', end: true },
  { to: '/diaries', label: '日记', end: false },
  { to: '/photos', label: '照片墙', end: false },
  { to: '/timeline', label: '时间轴', end: false },
]

interface VisitorLayoutProps {
  children: ReactNode
  // 是否始终显示顶部导航（详情页等需要固定导航的场景）
  navAlways?: boolean
}

// 访客端布局：桌面顶部导航默认隐藏、靠近顶部时显示；手机使用小型菜单按钮
export default function VisitorLayout({ children, navAlways = false }: VisitorLayoutProps) {
  const location = useLocation()
  const [navVisible, setNavVisible] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  // 判断当前路由是否为激活项
  const isActive = (to: string, end: boolean) => {
    if (end) return location.pathname === to
    return location.pathname === to || location.pathname.startsWith(`${to}/`)
  }

  const closeMenu = () => setMenuOpen(false)

  return (
    <div className="visitor-shell">
      {/* 顶部感应区：鼠标移入后显示桌面导航 */}
      {!navAlways && (
        <div
          className="nav-hover-zone"
          onMouseEnter={() => setNavVisible(true)}
          aria-hidden="true"
        />
      )}

      {/* 桌面端顶部导航 */}
      <header
        className={`visitor-nav${navVisible || navAlways ? ' is-visible' : ''}`}
        onMouseLeave={() => setNavVisible(false)}
      >
        <div className="visitor-nav-inner">
          <Link to="/" className="visitor-brand" onClick={closeMenu}>
            生活记录
          </Link>
          <nav className="visitor-nav-links" aria-label="主导航">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`visitor-nav-link${isActive(item.to, item.end) ? ' is-active' : ''}`}
                onClick={closeMenu}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/* 手机端菜单按钮 */}
      <button
        type="button"
        className={`visitor-menu-button${menuOpen ? ' is-open' : ''}`}
        aria-label={menuOpen ? '关闭导航' : '打开导航'}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        {menuOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* 手机端展开菜单 */}
      {menuOpen && (
        <div className="visitor-mobile-menu">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`visitor-mobile-link${isActive(item.to, item.end) ? ' is-active' : ''}`}
              onClick={closeMenu}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}

      {children}
    </div>
  )
}
