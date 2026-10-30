# API 接口设计规范

**项目：个人生活记录网站**

**文档版本：V1.1**

**文档状态：审查修订版**

## 一、API 设计目标

API 是前端与 Cloudflare Worker 后端之间的通信接口。

必须满足：

1. 访客端只能访问已发布内容。
2. 管理接口必须验证管理员身份。
3. 日记草稿与公开版本严格隔离。
4. 照片关联和排序必须以日记版本为单位。
5. 发布操作必须保证公开版本切换的一致性。
6. 照片上传和删除必须支持失败处理。
7. 支持自动保存、并发编辑检测和安全重试。
8. 数据导出和恢复使用异步任务。
9. 所有 API 必须返回统一格式。
10. API 不得绕过数据库、安全和数据一致性规则。

## 二、基础约定

### 2.1 API 基础路径

统一使用：

```
/api
```

公开接口：

```
/api/public/*
```

管理员接口：

```
/api/admin/*
```

认证接口：

```
/api/admin/auth/*
```

照片访问接口：

```
/api/media/*
```

数据管理接口：

```
/api/admin/data/*
```

### 2.2 请求格式

JSON 请求：

```
Content-Type: application/json
```

文件上传：

```
Content-Type: multipart/form-data
```

所有接口使用 HTTPS。

### 2.3 统一成功响应

```
{
  "success": true,
  "data": {},
  "message": "操作成功"
}
```

### 2.4 统一错误响应

```
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数不正确"
  }
}
```

不得向访客暴露数据库内部错误、文件系统路径、Secret 或认证细节。

### 2.5 HTTP 状态码

| 状态码 | 含义                  |
| ------ | --------------------- |
| 200    | 请求成功              |
| 201    | 创建成功              |
| 202    | 任务已接受，正在处理  |
| 204    | 操作成功，无响应内容  |
| 400    | 请求参数错误          |
| 401    | 未登录或 Session 无效 |
| 403    | 无权限                |
| 404    | 资源不存在            |
| 409    | 数据冲突或版本冲突    |
| 413    | 请求体过大            |
| 415    | 不支持的文件类型      |
| 422    | 数据验证失败          |
| 429    | 请求过于频繁          |
| 500    | 服务器内部错误        |
| 503    | 服务暂时不可用        |

## 三、身份认证规范

### 3.1 管理员认证方式

使用服务端 Session。

登录成功后由 Worker 设置安全 Cookie。

建议 Cookie：

```
HttpOnly
Secure
SameSite=Lax
Path=/
```

如果最终使用跨站独立 API 域名，必须重新评估 SameSite 和 CORS 配置，并制定 CSRF 防护方案。

Session Token：

- 使用安全随机数生成。
- 数据库只保存 Token 哈希。
- 服务端验证有效期和撤销状态。
- 修改密码后撤销该管理员所有旧 Session。

### 3.2 CSRF 防护

所有使用 Cookie 认证的状态修改接口必须具备 CSRF 防护。

至少执行：

- 验证请求来源 Origin。
- 检查 Fetch Metadata 等适用请求头。
- 对不满足可信来源要求的跨站状态修改请求拒绝处理。
- 必要时增加 CSRF Token。

不能仅依靠 CORS 防止 CSRF。

GET、HEAD 等只读请求不得产生业务数据修改。

### 3.3 首个管理员初始化

不提供公开管理员注册接口。

建议使用一次性初始化接口：

```
POST /api/admin/setup
```

要求：

- 仅在系统尚无管理员时允许执行。
- 必须提供由服务器端配置的初始化凭据。
- 初始化凭据不得出现在前端代码或公开环境变量中。
- 初始化成功后立即关闭入口。
- 重复请求不得创建第二个管理员。
- 初始化接口必须限流。
- 初始化成功后记录操作日志。

如果初始化已经完成，该接口应拒绝请求。

管理员忘记密码时，不提供公开密码重置接口，使用受控的服务器端恢复流程。

### 3.4 登录

```
POST /api/admin/auth/login
```

请求：

```
{
  "username": "admin",
  "password": "password"
}
```

成功：

```
{
  "success": true,
  "data": {
    "admin": {
      "id": "uuid",
      "username": "admin"
    }
  }
}
```

服务端设置 Session Cookie。

失败：

- 返回统一错误。
- 不透露用户名是否存在。
- 记录必要的失败信息。
- 实施登录限流。
- 不记录明文密码。

### 3.5 获取登录状态

```
GET /api/admin/auth/me
```

返回：

```
{
  "success": true,
  "data": {
    "authenticated": true,
    "admin": {
      "id": "uuid",
      "username": "admin"
    }
  }
}
```

### 3.6 退出登录

```
POST /api/admin/auth/logout
```

操作：

- 撤销当前 Session。
- 清除浏览器 Cookie。
- 返回成功状态。

### 3.7 修改密码

```
POST /api/admin/auth/change-password
```

请求：

```
{
  "currentPassword": "old-password",
  "newPassword": "new-password"
}
```

操作：

1. 验证当前密码。
2. 验证新密码强度。
3. 更新密码哈希。
4. 撤销所有旧 Session。
5. 写入操作日志。
6. 要求管理员重新登录。

## 四、公开 API

公开 API 只能读取已发布日记和已公开照片。

任何公开接口不得返回：

- 草稿文字。
- 草稿版本 ID。
- 未发布照片 ID。
- 管理员信息。
- Session 信息。
- 内部存储路径。

### 4.1 首页随机照片

```
GET /api/public/home/random-photos
```

参数：

| 参数    | 说明         |
| ------- | ------------ |
| `limit` | 返回照片数量 |

建议默认返回 12 张，具体数量由前端布局决定。

返回：

```
{
  "success": true,
  "data": {
    "photos": [
      {
        "id": "photo-uuid",
        "diaryId": "diary-uuid",
        "thumbnailUrl": "/api/media/photo-uuid/thumbnail",
        "imageUrl": "/api/media/photo-uuid/original"
      }
    ]
  }
}
```

规则：

- 只从当前已发布版本中选取照片。
- 不允许重复返回同一照片。
- 不包含没有公开版本的日记。
- 每次随机请求可以返回新的照片组合。
- 前端切换 CoverFlow 焦点时不得重复请求随机接口。

### 4.2 日记列表

```
GET /api/public/diaries
```

参数：

| 参数    | 说明     |
| ------- | -------- |
| `page`  | 页码     |
| `limit` | 每页数量 |
| `year`  | 可选年份 |
| `month` | 可选月份 |

返回：

```
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "diary-uuid",
        "recordDate": "2026-10-30",
        "contentPreview": "今天的生活碎碎念",
        "photos": [
          {
            "id": "photo-uuid",
            "thumbnailUrl": "/api/media/photo-uuid/thumbnail"
          }
        ],
        "publishedAt": "2026-10-30T08:00:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 12,
      "hasMore": true
    }
  }
}
```

规则：

- 只读取当前公开版本。
- 最新日记优先。
- 照片按公开版本中的 `sort_order` 排列。
- 内容预览由前端或服务端按照产品规范截取。
- 无文字时返回空内容，前端隐藏文字区域。
- 草稿不得出现在列表中。

### 4.3 日记详情

```
GET /api/public/diaries/:id
```

返回：

```
{
  "success": true,
  "data": {
    "id": "diary-uuid",
    "recordDate": "2026-10-30",
    "content": "完整日记内容",
    "photos": [
      {
        "id": "photo-uuid",
        "sortOrder": 0,
        "imageUrl": "/api/media/photo-uuid/original"
      }
    ],
    "publishedAt": "2026-10-30T08:00:00Z"
  }
}
```

规则：

- 只能读取已发布版本。
- 日记不存在、已删除或未发布时，不得返回内容。
- 照片按版本关联顺序返回。
- 不得通过参数指定任意工作版本。

### 4.4 照片墙

```
GET /api/public/photos
```

参数：

| 参数     | 说明     |
| -------- | -------- |
| `cursor` | 分页游标 |
| `limit`  | 每批数量 |
| `year`   | 年份     |
| `month`  | 月份     |

返回：

```
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "photo-uuid",
        "diaryId": "diary-uuid",
        "imageUrl": "/api/media/photo-uuid/original",
        "thumbnailUrl": "/api/media/photo-uuid/thumbnail",
        "uploadedAt": "2026-10-30T08:00:00Z"
      }
    ],
    "nextCursor": "next-cursor",
    "hasMore": true
  }
}
```

规则：

- 只返回至少被一个当前公开版本引用的照片。
- 同一张照片在照片墙中只显示一次。
- 按照片上传时间从新到旧排列。
- 同一上传时间必须使用稳定的第二排序键，例如照片 ID。
- 每张照片必须有可访问的所属公开日记入口。
- 分页采用稳定游标，避免重复或遗漏。
- 筛选条件变化时前端重新开始分页。

### 4.5 时间轴

```
GET /api/public/timeline
```

参数：

| 参数     | 说明     |
| -------- | -------- |
| `year`   | 年份     |
| `month`  | 月份     |
| `cursor` | 分页游标 |
| `limit`  | 每批数量 |

返回：

```
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "diary-uuid",
        "recordDate": "2026-10-30",
        "content": "完整碎碎念",
        "representativePhoto": {
          "id": "photo-uuid",
          "thumbnailUrl": "/api/media/photo-uuid/thumbnail"
        }
      }
    ],
    "nextCursor": "next-cursor",
    "hasMore": true
  }
}
```

规则：

- 按日记发布时间从新到旧。
- 同一天多篇日记按发布时间倒序。
- 代表照片为当前公开版本中排序第一的照片。
- 无照片时返回 `null`。
- 无文字时返回空字符串。
- 不根据照片 EXIF 时间排序。

### 4.6 时间轴年月筛选

```
GET /api/public/timeline/periods
```

返回：

```
{
  "success": true,
  "data": {
    "years": [
      {
        "year": 2026,
        "months": [10, 9, 8]
      }
    ]
  }
}
```

规则：

- 只返回存在已发布日记的年月。
- 不返回草稿对应的年月。

## 五、照片访问 API

### 5.1 公开照片访问

```
GET /api/media/:photoId/original
GET /api/media/:photoId/thumbnail
```

权限：

- 必须检查照片是否被当前公开版本引用。
- 未发布版本引用的照片不能通过公开接口访问。
- 不允许通过猜测照片 UUID 绕过权限检查。
- 不允许直接公开 R2 Bucket。
- 支持合理的缓存策略。
- 私有照片不得被公共缓存错误缓存。

### 5.2 管理照片访问

```
GET /api/admin/photos/:photoId/original
GET /api/admin/photos/:photoId/thumbnail
```

要求：

- 必须验证管理员 Session。
- 仅允许查看符合后台权限规则的照片。
- 不得通过照片 ID 直接绕过管理员身份验证。

### 5.3 图片缓存

公开照片可以设置适当的浏览器缓存和 Cloudflare 缓存策略。

发布状态发生变化时，必须保证不再公开的照片不会继续通过旧缓存被无期限访问。

对于高敏感的管理照片，使用私有缓存策略。

## 六、管理 API

以下接口全部要求有效管理员 Session，并执行 CSRF 防护。

### 6.1 Dashboard

```
GET /api/admin/dashboard
```

返回：

```
{
  "success": true,
  "data": {
    "publishedDiaries": 10,
    "draftDiaries": 3,
    "totalPhotos": 50,
    "storageUsed": 104857600,
    "recentActivities": []
  }
}
```

存储统计必须明确统计范围，不能把 R2 使用量和数据库大小混为一谈。

### 6.2 日记管理列表

```
GET /api/admin/diaries
```

参数：

| 参数        | 说明               |
| ----------- | ------------------ |
| `page`      | 页码               |
| `limit`     | 每页数量           |
| `keyword`   | 搜索文字           |
| `year`      | 年份               |
| `month`     | 月份               |
| `status`    | 全部、草稿、已发布 |
| `sort`      | 日期或发布时间     |
| `hasPhotos` | 是否有照片         |

返回必须包含管理端需要的状态信息，但不得把管理数据混入公开 API。

### 6.3 获取日记管理详情

```
GET /api/admin/diaries/:id
```

返回：

```
{
  "success": true,
  "data": {
    "id": "diary-uuid",
    "status": "published",
    "recordDate": "2026-10-30",
    "publishedRevision": {
      "id": "revision-1",
      "content": "已发布内容",
      "photos": []
    },
    "draftRevision": {
      "id": "revision-2",
      "content": "正在编辑的内容",
      "photos": []
    }
  }
}
```

不存在工作版本时，`draftRevision` 为 `null`。

该接口只供管理员使用。

### 6.4 创建日记

```
POST /api/admin/diaries
```

请求：

```
{
  "recordDate": "2026-10-30"
}
```

服务端：

1. 创建日记主体。
2. 创建工作版本。
3. 设置 `draft_revision_id`。
4. 设置状态为 `draft`。

返回日记 ID 和工作版本 ID。

### 6.5 自动保存工作版本

```
PUT /api/admin/diaries/:id/draft
```

请求：

```
{
  "revisionId": "revision-uuid",
  "expectedVersion": 3,
  "content": "日记内容",
  "photoIds": [
    "photo-1",
    "photo-2",
    "photo-3"
  ]
}
```

规则：

- 只能修改当前工作版本。
- `revisionId` 必须属于指定日记。
- `expectedVersion` 必须匹配数据库当前版本号。
- 照片必须存在且状态为 `uploaded`。
- 照片顺序按照数组顺序保存。
- 不允许重复照片 ID。
- 不允许修改当前公开版本。
- 保存成功后递增版本号。
- 并发冲突返回 409。

成功响应：

```
{
  "success": true,
  "data": {
    "revisionId": "revision-uuid",
    "revisionVersion": 4,
    "savedAt": "2026-10-30T08:00:00Z"
  }
}
```

失败时不能让前端显示已保存。

### 6.6 创建工作版本

```
POST /api/admin/diaries/:id/draft
```

仅当不存在工作版本且日记已有公开版本时使用。

操作：

- 复制公开版本文字。
- 复制公开版本照片关联。
- 复制照片顺序。
- 创建新的 `working` 版本。
- 更新 `draft_revision_id`。

如果工作版本已经存在，返回现有版本，不重复创建。

### 6.7 发布日记

```
POST /api/admin/diaries/:id/publish
```

请求：

```
{
  "revisionId": "revision-uuid",
  "expectedVersion": 4
}
```

要求：

- 版本必须属于该日记。
- 版本必须是当前工作版本。
- 照片全部上传成功。
- 照片关联必须合法。
- 检查版本号，防止并发修改。
- 更新公开版本指针和状态必须在同一个 D1 事务中完成。

成功后：

- 工作版本转为公开版本。
- `published_revision_id` 指向新版本。
- `draft_revision_id` 清空。
- `status` 设置为 `published`。

### 6.8 保存已发布日记修改

```
POST /api/admin/diaries/:id/commit
```

请求：

```
{
  "revisionId": "revision-uuid",
  "expectedVersion": 4
}
```

只允许提交当前工作版本。

服务端验证成功后：

1. 将工作版本转换为公开版本。
2. 切换公开版本指针。
3. 清空工作版本指针。
4. 更新发布时间和更新时间。
5. 写入操作记录。

旧公开版本不得直接修改。

### 6.9 取消发布

```
POST /api/admin/diaries/:id/unpublish
```

操作：

- 清空公开版本指针。
- 状态切换为 `draft`。
- 保留可继续编辑的工作版本。
- 访客端立即停止展示。
- 写入操作记录。

如果当前不存在工作版本，必须先创建一个基于原公开版本的工作版本，再完成取消发布。

### 6.10 删除日记

```
DELETE /api/admin/diaries/:id
```

默认执行软删除。

请求参数可以包含：

```
{
  "deleteUnreferencedPhotos": false
}
```

规则：

- 必须验证管理员权限。
- 删除前检查日记及版本关系。
- 默认不物理删除照片。
- 只有确认不再被任何有效版本引用时才允许清理。
- 执行高风险删除前必须二次确认。

### 6.11 复制日记

```
POST /api/admin/diaries/:id/duplicate
```

规则：

- 创建全新的日记 ID。
- 创建新的工作版本。
- 复制文字和照片关联。
- 保留照片顺序。
- 不复制公开状态。
- 新日记默认是草稿。

### 6.12 批量操作

```
POST /api/admin/diaries/batch
```

请求：

```
{
  "action": "publish",
  "ids": [
    "diary-1",
    "diary-2"
  ]
}
```

允许操作：

- `publish`
- `unpublish`
- `delete`
- `export`

必须返回逐条结果，不能只返回一个模糊的整体成功状态。

## 七、照片管理 API

### 7.1 创建上传任务

```
POST /api/admin/photos/upload-intents
```

请求：

```
{
  "filename": "photo.jpg",
  "mimeType": "image/jpeg",
  "fileSize": 2048000,
  "idempotencyKey": "unique-request-key"
}
```

服务端：

1. 验证管理员权限。
2. 验证文件大小限制。
3. 验证允许的文件类型。
4. 检查幂等标识。
5. 创建照片记录。
6. 生成安全的照片 UUID 和 R2 Key。
7. 返回上传所需信息。

返回：

```
{
  "success": true,
  "data": {
    "photoId": "photo-uuid",
    "uploadUrl": "/api/admin/photos/photo-uuid/upload",
    "status": "pending"
  }
}
```

不得把 R2 Secret 或 Bucket 凭据返回给浏览器。

### 7.2 上传照片

```
PUT /api/admin/photos/:photoId/upload
```

使用二进制请求体或明确约定的 multipart 上传方式。

要求：

- 验证 Session 和上传任务归属。
- 检查文件真实 MIME 和签名。
- 检查文件大小。
- 检查图片能否正常解码。
- 不信任用户提供的扩展名。
- 上传成功后再更新照片状态。
- 支持安全重试。
- 不允许重复请求生成重复照片记录。

单张图片最大 10MB。

### 7.3 获取照片列表

```
GET /api/admin/photos
```

参数：

- `page`
- `limit`
- `keyword`
- `status`
- `diaryId`
- `unassociated`

返回照片管理所需的元数据、状态、文件大小、上传时间及所属日记信息。

### 7.4 获取照片详情

```
GET /api/admin/photos/:photoId
```

返回：

- 原始文件名。
- 文件大小。
- 格式。
- 图片宽高。
- 上传时间。
- 上传状态。
- 所有关联的日记及版本信息。

### 7.5 删除照片

```
DELETE /api/admin/photos/:photoId
```

要求：

- 检查所有版本的引用。
- 被公开版本引用时禁止直接删除。
- 被工作版本引用时先要求用户移除关联。
- 只有确认没有有效引用时才创建清理任务。
- R2 删除成功后才完成最终清理。
- 失败时返回可追踪的任务状态。

### 7.6 照片排序

```
PUT /api/admin/diaries/:id/draft/photos/order
```

请求：

```
{
  "revisionId": "revision-uuid",
  "expectedVersion": 4,
  "photoIds": [
    "photo-3",
    "photo-1",
    "photo-2"
  ]
}
```

规则：

- 只能修改工作版本。
- 必须验证所有照片归属和上传状态。
- 顺序由数组位置决定。
- 更新成功后递增版本号。
- 不允许影响公开版本。

## 八、网站设置 API

### 8.1 获取设置

```
GET /api/public/settings
```

只返回允许公开的配置：

- 网站名称。
- 网站副标题。
- 浏览器标题。

### 8.2 修改设置

```
PUT /api/admin/settings
```

请求：

```
{
  "siteName": "我的生活记录",
  "siteSubtitle": "记录生活中的每一个瞬间",
  "browserTitle": "我的生活记录"
}
```

要求：

- 仅管理员可修改。
- 验证字段长度。
- 不允许修改认证密钥。
- 写入操作记录。

## 九、数据导出 API

### 9.1 创建导出任务

```
POST /api/admin/data/export
```

请求：

```
{
  "scope": "all"
}
```

允许：

- `all`
- `published`
- `draft`

返回：

```
{
  "success": true,
  "data": {
    "taskId": "task-uuid",
    "status": "pending"
  }
}
```

### 9.2 查询导出任务

```
GET /api/admin/data/tasks/:taskId
```

返回：

```
{
  "success": true,
  "data": {
    "taskId": "task-uuid",
    "status": "running",
    "progress": 60,
    "downloadAvailable": false
  }
}
```

### 9.3 下载导出文件

```
GET /api/admin/data/tasks/:taskId/download
```

规则：

- 必须验证管理员 Session。
- 只能下载当前管理员有权访问的任务文件。
- 文件必须已经生成完成。
- 临时文件必须设置过期时间。
- 下载地址不得长期公开。
- 不得泄露 R2 内部 Key。

导出任务应分批执行，不能假设 Worker 单次请求可以无限处理大量照片。

## 十、数据恢复 API

### 10.1 上传恢复文件

```
POST /api/admin/data/import/upload
```

要求：

- 仅管理员可操作。
- 限制 ZIP 文件大小。
- 验证文件类型。
- 不允许路径穿越。
- 限制解压后总大小和文件数量。
- 临时文件不得公开访问。

### 10.2 创建恢复预览

```
POST /api/admin/data/import/preview
```

请求：

```
{
  "uploadId": "upload-uuid"
}
```

返回：

```
{
  "success": true,
  "data": {
    "previewId": "preview-uuid",
    "newRecords": 10,
    "existingRecords": 5,
    "conflicts": 1,
    "invalidRecords": 0,
    "missingPhotos": 0
  }
}
```

预览阶段不得修改正式数据。

### 10.3 确认恢复

```
POST /api/admin/data/import/confirm
```

请求：

```
{
  "previewId": "preview-uuid",
  "confirm": true
}
```

操作：

- 再次验证预览有效性。
- 检查数据是否发生变化。
- 按批次合并。
- 不覆盖已有冲突记录。
- 保持版本指针和照片关系合法。
- 返回任务 ID。

### 10.4 查询恢复任务

```
GET /api/admin/data/tasks/:taskId
```

返回任务进度、成功数量、跳过数量、冲突数量和错误数量。

恢复过程中发生部分失败时，必须如实报告，不得假装全部成功。

## 十一、操作记录 API

### 11.1 获取操作记录

```
GET /api/admin/logs
```

参数：

- `page`
- `limit`
- `actionType`
- `startDate`
- `endDate`

返回操作时间、操作类型、对象 ID 和简短摘要。

不返回密码、Session Token 或日记全文。

### 11.2 清理过期日志

由服务端维护清理机制。

保留最近三个月的操作记录。

不得开放普通访客访问日志的接口。

## 十二、错误代码

| 错误代码               | 说明             |
| ---------------------- | ---------------- |
| `UNAUTHORIZED`         | 未登录           |
| `FORBIDDEN`            | 无权限           |
| `NOT_FOUND`            | 资源不存在       |
| `VALIDATION_ERROR`     | 参数错误         |
| `REVISION_CONFLICT`    | 版本冲突         |
| `REVISION_NOT_FOUND`   | 版本不存在       |
| `PHOTO_NOT_UPLOADED`   | 照片尚未上传成功 |
| `PHOTO_IN_USE`         | 照片仍被引用     |
| `PHOTO_UPLOAD_FAILED`  | 上传失败         |
| `PHOTO_DELETE_FAILED`  | 删除失败         |
| `IDEMPOTENCY_CONFLICT` | 幂等请求冲突     |
| `DIARY_NOT_PUBLISHED`  | 日记尚未发布     |
| `IMPORT_CONFLICT`      | 恢复数据冲突     |
| `IMPORT_INVALID`       | 恢复文件无效     |
| `TASK_NOT_READY`       | 任务尚未完成     |
| `RATE_LIMITED`         | 请求过于频繁     |
| `INTERNAL_ERROR`       | 内部错误         |

错误消息必须适合前端展示，不应包含内部敏感信息。

## 十三、接口安全规则

1. 所有管理接口必须验证管理员 Session。
2. 所有 Cookie 认证的状态修改接口必须进行 CSRF 防护。
3. 所有数据库查询必须使用参数绑定。
4. 所有照片访问必须检查引用关系和公开状态。
5. 公开接口不能接受任意版本 ID 作为读取目标。
6. 草稿内容不得通过公开 API 暴露。
7. 上传文件必须验证真实格式。
8. 所有高风险操作必须进行服务端二次验证。
9. 所有批量操作必须逐项返回结果。
10. 所有敏感接口必须实施限流。
11. 不允许前端直接访问 D1 或 R2。
12. 不允许把 Secret 暴露给浏览器。
13. 错误响应不得泄露数据库结构和内部路径。

## 十四、数据一致性规则

### 14.1 D1 事务

以下操作应在适当的 D1 事务中完成：

- 创建日记和工作版本。
- 创建工作版本并复制照片关联。
- 保存工作版本文字和照片关联。
- 发布版本并切换公开指针。
- 取消发布。
- 修改照片排序。

事务必须确保指针、版本状态和关联数据一致。

### 14.2 D1 与 R2

D1 与 R2 不共享事务。

因此：

- 上传使用任务和状态管理。
- 删除使用清理任务。
- 失败操作可以重试。
- 孤立文件可以被识别。
- 不允许仅根据前端返回的成功状态认定文件已经保存。

### 14.3 幂等性

对于上传任务、数据恢复确认等可能重复提交的操作，应使用幂等标识或任务 ID。

相同幂等标识的重复请求不得重复创建业务数据。

幂等记录必须绑定用户、操作类型和请求内容摘要，避免同一个标识被用于不同请求。

### 14.4 并发控制

工作版本更新必须携带版本号。

版本号不一致时返回 409。

前端应重新获取最新版本，提示用户处理冲突，不得静默覆盖。

## 十五、前端 API 代码组织建议

建议前端统一封装请求：

```
frontend/src/services/
├── api.ts
├── auth.ts
├── diaries.ts
├── photos.ts
├── timeline.ts
├── settings.ts
└── data-management.ts
```

要求：

- 统一处理错误。
- 统一处理 Cookie 凭据。
- 统一处理 401 登录失效。
- 不在组件中重复编写请求逻辑。
- 上传接口单独处理进度和重试。
- 自动保存接口处理版本冲突。
- 数据任务接口提供进度查询。

## 十六、Worker 后端代码组织建议

```
worker/src/
├── routes/
│   ├── public/
│   ├── admin/
│   ├── auth/
│   ├── media/
│   └── data/
│
├── middleware/
│   ├── auth.ts
│   ├── csrf.ts
│   ├── rate-limit.ts
│   └── error-handler.ts
│
├── services/
│   ├── diary-service.ts
│   ├── revision-service.ts
│   ├── photo-service.ts
│   ├── storage-service.ts
│   ├── export-service.ts
│   ├── import-service.ts
│   └── log-service.ts
│
├── repositories/
│   ├── diary-repository.ts
│   ├── revision-repository.ts
│   └── photo-repository.ts
│
└── utils/
    ├── response.ts
    ├── validation.ts
    └── id.ts
```

目录结构仅作为建议。

如果现有项目已有合理架构，必须先检查并沿用，不得为了匹配示例而推倒重建。

## 十七、API 验收清单

### 公开接口

- 

  首页只返回已发布照片。

- 

  日记列表只返回公开版本。

- 

  日记详情不能读取草稿。

- 

  照片墙不会重复显示同一照片。

- 

  时间轴代表照片顺序正确。

- 

  年月筛选不暴露草稿信息。

- 

  已取消发布的内容无法访问。

### 管理接口

- 

  管理员初始化只能成功执行一次。

- 

  登录失败有限流。

- 

  Session 过期后不能继续访问。

- 

  修改密码后旧 Session 失效。

- 

  所有管理操作都经过权限验证。

- 

  草稿自动保存不会改变公开内容。

- 

  并发保存能识别版本冲突。

- 

  发布操作正确切换公开版本。

- 

  复制日记生成独立草稿。

### 照片接口

- 

  上传验证真实图片格式。

- 

  重复上传请求不会重复创建照片。

- 

  上传失败不会显示成功。

- 

  未发布照片不能公开访问。

- 

  被引用照片不能直接删除。

- 

  删除失败可以重试。

- 

  照片排序只修改工作版本。

### 数据管理接口

- 

  ZIP 导出可以查询任务进度。

- 

  下载必须通过管理员验证。

- 

  恢复预览不修改正式数据。

- 

  恢复确认可以防止重复提交。

- 

  冲突记录不会被静默覆盖。

- 

  部分失败能够准确报告。

### 安全与稳定性

- 

  Cookie 配置正确。

- 

  状态修改接口有 CSRF 防护。

- 

  API 不泄露内部错误。

- 

  SQL 使用参数绑定。

- 

  敏感接口有限流。

- 

  公开和管理图片权限隔离。

## 十八、最终设计原则

1. API 必须遵循数据库 V1.1 的版本模型。
2. 所有公开接口只能读取公开版本。
3. 所有管理操作必须经过身份认证。
4. 照片关联和排序必须基于版本。
5. 发布必须通过安全的版本指针切换。
6. 上传和删除必须支持失败补偿。
7. 大型数据导出和恢复必须使用任务式处理。
8. 所有重要写入操作必须考虑幂等性和并发。
9. API 不得绕过数据库和安全规范。
10. 所有接口必须通过测试后才能视为完成。

**API 接口设计规范 V1.1**

**本版本以数据库设计规范 V1.1 为基础。**