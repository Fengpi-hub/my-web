// 操作日志类型的中文展示文案
const ACTION_LABELS: Record<string, string> = {
  admin_setup: '初始化管理员',
  login_success: '登录成功',
  login_failed: '登录失败',
  logout: '退出登录',
  change_password: '修改密码',
  settings_update: '更新设置',
  diary_create: '创建日记',
  diary_save_draft: '保存草稿',
  diary_create_draft: '创建工作版本',
  diary_publish: '发布日记',
  diary_commit: '提交修改',
  diary_unpublish: '取消发布',
  diary_delete: '删除日记',
  diary_duplicate: '复制日记',
  photo_upload: '上传照片',
  photo_thumbnail: '上传缩略图',
  photo_reorder: '调整照片顺序',
  photo_delete: '删除照片',
  data_export: '导出数据',
  data_import: '恢复数据',
}

// 日志类型下拉选项
export const LOG_ACTION_OPTIONS = Object.entries(ACTION_LABELS).map(([value, label]) => ({
  value,
  label,
}))

export function getActionLabel(actionType: string): string {
  return ACTION_LABELS[actionType] ?? actionType
}
