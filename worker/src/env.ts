// Worker 运行时绑定与配置
export interface Env {
  DB: D1Database
  IMAGES_BUCKET: R2Bucket
  // 管理员首次初始化的服务器端凭据（通过 wrangler secret 配置）
  ADMIN_SETUP_TOKEN: string
  // 可选：期望的可信来源 Origin（仅开发代理等特殊场景需要）
  APP_ORIGIN?: string
}
