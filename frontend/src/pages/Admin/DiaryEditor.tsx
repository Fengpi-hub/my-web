import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, UploadCloud, X, RefreshCw, Trash2 } from 'lucide-react'
import ConfirmDialog from '../../components/admin/ConfirmDialog'
import {
  adminApi,
  adminPhotoUrl,
  generateThumbnail,
  uploadBinary,
} from '../../services/adminApi'
import { ApiClientError } from '../../services/api'
import { formatDateTime, truncateText } from '../../utils/format'
import type { AdminPhotoItem } from '../../types'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface UploadItem {
  key: string
  name: string
  progress: number
  status: 'uploading' | 'failed'
  error?: string
  file: File
}

const MAX_FILE_BYTES = 10 * 1024 * 1024
const AUTOSAVE_DELAY = 1200

// 将服务端照片转为编辑器使用的管理端地址
function toEditorPhoto(photo: AdminPhotoItem): AdminPhotoItem {
  return {
    ...photo,
    thumbnailUrl: adminPhotoUrl(photo.id, 'thumbnail'),
    imageUrl: adminPhotoUrl(photo.id, 'original'),
  }
}

// 生成上传幂等标识
function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

// 日记编辑：自动保存工作版本、照片上传与排序、发布与提交修改
export default function AdminDiaryEditor() {
  const { id = '' } = useParams()

  const [recordDate, setRecordDate] = useState('')
  const [content, setContent] = useState('')
  const [photos, setPhotos] = useState<AdminPhotoItem[]>([])
  const [diaryStatus, setDiaryStatus] = useState<'draft' | 'published'>('draft')
  const [hasPublishedVersion, setHasPublishedVersion] = useState(false)

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveMessage, setSaveMessage] = useState('')
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [confirmUnpublish, setConfirmUnpublish] = useState(false)

  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  // 自动保存所需的可变引用
  const revisionRef = useRef<{ revisionId: string; version: number } | null>(null)
  const draftExistsRef = useRef(false)
  const dataRef = useRef({ content: '', recordDate: '', photoIds: [] as string[] })
  const dirtyRef = useRef(false)
  const saveErrorRef = useRef(false)
  const pendingRef = useRef(false)
  const inflightRef = useRef<Promise<void> | null>(null)
  const timerRef = useRef<number | null>(null)

  // 同步最新编辑内容到引用
  useEffect(() => {
    dataRef.current = {
      content,
      recordDate,
      photoIds: photos.map((photo) => photo.id),
    }
  }, [content, recordDate, photos])

  // 初始加载
  const loadDiary = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const detail = await adminApi.diary(id)
      const working = detail.draftRevision ?? detail.publishedRevision
      if (!working) {
        throw new ApiClientError('REVISION_NOT_FOUND', '日记版本不存在，请刷新后重试', 404)
      }
      revisionRef.current = { revisionId: working.id, version: working.revisionVersion }
      draftExistsRef.current = detail.draftRevision !== null
      setDiaryStatus(detail.status)
      setHasPublishedVersion(detail.publishedRevision !== null)
      setRecordDate(detail.recordDate)
      setContent(working.content)
      setPhotos(working.photos.map(toEditorPhoto))
      dataRef.current = {
        content: working.content,
        recordDate: detail.recordDate,
        photoIds: working.photos.map((photo) => photo.id),
      }
      dirtyRef.current = false
      saveErrorRef.current = false
      setSaveStatus(detail.draftRevision ? 'saved' : 'idle')
      setLastSaved(working.updatedAt)
      setLoading(false)
    } catch (err) {
      setLoadError(err instanceof ApiClientError ? err.message : '日记加载失败')
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDiary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  // 执行一次保存（自动处理保存期间的新改动）
  const runSave = (): Promise<void> => {
    if (inflightRef.current) {
      pendingRef.current = true
      return inflightRef.current
    }
    if (saveErrorRef.current) return Promise.resolve()

    const task = (async () => {
      let rounds = 0
      do {
        pendingRef.current = false
        setSaveStatus('saving')
        setSaveMessage('')

        try {
          // 已发布但没有工作版本时，先创建工作版本再保存
          if (!draftExistsRef.current) {
            const ensured = await adminApi.ensureDraft(id)
            revisionRef.current = {
              revisionId: ensured.revisionId,
              version: ensured.revisionVersion,
            }
            draftExistsRef.current = true
          }
          const revision = revisionRef.current
          if (!revision) throw new ApiClientError('REVISION_NOT_FOUND', '工作版本尚未准备好', 404)

          const snapshot = {
            content: dataRef.current.content,
            recordDate: dataRef.current.recordDate,
            photoIds: [...dataRef.current.photoIds],
          }
          const result = await adminApi.saveDraft(id, {
            revisionId: revision.revisionId,
            expectedVersion: revision.version,
            content: snapshot.content,
            photoIds: snapshot.photoIds,
            recordDate: snapshot.recordDate,
          })
          revisionRef.current = {
            revisionId: result.revisionId,
            version: result.revisionVersion,
          }
          setLastSaved(result.savedAt)

          const unchanged =
            snapshot.content === dataRef.current.content &&
            snapshot.recordDate === dataRef.current.recordDate &&
            snapshot.photoIds.join('|') === dataRef.current.photoIds.join('|')
          if (unchanged) {
            dirtyRef.current = false
            saveErrorRef.current = false
            setSaveStatus('saved')
          } else {
            pendingRef.current = true
          }
        } catch (err) {
          saveErrorRef.current = true
          setSaveStatus('error')
          setSaveMessage(
            err instanceof ApiClientError ? err.message : '自动保存失败，请检查网络后重试',
          )
          pendingRef.current = false
          break
        }
        rounds += 1
      } while (pendingRef.current && rounds < 3)

      // 仍有未保存内容时，稍后继续
      if (pendingRef.current && !saveErrorRef.current) {
        scheduleSave()
      }
    })()

    inflightRef.current = task
    task.finally(() => {
      if (inflightRef.current === task) inflightRef.current = null
    })
    return task
  }

  const scheduleSave = () => {
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      void runSave()
    }, AUTOSAVE_DELAY)
  }

  // 标记内容已修改并安排自动保存
  const markDirty = () => {
    dirtyRef.current = true
    if (saveErrorRef.current) return
    setSaveStatus('idle')
    scheduleSave()
  }

  // 发布前确保所有改动已保存
  const flushSave = async (): Promise<boolean> => {
    clearTimer()
    if (inflightRef.current) await inflightRef.current
    if (saveErrorRef.current) return false
    if (dirtyRef.current) await runSave()
    return !saveErrorRef.current
  }

  const handleRetrySave = () => {
    saveErrorRef.current = false
    setSaveStatus('idle')
    setSaveMessage('')
    void runSave()
  }

  // ---- 照片上传 ----
  const updateUpload = (key: string, patch: Partial<UploadItem>) => {
    setUploads((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  }

  const uploadOne = async (file: File, key: string) => {
    updateUpload(key, { status: 'uploading', progress: 0, error: undefined })
    try {
      const intent = await adminApi.uploadIntent({
        filename: file.name,
        mimeType: file.type,
        fileSize: file.size,
        idempotencyKey: createIdempotencyKey(),
      })
      await uploadBinary(intent.uploadUrl, file, (ratio) => {
        updateUpload(key, { progress: ratio })
      })

      // 上传缩略图（失败不影响原图，服务端会回退原图）
      try {
        const thumbnail = await generateThumbnail(file)
        if (thumbnail) {
          await uploadBinary(adminPhotoUrl(intent.photoId, 'thumbnail'), thumbnail)
        }
      } catch {
        // 缩略图失败时继续
      }

      setPhotos((prev) => [
        ...prev,
        {
          id: intent.photoId,
          sortOrder: prev.length,
          originalName: file.name,
          mimeType: file.type,
          fileSize: file.size,
          width: null,
          height: null,
          thumbnailUrl: adminPhotoUrl(intent.photoId, 'thumbnail'),
          imageUrl: adminPhotoUrl(intent.photoId, 'original'),
        },
      ])
      setUploads((prev) => prev.filter((item) => item.key !== key))
      markDirty()
    } catch (err) {
      updateUpload(key, {
        status: 'failed',
        error: err instanceof Error ? err.message : '上传失败',
      })
    }
  }

  const handleFiles = (files: FileList | File[]) => {
    const list = Array.from(files).filter((file) => {
      if (!file.type.startsWith('image/')) {
        setActionError(`「${file.name}」不是图片文件`)
        return false
      }
      if (file.size > MAX_FILE_BYTES) {
        setActionError(`「${file.name}」超过 10MB，无法上传`)
        return false
      }
      return true
    })

    // 逐张上传，避免同时占用过多带宽与限流
    for (const file of list) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setUploads((prev) => [
        ...prev,
        { key, name: file.name, progress: 0, status: 'uploading', file },
      ])
      void uploadOne(file, key)
    }
  }

  const retryUpload = (item: UploadItem) => {
    void uploadOne(item.file, item.key)
  }

  const removePhoto = (photoId: string) => {
    setPhotos((prev) => prev.filter((photo) => photo.id !== photoId))
    markDirty()
  }

  // ---- 拖动排序 ----
  const handleDragStart = (event: DragEvent, index: number) => {
    setDragIndex(index)
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (event: DragEvent, index: number) => {
    event.preventDefault()
    setDropIndex(index)
  }

  const handleDrop = (event: DragEvent, index: number) => {
    event.preventDefault()
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null)
      setDropIndex(null)
      return
    }
    setPhotos((prev) => {
      const next = [...prev]
      const [moved] = next.splice(dragIndex, 1)
      next.splice(index, 0, moved)
      return next.map((photo, order) => ({ ...photo, sortOrder: order }))
    })
    setDragIndex(null)
    setDropIndex(null)
    markDirty()
  }

  // ---- 发布 / 取消发布 ----
  const handlePublish = async () => {
    if (publishing) return
    setPublishing(true)
    setActionError('')
    setActionMessage('')
    try {
      const ok = await flushSave()
      if (!ok) {
        setActionError('存在未保存成功的修改，请重试保存后再发布')
        return
      }
      const revision = revisionRef.current
      if (!revision) {
        setActionError('工作版本尚未准备好')
        return
      }
      if (diaryStatus === 'draft') {
        await adminApi.publish(id, revision.revisionId, revision.version)
        setActionMessage('日记已发布')
      } else {
        await adminApi.commit(id, revision.revisionId, revision.version)
        setActionMessage('修改已提交，访客可以看到最新内容')
      }
      await loadDiary()
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : '操作失败，请稍后再试')
    } finally {
      setPublishing(false)
    }
  }

  const handleUnpublish = async () => {
    setConfirmUnpublish(false)
    setPublishing(true)
    setActionError('')
    setActionMessage('')
    try {
      await adminApi.unpublish(id)
      setActionMessage('已取消发布，日记已转为草稿')
      await loadDiary()
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : '操作失败，请稍后再试')
    } finally {
      setPublishing(false)
    }
  }

  const uploading = uploads.some((item) => item.status === 'uploading')

  const saveStatusText = (() => {
    if (saveStatus === 'saving') return '正在保存…'
    if (saveStatus === 'saved') return `已保存${lastSaved ? ` · ${formatDateTime(lastSaved)}` : ''}`
    if (saveStatus === 'error') return saveMessage || '保存失败'
    return '等待保存'
  })()

  if (loading) {
    return <div className="admin-loading">正在打开日记…</div>
  }

  if (loadError) {
    return (
      <div className="admin-empty">
        <p>{loadError}</p>
        <Link to="/admin/diaries" className="admin-btn">
          返回日记列表
        </Link>
      </div>
    )
  }

  return (
    <div>
      <header className="admin-heading">
        <div>
          <h1 className="admin-heading-title">
            编辑日记
            <span className={`status-badge ${diaryStatus === 'published' ? 'is-published' : 'is-draft'}`} style={{ marginLeft: 10 }}>
              {diaryStatus === 'published' ? '已发布' : '草稿'}
            </span>
          </h1>
          <p className="admin-heading-desc">
            {diaryStatus === 'published'
              ? '修改会先保存为工作版本，点击「保存修改」后才对访客可见'
              : '内容会自动保存为草稿，发布后才会出现在访客端'}
          </p>
        </div>
        <div className="admin-heading-actions">
          <Link to="/admin/diaries" className="admin-btn">
            <ArrowLeft size={14} />
            返回列表
          </Link>
          {diaryStatus === 'published' && (
            <button
              type="button"
              className="admin-btn"
              onClick={() => setConfirmUnpublish(true)}
              disabled={publishing}
            >
              取消发布
            </button>
          )}
          <button
            type="button"
            className="admin-btn admin-btn-primary"
            onClick={handlePublish}
            disabled={publishing || uploading}
          >
            {publishing ? '处理中…' : diaryStatus === 'published' ? '保存修改' : '发布日记'}
          </button>
        </div>
      </header>

      {actionMessage && <div className="admin-notice is-success">{actionMessage}</div>}
      {actionError && <div className="admin-notice is-error">{actionError}</div>}
      {saveStatus === 'error' && (
        <div className="admin-notice is-error">
          {saveMessage}
          <button type="button" className="admin-btn admin-btn-sm" onClick={handleRetrySave} style={{ marginLeft: 10 }}>
            重试
          </button>
        </div>
      )}

      <div className="editor-layout">
        <div className="editor-main">
          <div className="editor-toolbar">
            <div className={`editor-save-status is-${saveStatus}`}>
              <span className="editor-save-dot" />
              {saveStatusText}
            </div>
            <div className="diary-admin-meta">
              当前版本 v{revisionRef.current?.version ?? 1}
              {!draftExistsRef.current && hasPublishedVersion ? '（尚未创建工作版本）' : ''}
            </div>
          </div>

          <div className="admin-card">
            <div className="admin-field" style={{ maxWidth: 240 }}>
              <label className="admin-label" htmlFor="record-date">
                记录日期
              </label>
              <input
                id="record-date"
                type="date"
                className="admin-input"
                value={recordDate}
                onChange={(event) => {
                  setRecordDate(event.target.value)
                  markDirty()
                }}
              />
            </div>

            <div className="admin-field" style={{ marginTop: 16 }}>
              <label className="admin-label" htmlFor="diary-content">
                碎碎念
              </label>
              <textarea
                id="diary-content"
                className="admin-textarea"
                rows={10}
                maxLength={20000}
                placeholder="写点什么吧，允许换行，也可以只发照片"
                value={content}
                onChange={(event) => {
                  setContent(event.target.value)
                  markDirty()
                }}
              />
              <span className="diary-admin-meta">{content.length} / 20000</span>
            </div>
          </div>

          <div className="admin-card">
            <div className="diary-admin-title" style={{ marginBottom: 12 }}>
              <span className="admin-label">照片</span>
              <span className="diary-admin-meta">拖动排序，第一张作为时间轴代表照片</span>
            </div>

            <div
              className={`upload-zone${dragOver ? ' is-dragover' : ''}`}
              onDragOver={(event) => {
                event.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragOver(false)
                if (event.dataTransfer.files.length > 0) handleFiles(event.dataTransfer.files)
              }}
              onClick={() => document.getElementById('photo-input')?.click()}
            >
              <UploadCloud size={20} />
              <span>点击选择照片，或拖拽到这里上传（单张最大 10MB）</span>
              <input
                id="photo-input"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => {
                  if (event.target.files) handleFiles(event.target.files)
                  event.target.value = ''
                }}
              />
            </div>

            {uploads.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {uploads.map((item) => (
                  <div className="upload-progress-item" key={item.key}>
                    <span style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.name}
                    </span>
                    {item.status === 'uploading' ? (
                      <>
                        <div className="upload-progress-track">
                          <div className="upload-progress-bar" style={{ width: `${Math.round(item.progress * 100)}%` }} />
                        </div>
                        <span>{Math.round(item.progress * 100)}%</span>
                      </>
                    ) : (
                      <>
                        <span className="upload-failed">{item.error || '上传失败'}</span>
                        <button
                          type="button"
                          className="admin-btn admin-btn-sm"
                          onClick={() => retryUpload(item)}
                        >
                          <RefreshCw size={12} />
                          重试
                        </button>
                        <button
                          type="button"
                          className="admin-btn admin-btn-sm admin-btn-ghost"
                          onClick={() => setUploads((prev) => prev.filter((entry) => entry.key !== item.key))}
                        >
                          移除
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {photos.length > 0 && (
              <div className="photo-editor-grid" style={{ marginTop: 14 }}>
                {photos.map((photo, index) => (
                  <div
                    key={photo.id}
                    className={`photo-editor-item${dragIndex === index ? ' is-dragging' : ''}${
                      dropIndex === index ? ' is-drop-target' : ''
                    }`}
                    draggable
                    onDragStart={(event) => handleDragStart(event, index)}
                    onDragOver={(event) => handleDragOver(event, index)}
                    onDrop={(event) => handleDrop(event, index)}
                    onDragEnd={() => {
                      setDragIndex(null)
                      setDropIndex(null)
                    }}
                  >
                    <img src={photo.thumbnailUrl} alt={photo.originalName} draggable={false} />
                    <button
                      type="button"
                      className="photo-editor-remove"
                      aria-label="移除照片"
                      onClick={(event) => {
                        event.stopPropagation()
                        removePhoto(photo.id)
                      }}
                    >
                      <X size={13} />
                    </button>
                    <span className="photo-editor-index">{index + 1}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="editor-preview">
          <div className="preview-block">
            <p className="preview-block-label">列表卡片预览</p>
            <span className="preview-card-date">{recordDate || '未设置日期'}</span>
            {content.trim() && (
              <p className="preview-card-text">{truncateText(content.trim(), 12)}</p>
            )}
            {photos.length > 0 && (
              <div className="preview-card-photos">
                {photos.slice(0, 4).map((photo) => (
                  <img key={photo.id} src={photo.thumbnailUrl} alt="" />
                ))}
              </div>
            )}
            {photos.length === 0 && content.trim() === '' && (
              <p className="preview-card-text" style={{ color: 'var(--color-text-secondary)' }}>
                还没有内容
              </p>
            )}
          </div>

          <div className="preview-block">
            <p className="preview-block-label">详情预览</p>
            <div className="preview-detail-date">{recordDate || '未设置日期'}</div>
            {content.trim() && <p className="preview-detail-content">{content}</p>}
            {photos.length > 0 && (
              <div className="preview-detail-photos">
                {photos.map((photo) => (
                  <img key={photo.id} src={photo.imageUrl} alt="" loading="lazy" />
                ))}
              </div>
            )}
          </div>

          {diaryStatus === 'published' && (
            <div className="preview-block">
              <p className="preview-block-label">发布提示</p>
              <p className="admin-heading-desc" style={{ margin: 0 }}>
                访客端当前展示的是已发布版本。这里保存的修改不会立即公开，确认无误后请点击「保存修改」。
              </p>
              <div className="settings-actions">
                <Link to={`/diaries/${id}`} target="_blank" className="admin-btn admin-btn-sm">
                  <Trash2 size={0} style={{ display: 'none' }} />
                  查看公开页面
                </Link>
              </div>
            </div>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={confirmUnpublish}
        title="取消发布"
        message="取消发布后，日记将转为草稿，文字与照片都会保留，但访客端将无法再看到。"
        confirmText="取消发布"
        busy={publishing}
        onCancel={() => setConfirmUnpublish(false)}
        onConfirm={handleUnpublish}
      />
    </div>
  )
}
