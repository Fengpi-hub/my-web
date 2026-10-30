import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUp } from 'lucide-react'
import VisitorLayout from '../../components/VisitorLayout'
import LazyImage from '../../components/LazyImage'
import PeriodFilter from '../../components/PeriodFilter'
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll'
import { publicApi } from '../../services/publicApi'
import { formatFullDate } from '../../utils/format'
import type { PeriodSummary, TimelineItem } from '../../types'

const PAGE_SIZE = 20

type LoadState = 'loading' | 'ready' | 'error'

// 时间轴：纵向时间线、年月筛选、游标加载更多
export default function Timeline() {
  const [periods, setPeriods] = useState<PeriodSummary | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [month, setMonth] = useState<number | null>(null)
  const [items, setItems] = useState<TimelineItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [state, setState] = useState<LoadState>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState(false)
  const [showBackTop, setShowBackTop] = useState(false)

  // 加载可用年月
  useEffect(() => {
    let cancelled = false
    publicApi
      .timelinePeriods()
      .then((data) => {
        if (cancelled) return
        setPeriods(data)
        setYear(data.years[0]?.year ?? null)
        setMonth(null)
      })
      .catch(() => {
        if (cancelled) return
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 筛选变化时重置列表
  useEffect(() => {
    if (periods === null) return
    if (periods.years.length === 0) {
      setItems([])
      setState('ready')
      return
    }

    let cancelled = false
    setState('loading')
    setItems([])
    setCursor(null)
    setHasMore(false)
    setMoreError(false)

    publicApi
      .timeline({ limit: PAGE_SIZE, year, month, cursor: null })
      .then((data) => {
        if (cancelled) return
        setItems(data.items)
        setCursor(data.nextCursor)
        setHasMore(data.hasMore)
        setState('ready')
      })
      .catch(() => {
        if (cancelled) return
        setState('error')
      })

    return () => {
      cancelled = true
    }
  }, [periods, year, month])

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    setMoreError(false)
    publicApi
      .timeline({ limit: PAGE_SIZE, year, month, cursor })
      .then((data) => {
        setItems((prev) => [...prev, ...data.items])
        setCursor(data.nextCursor)
        setHasMore(data.hasMore)
      })
      .catch(() => setMoreError(true))
      .finally(() => setLoadingMore(false))
  }, [loadingMore, hasMore, year, month, cursor])

  const sentinelRef = useInfiniteScroll(loadMore, hasMore && !loadingMore)

  // 返回顶部按钮：滚动一定距离后出现
  useEffect(() => {
    const handler = () => setShowBackTop(window.scrollY > 400)
    window.addEventListener('scroll', handler, { passive: true })
    handler()
    return () => window.removeEventListener('scroll', handler)
  }, [])

  // 切换筛选后自动定位到顶部
  const handleFilterChange = (nextYear: number | null, nextMonth: number | null) => {
    setYear(nextYear)
    setMonth(nextMonth)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <VisitorLayout navAlways>
      <main className="visitor-page timeline-page">
        <header className="page-heading">
          <h1 className="page-heading-title">时间轴</h1>
          <p className="page-heading-subtitle">沿着时间，慢慢往前翻</p>
        </header>

        {periods && periods.years.length > 0 && (
          <PeriodFilter
            years={periods.years}
            activeYear={year}
            activeMonth={month}
            onChange={handleFilterChange}
          />
        )}

        {state === 'loading' && (
          <div className="timeline-loading">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="timeline-card timeline-card-skeleton" />
            ))}
          </div>
        )}

        {state === 'error' && (
          <div className="empty-state">
            <p>时间轴加载失败</p>
            <button type="button" className="pill-button" onClick={() => window.location.reload()}>
              重新加载
            </button>
          </div>
        )}

        {state === 'ready' && periods?.years.length === 0 && (
          <div className="empty-state">
            <p>还没有公开的日记</p>
          </div>
        )}

        {state === 'ready' && periods && periods.years.length > 0 && items.length === 0 && (
          <div className="empty-state">
            <p>这个时间段还没有记录</p>
          </div>
        )}

        {state === 'ready' && items.length > 0 && (
          <>
            <div className="timeline">
              {items.map((item, index) => (
                <Link
                  key={item.id}
                  to={`/diaries/${item.id}`}
                  className={`timeline-item ${index % 2 === 0 ? 'is-left' : 'is-right'}`}
                >
                  <article className="timeline-card">
                    <div className="timeline-card-head">
                      <span className="timeline-dot" aria-hidden="true" />
                      <p className="timeline-date">{formatFullDate(item.recordDate)}</p>
                    </div>
                    {item.representativePhoto && (
                      <LazyImage
                        src={item.representativePhoto.thumbnailUrl}
                        wrapperClassName="timeline-photo"
                      />
                    )}
                    {item.content.trim() && <p className="timeline-content">{item.content}</p>}
                  </article>
                </Link>
              ))}
            </div>

            <div ref={sentinelRef} className="load-sentinel">
              {loadingMore && <span className="loading-dots">正在加载…</span>}
              {moreError && (
                <button type="button" className="pill-button" onClick={loadMore}>
                  加载失败，点击重试
                </button>
              )}
              {!hasMore && !moreError && <span className="end-hint">已经看到所有记录啦 ♡</span>}
            </div>
          </>
        )}
      </main>

      {showBackTop && (
        <button
          type="button"
          className="back-to-top"
          aria-label="返回顶部"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <ArrowUp size={20} />
        </button>
      )}
    </VisitorLayout>
  )
}
