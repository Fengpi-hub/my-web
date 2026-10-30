# 数据库设计规范

**项目：个人生活记录网站**

**文档版本：V1.1**

**文档状态：审查修订版**

## 一、设计目标

数据库负责保存网站的日记、照片、管理员、登录会话、网站设置和操作记录。

设计必须满足以下要求：

1. 草稿与已发布内容严格隔离。
2. 编辑已发布日记时，不影响当前公开内容。
3. 每个日记版本拥有独立的照片关联和排序。
4. 同一张照片允许被多个日记版本引用。
5. 删除日记或照片时不得误删仍被引用的文件。
6. 支持日记自动保存、发布、取消发布和版本恢复。
7. 支持 ZIP 数据导出和合并恢复。
8. 数据库与 R2 文件操作出现异常时，能够追踪、重试和补偿。
9. 所有公开查询只能读取已发布版本。
10. 数据库设计必须兼容 Cloudflare D1 和 SQLite。

## 二、数据库技术约定

- 数据库：Cloudflare D1。
- 数据库引擎：SQLite。
- 主键：UUID。
- 时间：统一使用 UTC ISO 8601 格式。
- 日记日期：`YYYY-MM-DD`。
- 布尔值：使用 `INTEGER`，0 表示否，1 表示是。
- 数据库访问：仅允许通过 Cloudflare Worker。
- 所有 SQL 查询必须使用参数绑定。
- 数据库结构变更必须通过 Migration 管理。

### 2.1 命名规范

- 表名使用小写复数形式。
- 字段使用 `snake_case`。
- 主键统一使用 `id`。
- 外键字段使用对应实体名称加 `_id`。
- 时间字段使用 `_at` 结尾。

### 2.2 外键约束

数据库连接初始化时必须启用外键约束。

Migration 必须明确外键行为，不能依赖默认行为。

对于日记版本和照片等重要数据，删除规则优先采用限制删除，再由业务层执行安全清理。

不得使用简单的级联删除，绕过照片引用检查。

## 三、核心数据模型

数据库核心表：

| 表名                  | 作用                 |
| --------------------- | -------------------- |
| `diaries`             | 日记主体             |
| `diary_revisions`     | 日记内容版本         |
| `photos`              | 照片文件信息         |
| `revision_photos`     | 日记版本与照片的关联 |
| `admin_users`         | 管理员账号           |
| `admin_sessions`      | 管理员登录会话       |
| `operation_logs`      | 管理操作记录         |
| `site_settings`       | 网站配置             |
| `data_tasks`          | 导出与恢复任务       |
| `photo_cleanup_tasks` | 照片清理任务         |

核心关系：

```
diaries
   |
   |---- published_revision_id
   |
   |---- draft_revision_id
   |
   v
diary_revisions
   |
   v
revision_photos
   |
   v
photos
```

一篇日记可以有一个公开版本和一个待编辑版本。

每个版本独立管理自己的照片和照片顺序。

## 四、diaries：日记主体表

保存日记的基本信息及版本指针。

| 字段                    | 类型             | 说明                   |
| ----------------------- | ---------------- | ---------------------- |
| `id`                    | TEXT PRIMARY KEY | 日记 UUID              |
| `record_date`           | TEXT NOT NULL    | 日记记录日期           |
| `status`                | TEXT NOT NULL    | `draft` 或 `published` |
| `published_revision_id` | TEXT NULL        | 当前公开版本 ID        |
| `draft_revision_id`     | TEXT NULL        | 当前编辑版本 ID        |
| `created_at`            | TEXT NOT NULL    | 创建时间               |
| `updated_at`            | TEXT NOT NULL    | 最近更新时间           |
| `published_at`          | TEXT NULL        | 最近发布时间           |
| `deleted_at`            | TEXT NULL        | 软删除时间             |

### 4.1 字段规则

`status`：

- `draft`：尚无公开版本。
- `published`：存在当前公开版本。

注意：已发布日记允许同时存在待编辑草稿。

因此：

```
status = published
published_revision_id = 公开版本
draft_revision_id = 待提交版本
```

这表示日记仍然公开，但管理员有尚未提交的修改。

### 4.2 版本指针规则

- `published_revision_id` 只能指向该日记自己的有效版本。
- `draft_revision_id` 只能指向该日记自己的工作版本。
- 两个指针不能指向同一个版本。
- 指针更新必须通过事务完成。
- 不能只修改 `status` 而不维护版本指针。

数据库外键负责约束版本存在性，业务层还必须检查版本所属的 `diary_id` 是否一致。

### 4.3 软删除

删除日记时先执行软删除。

软删除后：

- 访客端不再展示。
- 管理端默认隐藏或归档显示。
- 暂不物理删除日记版本。
- 不立即删除照片文件。
- 保留数据用于安全清理和必要的恢复处理。

只有经过明确的永久删除流程，才允许物理清理。

## 五、diary_revisions：日记版本表

保存每篇日记的文字内容及版本信息。

| 字段            | 类型                     | 说明                     |
| --------------- | ------------------------ | ------------------------ |
| `id`            | TEXT PRIMARY KEY         | 版本 UUID                |
| `diary_id`      | TEXT NOT NULL            | 所属日记 ID              |
| `content`       | TEXT NOT NULL DEFAULT '' | 完整文字                 |
| `revision_type` | TEXT NOT NULL            | `working` 或 `published` |
| `created_at`    | TEXT NOT NULL            | 创建时间                 |
| `updated_at`    | TEXT NOT NULL            | 修改时间                 |

### 5.1 版本类型

`working`：

- 工作版本。
- 用于草稿和自动保存。
- 不允许访客端读取。
- 可以修改文字和照片关联。

`published`：

- 已发布版本。
- 代表一份已经提交的公开内容快照。
- 发布后不得直接修改。
- 修改内容必须创建新的工作版本。

### 5.2 版本不可变原则

发布版本必须视为不可变快照。

如果管理员修改已发布日记：

1. 创建新的工作版本。
2. 复制当前公开版本的文字。
3. 复制当前公开版本的照片关联。
4. 复制原有照片顺序。
5. 管理员只修改新的工作版本。
6. 访客端继续读取原公开版本。
7. 用户点击保存修改后，才切换公开版本指针。

历史发布版本可以保留，用于审计、恢复和数据导出。

### 5.3 版本清理

不能因为某个版本不再公开，就立即删除该版本。

删除版本前必须确认：

- 没有任何日记指针引用它。
- 没有其他业务任务正在使用它。
- 不存在尚未完成的恢复操作。
- 版本关联照片的引用情况已经确认。

## 六、photos：照片表

保存照片文件及其元数据。

| 字段            | 类型                 | 说明          |
| --------------- | -------------------- | ------------- |
| `id`            | TEXT PRIMARY KEY     | 照片 UUID     |
| `r2_key`        | TEXT NOT NULL UNIQUE | 原图 R2 Key   |
| `thumbnail_key` | TEXT NULL UNIQUE     | 缩略图 R2 Key |
| `original_name` | TEXT NOT NULL        | 原始文件名    |
| `mime_type`     | TEXT NOT NULL        | 实际文件类型  |
| `file_size`     | INTEGER NOT NULL     | 文件大小      |
| `width`         | INTEGER NULL         | 图片宽度      |
| `height`        | INTEGER NULL         | 图片高度      |
| `upload_status` | TEXT NOT NULL        | 上传状态      |
| `uploaded_at`   | TEXT NULL            | 上传完成时间  |
| `created_at`    | TEXT NOT NULL        | 创建时间      |
| `updated_at`    | TEXT NOT NULL        | 更新时间      |
| `deleted_at`    | TEXT NULL            | 删除标记时间  |

### 6.1 上传状态

允许状态：

- `pending`：已创建记录，等待上传。
- `uploading`：正在上传。
- `uploaded`：原图及必要资源已成功保存。
- `failed`：上传失败。
- `deleting`：正在执行删除。
- `deleted`：已完成删除。

只有 `uploaded` 状态的照片可以被正式发布。

### 6.2 图片文件规范

原图和缩略图分别保存。

R2 Key 建议格式：

```
photos/original/YYYY/MM/{photo_id}.{ext}

photos/thumbnail/YYYY/MM/{photo_id}.webp
```

要求：

- 使用 UUID 生成文件名。
- 不直接使用用户上传的原始文件名作为 R2 Key。
- 原图不能被缩略图覆盖。
- 上传前验证真实文件类型。
- 不仅依靠文件扩展名判断图片格式。
- 检查图片大小、文件签名和解码结果。
- 上传失败必须保留失败状态。
- 不得将失败的照片标记为成功。

R2 Bucket 必须保持私有，所有图片读取均由 Worker 执行权限检查。

## 七、revision_photos：版本照片关联表

这是 V1.1 最重要的结构调整。

旧设计中，照片关联直接使用 `diary_id`。

这种方式无法可靠区分已发布版本和正在编辑的版本。

现在改为通过 `revision_id` 关联照片。

| 字段          | 类型             | 说明          |
| ------------- | ---------------- | ------------- |
| `id`          | TEXT PRIMARY KEY | 关联记录 UUID |
| `revision_id` | TEXT NOT NULL    | 日记版本 ID   |
| `photo_id`    | TEXT NOT NULL    | 照片 ID       |
| `sort_order`  | INTEGER NOT NULL | 照片顺序      |
| `created_at`  | TEXT NOT NULL    | 关联创建时间  |

### 7.1 关联规则

- 一个版本可以关联多张照片。
- 一张照片可以被多个版本引用。
- 一个版本内不能重复关联同一张照片。
- 每个版本的照片顺序独立。
- `sort_order` 从 0 开始。
- 第一张照片是时间轴代表照片。
- 公开端只能查询当前公开版本的关联记录。

建议唯一约束：

```
UNIQUE(revision_id, photo_id)
UNIQUE(revision_id, sort_order)
```

### 7.2 编辑隔离

例如：

```
日记 A
  |
  |---- 公开版本 R1
  |        |
  |        |---- 照片 P1
  |        |---- 照片 P2
  |        |---- 照片 P3
  |
  |---- 工作版本 R2
           |
           |---- 照片 P1
           |---- 照片 P3
           |---- 照片 P4
```

此时：

- 访客只能看到 R1。
- 管理员编辑的是 R2。
- P2 虽然已从工作版本移除，但公开版本仍然引用它。
- P4 尚未公开。
- 点击保存修改后，公开指针才从 R1 切换到 R2。

### 7.3 照片排序

修改照片顺序只影响当前工作版本。

提交成功后，新版本成为公开版本。

不得直接修改历史公开版本的排序。

## 八、admin_users：管理员账号表

| 字段                  | 类型                 | 说明         |
| --------------------- | -------------------- | ------------ |
| `id`                  | TEXT PRIMARY KEY     | 管理员 UUID  |
| `username`            | TEXT NOT NULL UNIQUE | 用户名       |
| `password_hash`       | TEXT NOT NULL        | 密码哈希     |
| `created_at`          | TEXT NOT NULL        | 创建时间     |
| `updated_at`          | TEXT NOT NULL        | 更新时间     |
| `password_changed_at` | TEXT NOT NULL        | 密码修改时间 |

规则：

- 不保存明文密码。
- 密码必须使用经过验证的安全密码哈希算法。
- 优先考虑适用于 Worker 运行环境的安全实现。
- 不提供公开注册接口。
- 首个管理员必须通过受保护的初始化流程创建。
- 初始化成功后关闭初始化入口。

## 九、admin_sessions：管理员会话表

| 字段         | 类型                 | 说明               |
| ------------ | -------------------- | ------------------ |
| `id`         | TEXT PRIMARY KEY     | 会话 UUID          |
| `admin_id`   | TEXT NOT NULL        | 管理员 ID          |
| `token_hash` | TEXT NOT NULL UNIQUE | Session Token 哈希 |
| `created_at` | TEXT NOT NULL        | 创建时间           |
| `expires_at` | TEXT NOT NULL        | 过期时间           |
| `revoked_at` | TEXT NULL            | 撤销时间           |

规则：

- 浏览器使用安全 Cookie 保存 Session Token。
- 数据库只保存 Token 哈希。
- Cookie 必须设置 HttpOnly、Secure、SameSite。
- 每次管理请求必须验证 Session。
- 退出登录后撤销对应 Session。
- 修改密码后撤销该管理员所有旧 Session。
- 过期 Session 不允许继续访问管理接口。
- Session 清理任务不得影响有效会话。

## 十、operation_logs：操作记录表

| 字段          | 类型             | 说明          |
| ------------- | ---------------- | ------------- |
| `id`          | TEXT PRIMARY KEY | 日志 UUID     |
| `admin_id`    | TEXT NULL        | 操作管理员 ID |
| `action_type` | TEXT NOT NULL    | 操作类型      |
| `target_id`   | TEXT NULL        | 操作对象 ID   |
| `summary`     | TEXT NOT NULL    | 简短操作摘要  |
| `created_at`  | TEXT NOT NULL    | 操作时间      |

记录范围：

- 管理员登录。
- 管理员退出。
- 创建日记。
- 编辑日记。
- 发布日记。
- 取消发布。
- 删除日记。
- 上传照片。
- 删除照片。
- 导出数据。
- 恢复数据。
- 修改网站设置。
- 修改管理员密码。

安全要求：

- 不记录明文密码。
- 不记录 Cookie。
- 不记录 Session Token。
- 不记录日记全文。
- 不记录不必要的个人敏感信息。
- 操作记录保留三个月。
- 清理旧日志不能影响其他业务数据。

## 十一、site_settings：网站设置表

| 字段         | 类型             | 说明     |
| ------------ | ---------------- | -------- |
| `key`        | TEXT PRIMARY KEY | 设置名称 |
| `value`      | TEXT NOT NULL    | 设置内容 |
| `updated_at` | TEXT NOT NULL    | 更新时间 |

初始配置：

| key             | 说明       |
| --------------- | ---------- |
| `site_name`     | 网站名称   |
| `site_subtitle` | 网站副标题 |
| `browser_title` | 浏览器标题 |

要求：

- 网站名称在访客端和管理后台保持一致。
- 配置由管理 API 修改。
- 不允许存储密码、Secret 或 Token。
- 不允许访客端直接修改设置。

## 十二、data_tasks：数据导入导出任务表

用于管理 ZIP 导出和恢复任务。

| 字段             | 类型                       | 说明                 |
| ---------------- | -------------------------- | -------------------- |
| `id`             | TEXT PRIMARY KEY           | 任务 UUID            |
| `task_type`      | TEXT NOT NULL              | `export` 或 `import` |
| `status`         | TEXT NOT NULL              | 任务状态             |
| `scope`          | TEXT NULL                  | 导出范围             |
| `r2_key`         | TEXT NULL                  | 任务文件 R2 Key      |
| `progress`       | INTEGER NOT NULL DEFAULT 0 | 任务进度             |
| `result_summary` | TEXT NULL                  | 执行结果摘要         |
| `error_message`  | TEXT NULL                  | 错误信息             |
| `created_at`     | TEXT NOT NULL              | 创建时间             |
| `updated_at`     | TEXT NOT NULL              | 更新时间             |
| `expires_at`     | TEXT NULL                  | 临时文件过期时间     |

### 12.1 任务状态

- `pending`：等待执行。
- `running`：正在执行。
- `completed`：执行成功。
- `failed`：执行失败。
- `cancelled`：已取消。

### 12.2 导出任务

支持：

- 全部数据。
- 仅已发布日记。
- 仅草稿。

导出内容：

```
backup.zip
├── diary-data.json
├── diary-data.csv
├── photos/
└── README.txt
```

JSON 是完整恢复数据的主要来源。

CSV 主要用于查看和整理。

导出必须包含：

- 日记 ID。
- 日记日期。
- 创建时间和发布时间。
- 日记版本及其内容。
- 当前公开版本指针。
- 当前工作版本指针。
- 版本照片关联。
- 照片顺序。
- 照片元数据。
- 原始照片文件。
- 日记和照片之间的关系。

只导出已发布日记时，不得意外包含未公开的工作版本内容。

### 12.3 恢复任务

恢复必须分阶段：

1. 上传 ZIP。
2. 检查 ZIP 文件结构。
3. 检查 JSON 格式。
4. 检查 UUID 和重复记录。
5. 检查照片文件是否存在。
6. 检查版本指针和关联关系。
7. 显示恢复预览。
8. 等待管理员确认。
9. 分批执行合并。
10. 返回恢复结果。

默认采用合并恢复，不覆盖已有记录。

相同 ID 且内容一致的记录可以识别为已存在并跳过。

相同 ID 但内容不同的记录必须报告冲突，不得静默覆盖。

导入引用了缺失照片、无效版本或不合法关联时，必须报告错误。

恢复前建议管理员手动导出当前数据。

恢复任务不得绕过正常的照片引用和版本规则。

## 十三、photo_cleanup_tasks：照片清理任务表

由于 D1 和 R2 不属于同一个事务系统，需要建立独立清理任务。

| 字段          | 类型                       | 说明          |
| ------------- | -------------------------- | ------------- |
| `id`          | TEXT PRIMARY KEY           | 清理任务 UUID |
| `photo_id`    | TEXT NOT NULL              | 照片 ID       |
| `status`      | TEXT NOT NULL              | 清理状态      |
| `retry_count` | INTEGER NOT NULL DEFAULT 0 | 重试次数      |
| `last_error`  | TEXT NULL                  | 最近错误      |
| `created_at`  | TEXT NOT NULL              | 创建时间      |
| `updated_at`  | TEXT NOT NULL              | 更新时间      |

状态：

- `pending`：等待清理。
- `running`：正在清理。
- `completed`：清理完成。
- `failed`：清理失败。

执行删除前必须再次检查：

1. 是否存在任何 `revision_photos` 引用。
2. 是否有版本仍然引用该照片。
3. 是否有正在进行的恢复任务。
4. 是否有正在执行的上传或其他操作。

只有确认没有有效引用后，才允许删除 R2 文件。

清理失败时必须保留任务记录，允许后续重试。

## 十四、核心业务事务规则

### 14.1 创建新日记

1. 创建 `diaries`。
2. 创建一条 `working` 版本。
3. 将版本 ID 写入 `draft_revision_id`。
4. 设置 `status = draft`。
5. 写入操作记录。

日记主体和版本记录必须在同一个 D1 事务中完成。

### 14.2 自动保存草稿

自动保存只修改当前工作版本。

允许修改：

- `content`。
- `updated_at`。
- `revision_photos`。
- 照片排序。

不得修改当前公开版本。

自动保存必须支持重试，并避免较早的保存请求覆盖较新的编辑内容。

### 14.3 编辑已发布日记

1. 检查日记是否已有工作版本。
2. 如果没有，创建新的工作版本。
3. 复制公开版本文字。
4. 复制公开版本照片关联。
5. 复制照片顺序。
6. 更新 `draft_revision_id`。
7. 保持 `published_revision_id` 不变。

如果已经存在工作版本，则继续编辑，不重复创建。

### 14.4 发布新日记

1. 验证工作版本存在。
2. 验证所有照片均已上传成功。
3. 验证版本关联和顺序正确。
4. 将工作版本设为 `published`。
5. 更新 `published_revision_id`。
6. 清空 `draft_revision_id`。
7. 设置 `status = published`。
8. 更新发布时间。
9. 写入操作记录。

第 4 至第 8 步必须在同一个 D1 事务中完成。

### 14.5 保存已发布日记的修改

1. 验证当前工作版本。
2. 验证所有照片。
3. 将工作版本设为 `published`。
4. 将 `published_revision_id` 指向新版本。
5. 清空 `draft_revision_id`。
6. 更新发布时间及更新时间。
7. 写入操作记录。

所有公开查询只能读取提交后的新版本。

切换指针前的任何失败，都不得破坏旧公开版本。

### 14.6 取消发布

1. 将 `published_revision_id` 清空。
2. 保留当前工作版本。
3. 将日记状态设为 `draft`。
4. 记录取消发布时间。
5. 写入操作记录。

如果需要继续编辑，应确保存在可用的工作版本。

### 14.7 删除日记

删除日记时：

1. 验证管理员权限。
2. 执行软删除。
3. 访客端立即停止展示。
4. 保留日记版本及照片关系。
5. 询问管理员是否同时清理照片。
6. 只有在永久清理流程中，才删除不再被引用的照片。

一张照片被其他日记或版本引用时，不能删除其文件。

### 14.8 删除照片

删除照片时：

1. 检查所有版本关联。
2. 如果仍被引用，禁止直接删除。
3. 如果只被当前工作版本引用，先从工作版本移除。
4. 检查是否存在其他引用。
5. 没有引用时创建清理任务。
6. 删除 R2 原图及缩略图。
7. 确认删除成功后更新数据库状态。
8. 失败时保留任务和错误信息。

## 十五、索引设计

建议建立以下索引：

```
CREATE INDEX idx_diaries_status_date
ON diaries(status, record_date);

CREATE INDEX idx_diaries_published_at
ON diaries(published_at);

CREATE INDEX idx_revisions_diary_updated
ON diary_revisions(diary_id, updated_at);

CREATE INDEX idx_revision_photos_revision_order
ON revision_photos(revision_id, sort_order);

CREATE INDEX idx_revision_photos_photo
ON revision_photos(photo_id);

CREATE INDEX idx_photos_uploaded_at
ON photos(uploaded_at);

CREATE INDEX idx_photos_upload_status
ON photos(upload_status);

CREATE INDEX idx_sessions_admin_expiry
ON admin_sessions(admin_id, expires_at);

CREATE INDEX idx_logs_created_at
ON operation_logs(created_at);

CREATE INDEX idx_logs_action_type
ON operation_logs(action_type);

CREATE INDEX idx_data_tasks_status
ON data_tasks(status);

CREATE INDEX idx_cleanup_tasks_status
ON photo_cleanup_tasks(status);
```

创建唯一约束：

```
CREATE UNIQUE INDEX idx_revision_photos_unique_photo
ON revision_photos(revision_id, photo_id);

CREATE UNIQUE INDEX idx_revision_photos_unique_order
ON revision_photos(revision_id, sort_order);
```

注意：实际 Migration 应根据 SQLite 版本、外键定义和现有数据情况验证语法及执行顺序。

## 十六、数据一致性与异常处理

D1 和 R2 之间无法使用一个共同事务完成所有操作。

必须采用可恢复的业务流程。

### 16.1 上传失败

如果 R2 上传成功但数据库更新失败：

- 不得向用户报告上传完成。
- 保留上传任务信息。
- 允许安全重试。
- 对无法关联的 R2 文件进行后续清理。

如果数据库记录创建成功但 R2 上传失败：

- 将照片标记为 `failed`。
- 不允许该照片进入公开版本。
- 允许重新上传或清理记录。

### 16.2 删除失败

如果 R2 文件删除失败：

- 保留清理任务。
- 增加重试次数。
- 记录最近错误。
- 不得错误地报告清理全部完成。

### 16.3 并发编辑

必须避免多个请求覆盖彼此的编辑结果。

建议为版本增加乐观锁字段，例如：

```
revision_version INTEGER NOT NULL DEFAULT 1
```

每次保存时检查客户端提交的版本号。

只有版本号匹配才允许更新。

保存成功后递增版本号。

版本号不匹配时返回冲突错误，要求客户端重新获取最新版本。

### 16.4 数据库迁移

- 每次 Migration 必须有独立文件。
- Migration 只能向前执行，不直接修改已经部署的历史 Migration。
- 破坏性修改必须先备份并制定回滚或补偿方案。
- 正式环境执行前必须在本地和 Preview 环境验证。
- 不允许未经确认删除已有表或字段。

## 十七、数据导出和恢复规则

### 17.1 数据导出

完整导出必须保留：

- 日记主体。
- 所有需要恢复的版本。
- 版本文字。
- 版本照片关联。
- 照片顺序。
- 照片原始文件。
- 照片元数据。
- 日记和照片之间的关联。
- 必要的创建及发布时间。

不导出：

- 管理员密码哈希。
- Session Token。
- Cookie。
- Cloudflare Secret。
- 其他认证凭据。

### 17.2 数据恢复

恢复时：

- 保留原始 UUID。
- 不重复创建已有记录。
- 不静默覆盖冲突记录。
- 保持版本指针合法。
- 保持照片顺序。
- 保持日记和照片关系。
- 只接受符合规定的图片格式。
- 对 ZIP 解压后的总大小和文件数量进行限制。
- 防止路径穿越和恶意压缩包。
- 失败时提供明确报告。

### 17.3 部分失败

恢复任务必须记录：

- 成功导入数量。
- 跳过数量。
- 冲突数量。
- 失败数量。
- 失败原因。

不能将部分成功报告为全部成功。

## 十八、Migration 规划

建议文件结构：

```
migrations/
├── 0001_initial_schema.sql
├── 0002_revision_photo_relations.sql
├── 0003_admin_sessions.sql
├── 0004_operation_logs.sql
├── 0005_data_tasks.sql
└── 0006_photo_cleanup_tasks.sql
```

说明：

- 如果项目尚未建立数据库，可以在初始 Migration 中直接采用本版结构。
- 如果已经存在旧版数据库，则必须通过迁移脚本转换旧照片关联关系。
- 不能直接删除旧关联表后重新创建，必须先迁移和核对数据。
- 迁移后必须验证日记版本、照片顺序和公开内容一致性。

## 十九、数据库验收清单

### 日记版本

- 

  新建日记能够创建工作版本。

- 

  自动保存不会影响公开版本。

- 

  已发布日记可以创建独立工作版本。

- 

  编辑工作版本不会影响公开照片。

- 

  发布后公开版本指针正确更新。

- 

  历史版本仍然可以保留。

- 

  取消发布后访客端无法访问日记。

### 照片关联

- 

  每个版本可以拥有独立照片列表。

- 

  每个版本可以拥有独立照片顺序。

- 

  同一张照片可以被多个版本引用。

- 

  第一张照片能够作为时间轴代表照片。

- 

  未上传成功的照片不能发布。

- 

  被引用的照片不能被直接删除。

### 安全

- 

  管理员密码不以明文保存。

- 

  Session Token 不以明文保存。

- 

  草稿数据无法通过公开 API 读取。

- 

  R2 文件不允许未经授权访问。

- 

  所有管理 API 都经过权限检查。

### 数据一致性

- 

  上传失败可以重试。

- 

  删除失败可以重试。

- 

  R2 孤立文件可以被识别。

- 

  并发编辑能够识别版本冲突。

- 

  数据恢复不会静默覆盖现有数据。

- 

  恢复后照片顺序和关联正确。

### 数据迁移

- 

  Migration 可以在本地执行。

- 

  Migration 可以在 Preview 环境执行。

- 

  正式环境迁移前完成备份。

- 

  旧版照片关联能够正确迁移。

- 

  迁移后公开内容与迁移前一致。

## 二十、最终设计原则

本项目数据库必须遵守以下原则：

1. 日记主体与日记版本分离。
2. 工作版本与公开版本分离。
3. 照片关联属于版本，而不是直接属于日记。
4. 发布操作只切换公开版本，不直接修改历史公开内容。
5. R2 文件删除必须经过引用检查。
6. 数据库与 R2 操作必须具备失败补偿机制。
7. 恢复数据不得静默覆盖现有记录。
8. 所有公开查询只能读取已发布版本。
9. 数据库结构变更必须通过 Migration。
10. 任何破坏性数据操作都必须经过用户确认。

**数据库设计规范 V1.1**

**本版本为后续 API、后端实现和测试规范的基础。**