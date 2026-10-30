-- 初始数据库结构（对应 DATABASE.md V1.1）
-- 说明：
--   1. 外键对日记/版本/照片等重要数据使用 ON DELETE RESTRICT，删除由业务层安全清理。
--   2. diaries 的 draft_revision_id / published_revision_id 与 diary_revisions 形成循环引用，
--      列本身不加外键，由业务层保证版本存在性且所属 diary_id 一致。

-- 日记主表
CREATE TABLE IF NOT EXISTS diaries (
  id                  TEXT PRIMARY KEY,
  record_date         TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  published_revision_id TEXT NULL,
  draft_revision_id   TEXT NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  published_at        TEXT NULL,
  deleted_at          TEXT NULL
);

-- 日记版本表（草稿版本与公开版本分离）
CREATE TABLE IF NOT EXISTS diary_revisions (
  id               TEXT PRIMARY KEY,
  diary_id         TEXT NOT NULL,
  content          TEXT NOT NULL DEFAULT '',
  revision_type    TEXT NOT NULL CHECK (revision_type IN ('working', 'published')),
  revision_version INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  FOREIGN KEY (diary_id) REFERENCES diaries (id) ON DELETE RESTRICT
);

-- 照片元数据表（R2 永远不公开，读取经 Worker 权限校验）
CREATE TABLE IF NOT EXISTS photos (
  id             TEXT PRIMARY KEY,
  r2_key         TEXT NOT NULL UNIQUE,
  thumbnail_key  TEXT NULL UNIQUE,
  original_name  TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  file_size      INTEGER NOT NULL,
  width          INTEGER NULL,
  height         INTEGER NULL,
  upload_status  TEXT NOT NULL CHECK (upload_status IN
    ('pending', 'uploading', 'uploaded', 'failed', 'deleting', 'deleted')),
  uploaded_at    TEXT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT NULL
);

-- 版本与照片关联表（排序与冲突约束）
CREATE TABLE IF NOT EXISTS revision_photos (
  id          TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL,
  photo_id    TEXT NOT NULL,
  sort_order  INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (revision_id) REFERENCES diary_revisions (id) ON DELETE RESTRICT,
  FOREIGN KEY (photo_id) REFERENCES photos (id) ON DELETE RESTRICT
);

-- 管理员账号表
CREATE TABLE IF NOT EXISTS admin_users (
  id                 TEXT PRIMARY KEY,
  username           TEXT NOT NULL UNIQUE,
  password_hash      TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  password_changed_at TEXT NOT NULL
);

-- 管理员会话表（仅存 Token 哈希）
CREATE TABLE IF NOT EXISTS admin_sessions (
  id         TEXT PRIMARY KEY,
  admin_id   TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT NULL,
  FOREIGN KEY (admin_id) REFERENCES admin_users (id) ON DELETE CASCADE
);

-- 操作日志表（审计用途，不随账号删除而失效）
CREATE TABLE IF NOT EXISTS operation_logs (
  id          TEXT PRIMARY KEY,
  admin_id    TEXT NULL,
  action_type TEXT NOT NULL,
  target_id   TEXT NULL,
  summary     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- 全站配置表
CREATE TABLE IF NOT EXISTS site_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 数据导入/导出任务表
CREATE TABLE IF NOT EXISTS data_tasks (
  id             TEXT PRIMARY KEY,
  task_type      TEXT NOT NULL CHECK (task_type IN ('export', 'import')),
  status         TEXT NOT NULL CHECK (status IN
    ('pending', 'running', 'completed', 'failed', 'cancelled')),
  scope          TEXT NULL,
  r2_key         TEXT NULL,
  progress       INTEGER NOT NULL DEFAULT 0,
  result_summary TEXT NULL,
  error_message  TEXT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  expires_at     TEXT NULL
);

-- 照片清理任务表（失败记录与补偿删除）
CREATE TABLE IF NOT EXISTS photo_cleanup_tasks (
  id          TEXT PRIMARY KEY,
  photo_id    TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN
    ('pending', 'running', 'completed', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_diaries_status_published
  ON diaries (status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_diaries_record_date
  ON diaries (record_date DESC);
CREATE INDEX IF NOT EXISTS idx_revisions_diary_type
  ON diary_revisions (diary_id, revision_type);
CREATE INDEX IF NOT EXISTS idx_photos_upload_status
  ON photos (upload_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_revision_photos_unique_photo
  ON revision_photos (revision_id, photo_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_revision_photos_unique_order
  ON revision_photos (revision_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_sessions_token
  ON admin_sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_logs_created
  ON operation_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_tasks_status
  ON data_tasks (status, created_at DESC);

-- 初始站点配置
INSERT OR IGNORE INTO site_settings (key, value, updated_at) VALUES
  ('site_name', '生活记录', '2026-05-03T00:00:00.000Z'),
  ('site_subtitle', '记录每一个平凡又珍贵的日子', '2026-05-03T00:00:00.000Z'),
  ('browser_title', '生活记录', '2026-05-03T00:00:00.000Z');
