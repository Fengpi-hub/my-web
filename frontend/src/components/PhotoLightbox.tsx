import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, X, BookOpen, Maximize2 } from 'lucide-react'

export interface LightboxPhoto {
  id: string
  imageUrl: string
  diaryId?: string | null
}

interface PhotoLightboxProps {
  photos: LightboxPhoto[]
  index: number
  onChange: (index: number) => void
  onClose: () => void
}

// 共用全屏灯箱：键盘左右切换、Esc 关闭、手机滑动切换、点击缩放查看细节
export default function PhotoLightbox({ photos, index, onChange, onClose }: PhotoLightboxProps) {
  const current = photos[index]
  const [zoomed, setZoomed] = useState(false)
  const [dragging, setDragging] = useState(false)
  // 记录触摸起点，用于判断滑动方向
  const touchStartX = useRef<number | null>(null)
  const pointerStartX = useRef<number | null>(null)

  // 切换照片时重置缩放状态
  useEffect(() => {
    setZoomed(false)
  }, [index])

  // 打开灯箱时锁定页面滚动，关闭后恢复滚动位置
  useEffect(() => {
    const scrollY = window.scrollY
    const body = document.body
    const original = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    }

    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'
    body.style.overflow = 'hidden'

    return () => {
      body.style.position = original.position
      body.style.top = original.top
      body.style.width = original.width
      body.style.overflow = original.overflow
      window.scrollTo(0, scrollY)
    }
  }, [])

  const goPrev = useCallback(() => {
    if (index <= 0) return
    onChange(index - 1)
  }, [index, onChange])

  const goNext = useCallback(() => {
    if (index >= photos.length - 1) return
    onChange(index + 1)
  }, [index, photos.length, onChange])

  // 键盘操作：左右切换、Esc 关闭
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goPrev()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        goNext()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [goPrev, goNext, onClose])

  // 触摸滑动切换（缩放状态下不切换）
  const handleTouchStart = (event: React.TouchEvent) => {
    if (zoomed) return
    touchStartX.current = event.touches[0]?.clientX ?? null
  }

  const handleTouchEnd = (event: React.TouchEvent) => {
    if (zoomed || touchStartX.current === null) return
    const endX = event.changedTouches[0]?.clientX ?? touchStartX.current
    const delta = endX - touchStartX.current
    touchStartX.current = null
    if (Math.abs(delta) < 50) return
    if (delta > 0) {
      goPrev()
    } else {
      goNext()
    }
  }

  // 指针拖动（缩放后平移查看细节，未缩放时作为滑动切换的补充）
  const handlePointerDown = (event: React.PointerEvent) => {
    if (event.pointerType === 'mouse') return
    if (zoomed) return
    pointerStartX.current = event.clientX
    setDragging(true)
  }

  const handlePointerUp = (event: React.PointerEvent) => {
    if (pointerStartX.current === null) return
    const delta = event.clientX - pointerStartX.current
    pointerStartX.current = null
    setDragging(false)
    if (Math.abs(delta) < 50) return
    if (delta > 0) {
      goPrev()
    } else {
      goNext()
    }
  }

  if (!current) return null

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="照片查看"
      onClick={onClose}
    >
      <div className="lightbox-top" onClick={(event) => event.stopPropagation()}>
        <span className="lightbox-counter">
          {index + 1}/{photos.length}
        </span>
        <button type="button" className="lightbox-close" aria-label="关闭" onClick={onClose}>
          <X size={22} />
        </button>
      </div>

      {index > 0 && (
        <button
          type="button"
          className="lightbox-arrow lightbox-arrow-left"
          aria-label="上一张"
          onClick={(event) => {
            event.stopPropagation()
            goPrev()
          }}
        >
          <ChevronLeft size={26} />
        </button>
      )}

      {index < photos.length - 1 && (
        <button
          type="button"
          className="lightbox-arrow lightbox-arrow-right"
          aria-label="下一张"
          onClick={(event) => {
            event.stopPropagation()
            goNext()
          }}
        >
          <ChevronRight size={26} />
        </button>
      )}

      <div
        className="lightbox-stage"
        onClick={(event) => event.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        <img
          key={current.id}
          src={current.imageUrl}
          alt=""
          className={`lightbox-image${zoomed ? ' is-zoomed' : ''}${dragging ? ' is-dragging' : ''}`}
          draggable={false}
          onClick={() => setZoomed((value) => !value)}
        />
      </div>

      <div className="lightbox-bottom" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="lightbox-zoom-hint" onClick={() => setZoomed((value) => !value)}>
          <Maximize2 size={15} />
          {zoomed ? '点击图片缩小' : '点击图片查看细节'}
        </button>
        {current.diaryId && (
          <Link to={`/diaries/${current.diaryId}`} className="lightbox-diary-link" onClick={onClose}>
            <BookOpen size={15} />
            查看所属日记
          </Link>
        )}
      </div>
    </div>
  )
}
