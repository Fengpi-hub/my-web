# 个人生活记录网站

以照片为主角、以简短文字为辅助的个人生活记录网站。访客端展示已发布内容，管理后台负责日记与照片管理。

## 技术栈

| 模块     | 技术               |
| -------- | ------------------ |
| 前端     | React + TypeScript + Vite + CSS |
| 后端     | Cloudflare Workers |
| 数据库   | Cloudflare D1      |
| 图片存储 | Cloudflare R2      |
| 部署     | Cloudflare Pages / Workers + Wrangler |

## 文档索引

| 文档 | 作用 |
| ---- | ---- |
| `个人生活记录网站 — 完整开发文档.md` | 项目开发总规范 |
| `AI_RULES.md — AI 编程协作规则.md` | AI 编程行为约束 |
| `DATABASE.md — 数据库设计规范.md` | 数据库结构与一致性 |
| `API 接口设计规范.md` | 接口契约 |
| `网站安全设计规范.md` | 安全设计 |
| `部署与上线规范.md` | 部署规范 |
| `测试与质量验收规范.md` | 测试与验收 |

## 目录结构

```
├── frontend/   # React 前端
├── worker/     # Cloudflare Worker 后端（含 migrations）
├── *.md        # 项目文档（保留在根目录）
└── .gitignore
```

## 本地开发

前置要求：Node.js 18+、Cloudflare 账户（仅部署时需要）。

```bash
# 1. 安装依赖
cd worker && npm install
cd ../frontend && npm install

# 2. 准备本地 Secret（复制后填入初始管理员凭据）
cd worker
copy .dev.vars.example .dev.vars   # Windows
# cp .dev.vars.example .dev.vars   # macOS / Linux

# 3. 初始化本地 D1（首次或迁移更新后执行）
npx wrangler d1 migrations apply life-diary-local-db --local

# 4. 启动后端（默认 http://localhost:8787）
npm run dev

# 5. 另开终端启动前端（Vite 已把 /api 代理到 8787）
cd frontend && npm run dev
```

首次访问后台需调用 `POST /api/admin/setup` 并携带 `ADMIN_SETUP_TOKEN` 完成管理员初始化（请求体为 `{ username, password }`），之后通过 `/admin` 登录。

## 构建与检查

```bash
cd worker && npm run typecheck
cd frontend && npm run typecheck && npm run build
```

## 部署准备（不包含真实资源创建）

1. 按 `部署与上线规范.md` 确认 Preview / Production 独立资源，禁止复用旧项目资源（`cyc`、`cyc-images`、`SITE_DATA`）。
2. `worker/wrangler.jsonc` 已提供 `preview` 与 `production` 环境占位，需替换真实的 `database_id` 与 R2 Bucket 名称。
3. 依次执行数据库 Migration（先 `--local` 验证，再 `--env preview --remote`，最后生产），确认结构后再部署 Worker。
4. 通过 `wrangler secret put ADMIN_SETUP_TOKEN --env <环境>` 配置独立 Secret；前端仅使用公开的 `VITE_API_BASE`。
5. 前端部署到 Cloudflare Pages：Build command `npm run build`，输出目录 `frontend/dist`，并确认 SPA 路由回退到 `index.html`。