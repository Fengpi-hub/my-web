// 业务错误码与 HTTP 状态映射（与 API 设计规范一致）
export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'REVISION_CONFLICT'
  | 'REVISION_NOT_FOUND'
  | 'PHOTO_NOT_UPLOADED'
  | 'PHOTO_IN_USE'
  | 'PHOTO_UPLOAD_FAILED'
  | 'PHOTO_DELETE_FAILED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'DIARY_NOT_PUBLISHED'
  | 'IMPORT_CONFLICT'
  | 'IMPORT_INVALID'
  | 'TASK_NOT_READY'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'

export const ERROR_STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  REVISION_CONFLICT: 409,
  REVISION_NOT_FOUND: 404,
  PHOTO_NOT_UPLOADED: 409,
  PHOTO_IN_USE: 409,
  PHOTO_UPLOAD_FAILED: 500,
  PHOTO_DELETE_FAILED: 500,
  IDEMPOTENCY_CONFLICT: 409,
  DIARY_NOT_PUBLISHED: 409,
  IMPORT_CONFLICT: 409,
  IMPORT_INVALID: 422,
  TASK_NOT_READY: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number

  constructor(code: ErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = status ?? ERROR_STATUS[code]
  }
}
