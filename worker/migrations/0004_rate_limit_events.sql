-- 通用限流事件记录（上传频率等），与登录限流表分开
CREATE TABLE IF NOT EXISTS rate_limit_events (
  id          TEXT PRIMARY KEY,
  identifier  TEXT NOT NULL,
  action_type TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_lookup
  ON rate_limit_events (identifier, action_type, created_at DESC);
