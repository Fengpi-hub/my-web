import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import VisitorLayout from '../../components/VisitorLayout'
import PhotoLightbox from '../../components/PhotoLightbox'
import { publicApi } from '../../services/publicApi'
import { apiUrl } from '../../services/api'
import { formatFullDate } from '../../utils/format'
import type { PublicDiary } from '../../types'

type LoadState = 'loading' | 'ready' | 'notFound' | 'error'

// 日记详情：完整日期、正文、全部照片与全屏灯箱
export default function DiaryDetail() {
  const { id = '' } = useParams()
  const [diary, setDiary] = useState<PublicDiary | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    publicApi
      .diary(id)
      .then((data) => {
        if (cancelled) return
        setDiary(data)
        setState('ready')
        document.title = `${formatFullDate(data.recordDate)} · 生活记录`
      })
      .catch((error: { code?: string }) => {
        if (cancelled) return
        setState(error.code === 'NOT_FOUND' ? 'notFound' : 'error')
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const lightboxPhotos =
    diary?.photos.map((photo) => ({
      id: photo.id,
      imageUrl: apiUrl(photo.imageUrl),
      diaryId: diary.id,
    })) ?? []

  return (
    <VisitorLayout navAlways>
      <main className="visitor-page detail-page">
        {state === 'loading' && <div className="detail-loading">正在翻开这一页…</div>}

        {state === 'notFound' && (
          <div className="empty-state">
            <p>这篇日记不存在或尚未公开</p>
            <Link to="/diaries" className="pill-button">
              返回日记列表
            </Link>
          </div>
        )}

        {state === 'error' && (
          <div className="empty-state">
            <p>日记加载失败，请稍后再试</p>
            <Link to="/diaries" className="pill-button">
              返回日记列表
            </Link>
          </div>
        )}

        {state === 'ready' && diary && (
          <article className="detail-article">
            <header className="detail-header">
              <p className="detail-date">{formatFullDate(diary.recordDate)}</p>
              {diary.content.trim() && <div className="detail-content">{diary.content}</div>}
            </header>

            {diary.photos.length > 0 && (
              <div className="detail-photos">
                {diary.photos.map((photo, index) => (
                  <button
                    key={photo.id}
                    type="button"
                    className="detail-photo"
                    aria-label={`查看第 ${index + 1} 张照片`}
                    onClick={() => setLightboxIndex(index)}
                  >
                    <img src={apiUrl(photo.imageUrl)} alt="" loading="lazy" decoding="async" />
                  </button>
                ))}
              </div>
            )}

            <footer className="detail-footer">
              <Link to="/diaries" className="detail-back">
                <ArrowLeft size={16} />
                返回列表
              </Link>
            </footer>
          </article>
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
