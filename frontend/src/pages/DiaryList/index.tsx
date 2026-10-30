import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import VisitorLayout from '../../components/VisitorLayout'
import LazyImage from '../../components/LazyImage'
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll'
import { publicApi } from '../../services/publicApi'
import { apiUrl } from '../../services/api'
import { formatFullDate, truncateText } from '../../utils/format'
import type { DiaryListItem } from '../../types'

const PAGE_SIZE = 12

type LoadState = 'loading' | 'ready' | 'error'

// 照片拼贴：1 张大图、2 张并排、3 张一大两小、4 张 2×2、5 张以上自适应
function PhotoCollage({ photos }: { photos: DiaryListItem['photos'] }) {
  if (photos.length === 0) return null

  if (photos.length > 5) {
    const visible = photos.slice(0, 6)
    const restCount = photos.length - visible.length
    return (
      <div className="collage collage-many">
        {visible.map((photo, index) => (
          <div className="collage-cell" key={photo.id}>
            <LazyImage src={apiUrl(photo.thumbnailUrl)} wrapperClassName="collage-media" />
            {index === visible.length - 1 && restCount > 0 && (
              <span className="collage-more">+{restCount}</span>
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={`collage collage-${photos.length}`}>
      {photos.map((photo) => (
        <div className="collage-cell" key={photo.id}>
          <LazyImage src={apiUrl(photo.thumbnailUrl)} wrapperClassName="collage-media" />
        </div>
      ))}
    </div>
  )
}

// 日记列表：桌面两列、手机单列，滚动加载更多
export default function DiaryList() {
  const [items, setItems] = useState<DiaryListItem[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [state, setState] = useState<LoadState>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState(false)

  // 首次加载
  useEffect(() => {
    let cancelled = false
    setState('loading')
    publicApi
      .diaries({ page: 1, limit: PAGE_SIZE })
      .then((data) => {
        if (cancelled) return
        setItems(data.items)
        setPage(1)
        setHasMore(data.pagination.hasMore)
        setState('ready')
      })
      .catch(() => {
        if (cancelled) return
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 加载下一页
  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    setMoreError(false)
    publicApi
      .diaries({ page: page + 1, limit: PAGE_SIZE })
      .then((data) => {
        setItems((prev) => [...prev, ...data.items])
        setPage(data.pagination.page)
        setHasMore(data.pagination.hasMore)
      })
      .catch(() => setMoreError(true))
      .finally(() => setLoadingMore(false))
  }, [loadingMore, hasMore, page])

  const sentinelRef = useInfiniteScroll(loadMore, hasMore && !loadingMore)

  return (
    <VisitorLayout navAlways>
      <main className="visitor-page diary-page">
        <header className="page-heading">
          <h1 className="page-heading-title">日记</h1>
          <p className="page-heading-subtitle">记录生活里的小小闪光</p>
        </header>

        {state === 'loading' && (
          <div className="diary-grid">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="diary-card diary-card-skeleton" />
            ))}
          </div>
        )}

        {state === 'error' && (
          <div className="empty-state">
            <p>日记加载失败</p>
            <button type="button" className="pill-button" onClick={() => window.location.reload()}>
              重新加载
            </button>
          </div>
        )}

        {state === 'ready' && items.length === 0 && (
          <div className="empty-state">
            <p>还没有公开的日记</p>
          </div>
        )}

        {state === 'ready' && items.length > 0 && (
          <>
            <div className="diary-grid">
              {items.map((diary) => (
                <Link key={diary.id} to={`/diaries/${diary.id}`} className="diary-card">
                  <span className="diary-card-date">{formatFullDate(diary.recordDate)}</span>
                  {diary.contentPreview.trim() && (
                    <p className="diary-card-text">{truncateText(diary.contentPreview, 12)}</p>
                  )}
                  <PhotoCollage photos={diary.photos} />
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
              {!hasMore && !moreError && <span className="end-hint">已经看到所有日记啦 ♡</span>}
            </div>
          </>
        )}
      </main>
    </VisitorLayout>
  )
}
