-- 登录/初始化限流记录（服务端持久化，避免依赖 Worker 实例内存）
CREATE TABLE IF NOT EXISTS login_attempts (
  id           TEXT PRIMARY KEY,
  identifier   TEXT NOT NULL,   -- 例如 ip:1.2.3.4 / user:admin
  attempt_type TEXT NOT NULL CHECK (attempt_type IN ('login', 'setup')),
  success      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_lookup
  ON login_attempts (identifier, attempt_type, success, created_at);
