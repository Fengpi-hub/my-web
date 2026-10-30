-- 照片上传幂等记录（对应 API 7.1 幂等标识要求）
CREATE TABLE IF NOT EXISTS photo_upload_intents (
  idempotency_key TEXT PRIMARY KEY,
  photo_id        TEXT NOT NULL,
  admin_id        TEXT NOT NULL,
  filename        TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  file_size       INTEGER NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_photo_upload_intents_created
  ON photo_upload_intents (created_at DESC);
