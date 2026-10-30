import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import VisitorLayout from '../../components/VisitorLayout'
import PhotoLightbox from '../../components/PhotoLightbox'
import PeriodFilter from '../../components/PeriodFilter'
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll'
import { publicApi } from '../../services/publicApi'
import { apiUrl } from '../../services/api'
import type { PeriodSummary, PublicPhotoSummary } from '../../types'

const PAGE_SIZE = 24

type LoadState = 'loading' | 'ready' | 'error'

// 照片墙单张图片：先加载缩略图，进入视口后再加载清晰大图
function WallPhoto({ photo, onOpen }: { photo: PublicPhotoSummary; onOpen: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)
  const [fullLoaded, setFullLoaded] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '400px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen()
    }
  }

  return (
    <div
      ref={ref}
      className="wall-item"
      role="button"
      tabIndex={0}
      aria-label="查看照片"
      onClick={onOpen}
      onKeyDown={handleKeyDown}
    >
      <img
        className="wall-thumb"
        src={apiUrl(photo.thumbnailUrl)}
        alt=""
        loading="lazy"
        decoding="async"
      />
      {visible && (
        <img
          className={`wall-full${fullLoaded ? ' is-loaded' : ''}`}
          src={apiUrl(photo.imageUrl)}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setFullLoaded(true)}
        />
      )}
    </div>
  )
}

// 照片墙：瀑布流、年月筛选、游标加载、共用灯箱
export default function PhotoWall() {
  const [periods, setPeriods] = useState<PeriodSummary | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [month, setMonth] = useState<number | null>(null)
  const [items, setItems] = useState<PublicPhotoSummary[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [state, setState] = useState<LoadState>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  // 加载可用年月，默认选中最新有照片的年份、月份全部
  useEffect(() => {
    let cancelled = false
    publicApi
      .photoPeriods()
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

  // 筛选条件变化时重置并加载第一页
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
      .photos({ limit: PAGE_SIZE, year, month, cursor: null })
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

  // 加载更多
  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    setMoreError(false)
    publicApi
      .photos({ limit: PAGE_SIZE, year, month, cursor })
      .then((data) => {
        setItems((prev) => [...prev, ...data.items])
        setCursor(data.nextCursor)
        setHasMore(data.hasMore)
      })
      .catch(() => setMoreError(true))
      .finally(() => setLoadingMore(false))
  }, [loadingMore, hasMore, year, month, cursor])

  const sentinelRef = useInfiniteScroll(loadMore, hasMore && !loadingMore)

  const handleFilterChange = (nextYear: number | null, nextMonth: number | null) => {
    setYear(nextYear)
    setMonth(nextMonth)
  }

  const lightboxPhotos = items.map((photo) => ({
    id: photo.id,
    imageUrl: apiUrl(photo.imageUrl),
    diaryId: photo.diaryId,
  }))

  return (
    <VisitorLayout navAlways>
      <main className="visitor-page wall-page">
        <header className="page-heading">
          <h1 className="page-heading-title">照片墙</h1>
          <p className="page-heading-subtitle">把喜欢的瞬间都贴在这里</p>
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
          <div className="wall-grid">
            {Array.from({ length: 12 }).map((_, index) => (
              <div
                key={index}
                className="wall-skeleton"
                style={{ aspectRatio: index % 3 === 0 ? '3 / 4' : '1 / 1' }}
              />
            ))}
          </div>
        )}

        {state === 'error' && (
          <div className="empty-state">
            <p>照片加载失败</p>
            <button type="button" className="pill-button" onClick={() => window.location.reload()}>
              重新加载
            </button>
          </div>
        )}

        {state === 'ready' && periods?.years.length === 0 && (
          <div className="empty-state">
            <p>还没有公开的照片</p>
          </div>
        )}

        {state === 'ready' && periods && periods.years.length > 0 && items.length === 0 && (
          <div className="empty-state">
            <p>这个时间段还没有照片</p>
          </div>
        )}

        {state === 'ready' && items.length > 0 && (
          <>
            <div className="wall-grid">
              {items.map((photo, index) => (
                <WallPhoto key={photo.id} photo={photo} onOpen={() => setLightboxIndex(index)} />
              ))}
            </div>

            <div ref={sentinelRef} className="load-sentinel">
              {loadingMore && <span className="loading-dots">正在加载…</span>}
              {moreError && (
                <button type="button" className="pill-button" onClick={loadMore}>
                  加载失败，点击重试
                </button>
              )}
              {!hasMore && !moreError && <span className="end-hint">已经看到所有照片啦 ♡</span>}
            </div>
          </>
        )}
      </main>

      {lightboxIndex !== null && lightboxPhotos.length > 0 && (
        <PhotoLightbox
          photos={lightboxPhotos}
          index={lightboxIndex}
          onChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </VisitorLayout>
  )
}
