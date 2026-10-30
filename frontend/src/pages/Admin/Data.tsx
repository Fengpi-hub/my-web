import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Database, Download, FileArchive, ShieldAlert, Upload } from 'lucide-react'
import { adminApi } from '../../services/adminApi'
import { ApiClientError } from '../../services/api'
import { formatBytes, formatDateTime } from '../../utils/format'
import type { DataTaskResult, ImportPreview } from '../../types'

type ExportScope = 'all' | 'published' | 'draft'
type ImportPhase = 'idle' | 'uploading' | 'previewing' | 'preview' | 'importing' | 'done'

const SCOPE_LABELS: Record<ExportScope, string> = {
  all: '全部日记',
  published: '仅已发布',
  draft: '仅草稿',
}

// 数据管理：ZIP 导出、任务进度、恢复预览与合并恢复
export default function AdminData() {
  const [searchParams] = useSearchParams()
  const [scope, setScope] = useState<ExportScope>('all')
  const [starting, setStarting] = useState(false)
  const [exportTask, setExportTask] = useState<DataTaskResult | null>(null)
  const [exportError, setExportError] = useState('')

  const [file, setFile] = useState<File | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [phase, setPhase] = useState<ImportPhase>('idle')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [importTask, setImportTask] = useState<DataTaskResult | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [importError, setImportError] = useState('')
  const [importNotice, setImportNotice] = useState('')

  const inputRef = useRef<HTMLInputElement | null>(null)
  const pollTimer = useRef<number | null>(null)

  // 轮询当前任务进度
  const pollTask = (taskId: string, kind: 'export' | 'import') => {
    if (pollTimer.current) window.clearTimeout(pollTimer.current)
    const run = async () => {
      try {
        const task = await adminApi.dataTask(taskId)
        if (kind === 'export') setExportTask(task)
        else setImportTask(task)
        if (task.status === 'pending' || task.status === 'running') {
          pollTimer.current = window.setTimeout(run, 1200)
        }
      } catch (err) {
        const message = err instanceof ApiClientError ? err.message : '任务状态查询失败'
        if (kind === 'export') setExportError(message)
        else setImportError(message)
      }
    }
    pollTimer.current = window.setTimeout(run, 600)
  }

  useEffect(() => {
    return () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current)
    }
  }, [])

  // 从日记批量导出跳转过来时，继续跟踪导出任务
  useEffect(() => {
    const taskId = searchParams.get('task')
    if (taskId) {
      setExportError('')
      pollTask(taskId, 'export')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleExport = async () => {
    if (starting) return
    setStarting(true)
    setExportError('')
    setExportTask(null)
    try {
      const result = await adminApi.exportData(scope)
      pollTask(result.taskId, 'export')
    } catch (err) {
      setExportError(err instanceof ApiClientError ? err.message : '创建导出任务失败')
    } finally {
      setStarting(false)
    }
  }

  const handleChooseFile = (selected: File | null) => {
    setFile(selected)
    setPreview(null)
    setImportTask(null)
    setConfirmed(false)
    setUploadProgress(0)
    setImportError('')
    setImportNotice('')
    setPhase('idle')
  }

  const handleUploadAndPreview = async () => {
    if (!file) {
      setImportError('请先选择 ZIP 文件')
      return
    }
    if (file.size > 100 * 1024 * 1024) {
      setImportError('恢复文件不能超过 100MB')
      return
    }
    setImportError('')
    setImportNotice('')
    setPhase('uploading')
    setUploadProgress(0)
    try {
      const uploaded = await adminApi.uploadImportZip(file, (ratio) =>
        setUploadProgress(Math.round(ratio * 100)),
      )
      setPhase('previewing')
      const result = await adminApi.previewImport(uploaded.uploadId)
      setPreview(result)
      setPhase('preview')
    } catch (err) {
      setImportError(err instanceof ApiClientError ? err.message : err instanceof Error ? err.message : '上传或预览失败')
      setPhase('idle')
    }
  }

  const handleConfirmImport = async () => {
    if (!preview || !confirmed) return
    setImportError('')
    setImportNotice('')
    setPhase('importing')
    try {
      const result = await adminApi.confirmImport(preview.previewId)
      setPhase('done')
      setImportNotice('恢复任务已完成，以下为执行结果')
      pollTask(result.taskId, 'import')
    } catch (err) {
      setImportError(err instanceof ApiClientError ? err.message : '恢复失败，请稍后再试')
      setPhase('preview')
    }
  }

  const handleReset = () => {
    if (pollTimer.current) window.clearTimeout(pollTimer.current)
    setFile(null)
    setPreview(null)
    setImportTask(null)
    setConfirmed(false)
    setUploadProgress(0)
    setImportError('')
    setImportNotice('')
    setPhase('idle')
    if (inputRef.current) inputRef.current.value = ''
  }

  const exportBusy =
    starting || (exportTask !== null && (exportTask.status === 'pending' || exportTask.status === 'running'))

  return (
    <div>
      <header className="admin-heading">
        <div>
          <h1 className="admin-heading-title">数据管理</h1>
          <p className="admin-heading-desc">手动导出备份，或从 ZIP 合并恢复</p>
        </div>
      </header>

      <div className="settings-stack">
        <section className="admin-card">
          <h2 className="dashboard-section-title">导出数据</h2>
          <p className="admin-heading-desc">
            导出内容包含日记文字、日期、状态、照片与关联顺序。ZIP 内提供 JSON（用于恢复）与 CSV（便于查看）。
          </p>
          <div className="data-scope-row">
            {(Object.keys(SCOPE_LABELS) as ExportScope[]).map((value) => (
              <label key={value} className={`data-scope${scope === value ? ' is-active' : ''}`}>
                <input
                  type="radio"
                  name="export-scope"
                  value={value}
                  checked={scope === value}
                  onChange={() => setScope(value)}
                  disabled={exportBusy}
                />
                {SCOPE_LABELS[value]}
              </label>
            ))}
          </div>

          {exportError && <div className="admin-notice is-error">{exportError}</div>}

          {exportTask && (
            <div className="data-task">
              <div className="settings-row">
                <span className="stat-hint">导出任务状态</span>
                <strong>
                  {exportTask.status === 'completed'
                    ? '已完成'
                    : exportTask.status === 'failed'
                      ? '失败'
                      : `生成中 ${exportTask.progress}%`}
                </strong>
              </div>
              {exportTask.status !== 'completed' && exportTask.status !== 'failed' && (
                <div className="upload-progress-track">
                  <div className="upload-progress-bar" style={{ width: `${exportTask.progress}%` }} />
                </div>
              )}
              {exportTask.counts && exportTask.status === 'completed' && (
                <p className="stat-hint">
                  共 {exportTask.counts.diaries ?? 0} 篇日记、{exportTask.counts.photos ?? 0} 张照片，文件大小{' '}
                  {formatBytes(exportTask.counts.bytes ?? 0)}
                </p>
              )}
              {exportTask.errorMessage && <div className="admin-notice is-error">{exportTask.errorMessage}</div>}
              {exportTask.downloadAvailable && (
                <div className="settings-actions">
                  <a
                    className="admin-btn admin-btn-primary"
                    href={adminApi.downloadDataUrl(exportTask.taskId)}
                    download
                  >
                    <Download size={15} />
                    下载 ZIP
                  </a>
                  <span className="stat-hint">
                    文件保留 7 天{exportTask.expiresAt ? `，有效期至 ${formatDateTime(exportTask.expiresAt)}` : ''}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="settings-actions">
            <button
              type="button"
              className="admin-btn admin-btn-primary"
              onClick={handleExport}
              disabled={exportBusy}
            >
              <FileArchive size={15} />
              {exportBusy ? '正在导出…' : `导出${SCOPE_LABELS[scope]}`}
            </button>
          </div>
        </section>

        <section className="admin-card">
          <h2 className="dashboard-section-title">恢复数据</h2>
          <div className="admin-notice is-warning">
            <ShieldAlert size={15} />
            恢复采用合并方式：相同编号的记录会被跳过，不会覆盖现有数据。高风险操作前请先导出备份。
          </div>

          <div className="admin-field">
            <label className="admin-label" htmlFor="import-file">
              选择 ZIP 备份文件（最大 100MB）
            </label>
            <input
              id="import-file"
              ref={inputRef}
              className="admin-input"
              type="file"
              accept="application/zip,.zip"
              onChange={(event) => handleChooseFile(event.target.files?.[0] ?? null)}
              disabled={phase === 'uploading' || phase === 'previewing' || phase === 'importing'}
            />
          </div>

          {phase === 'uploading' && (
            <div className="data-task">
              <div className="settings-row">
                <span className="stat-hint">上传中</span>
                <strong>{uploadProgress}%</strong>
              </div>
              <div className="upload-progress-track">
                <div className="upload-progress-bar" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}

          {importError && <div className="admin-notice is-error">{importError}</div>}
          {importNotice && <div className="admin-notice is-success">{importNotice}</div>}

          {preview && (
            <div className="data-preview">
              <h3 className="dashboard-section-title">恢复预览</h3>
              <div className="data-summary-grid">
                <div className="data-summary-item">
                  <span>可新增</span>
                  <strong>{preview.newRecords}</strong>
                </div>
                <div className="data-summary-item">
                  <span>已存在（跳过）</span>
                  <strong>{preview.existingRecords}</strong>
                </div>
                <div className="data-summary-item">
                  <span>冲突</span>
                  <strong>{preview.conflicts}</strong>
                </div>
                <div className="data-summary-item">
                  <span>无效记录</span>
                  <strong>{preview.invalidRecords}</strong>
                </div>
                <div className="data-summary-item">
                  <span>缺失照片</span>
                  <strong>{preview.missingPhotos}</strong>
                </div>
              </div>

              {(preview.conflicts > 0 || preview.invalidRecords > 0 || preview.missingPhotos > 0) && (
                <div className="admin-notice is-warning">
                  存在冲突、无效记录或缺失照片，恢复时会跳过这些内容，并在结果中如实报告。
                </div>
              )}

              {phase === 'preview' || phase === 'importing' ? (
                <>
                  <label className="data-confirm">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    我已了解合并恢复不会覆盖已有记录，并已完成必要的备份
                  </label>
                  <div className="settings-actions">
                    <button
                      type="button"
                      className="admin-btn admin-btn-primary"
                      onClick={handleConfirmImport}
                      disabled={!confirmed || phase === 'importing'}
                    >
                      <Database size={15} />
                      {phase === 'importing' ? '正在恢复…' : '开始合并恢复'}
                    </button>
                    <button type="button" className="admin-btn" onClick={handleReset} disabled={phase === 'importing'}>
                      取消
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          )}

          {importTask && (
            <div className="data-task">
              <h3 className="dashboard-section-title">恢复结果</h3>
              {importTask.status === 'pending' || importTask.status === 'running' ? (
                <p className="stat-hint">正在处理，请稍候…</p>
              ) : importTask.status === 'failed' ? (
                <div className="admin-notice is-error">{importTask.errorMessage ?? '恢复失败'}</div>
              ) : (
                <div className="data-summary-grid">
                  <div className="data-summary-item">
                    <span>新增日记</span>
                    <strong>{importTask.counts?.imported ?? 0}</strong>
                  </div>
                  <div className="data-summary-item">
                    <span>跳过</span>
                    <strong>{importTask.counts?.skipped ?? 0}</strong>
                  </div>
                  <div className="data-summary-item">
                    <span>失败</span>
                    <strong>{importTask.counts?.errors ?? 0}</strong>
                  </div>
                  <div className="data-summary-item">
                    <span>新增照片</span>
                    <strong>{importTask.counts?.photosImported ?? 0}</strong>
                  </div>
                  <div className="data-summary-item">
                    <span>缺失照片</span>
                    <strong>{importTask.counts?.missingPhotos ?? 0}</strong>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="settings-actions">
            {phase === 'idle' && (
              <button
                type="button"
                className="admin-btn"
                onClick={handleUploadAndPreview}
                disabled={!file}
              >
                <Upload size={15} />
                上传并预览
              </button>
            )}
            {(phase === 'previewing' || phase === 'done') && (
              <button type="button" className="admin-btn" onClick={handleReset}>
                重新选择文件
              </button>
            )}
          </div>

          {file && phase === 'idle' && (
            <p className="stat-hint">
              已选择：{file.name}（{formatBytes(file.size)}）
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
