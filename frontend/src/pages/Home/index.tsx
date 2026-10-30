import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import VisitorLayout from '../../components/VisitorLayout'
import LazyImage from '../../components/LazyImage'
import { useIsMobile } from '../../hooks/useIsMobile'
import { publicApi } from '../../services/publicApi'
import { apiUrl } from '../../services/api'
import type { HomePhoto } from '../../types'

const PHOTO_LIMIT = 12

// 首页：随机照片 CoverFlow（不显示日期与文字）
export default function Home() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [photos, setPhotos] = useState<HomePhoto[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [mobileFocus, setMobileFocus] = useState(-1)

  const load = useCallback(() => {
    setStatus('loading')
    publicApi
      .randomPhotos(PHOTO_LIMIT)
      .then((data) => {
        setPhotos(data.photos)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // 手机端：首次点击聚焦，再次点击进入详情
  const handleCardClick = (photo: HomePhoto, index: number, element: HTMLElement) => {
    if (isMobile) {
      if (mobileFocus !== index) {
        setMobileFocus(index)
        element.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
        return
      }
    }
    navigate(`/diaries/${photo.diaryId}`)
  }

  const handleKeyDown = (photo: HomePhoto) => (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      navigate(`/diaries/${photo.diaryId}`)
    }
  }

  // 桌面端 CoverFlow：根据与当前焦点的距离计算三维变换
  const cardStyle = (index: number) => {
    if (isMobile || hoverIndex === null) return undefined
    const offset = index - hoverIndex
    if (offset === 0) {
      return {
        transform: 'perspective(1000px) translateZ(36px) scale(1.05)',
        zIndex: 20,
        opacity: 1,
      }
    }
    const distance = Math.abs(offset)
    const rotate = offset > 0 ? -26 : 26
    const translateZ = -Math.min(distance, 4) * 34
    return {
      transform: `perspective(1000px) translateZ(${translateZ}px) rotateY(${rotate}deg) scale(0.94)`,
      zIndex: 10 - distance,
      opacity: distance > 3 ? 0.55 : 0.82,
    }
  }

  return (
    <VisitorLayout>
      <main className="home-page">
        {status === 'loading' && (
          <div className="home-grid home-grid-loading" aria-label="正在加载照片">
            {Array.from({ length: 9 }).map((_, index) => (
              <div key={index} className="home-photo-skeleton" />
            ))}
          </div>
        )}

        {status === 'error' && (
          <div className="home-state">
            <p>照片走丢了…</p>
            <button type="button" className="pill-button" onClick={load}>
              重新加载
            </button>
          </div>
        )}

        {status === 'ready' && photos.length === 0 && (
          <div className="home-state">
            <p>还没有已发布的照片</p>
          </div>
        )}

        {status === 'ready' && photos.length > 0 && (
          <div
            className="home-grid"
            onMouseLeave={() => setHoverIndex(null)}
          >
            {photos.map((photo, index) => (
              <div
                key={photo.id}
                className={`home-photo-card${mobileFocus === index ? ' is-focused' : ''}`}
                style={cardStyle(index)}
                role="button"
                tabIndex={0}
                aria-label="查看照片所属日记"
                onMouseEnter={() => {
                  if (!isMobile) setHoverIndex(index)
                }}
                onClick={(event) => handleCardClick(photo, index, event.currentTarget)}
                onKeyDown={handleKeyDown(photo)}
              >
                <LazyImage src={apiUrl(photo.thumbnailUrl)} wrapperClassName="home-photo-media" />
              </div>
            ))}
          </div>
        )}

        {isMobile && (
          <p className="home-mobile-hint">轻点照片聚焦，再点一次查看日记 · 左右滑动切换</p>
        )}
      </main>
    </VisitorLayout>
  )
}
