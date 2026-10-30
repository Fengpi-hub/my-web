// 数据访问层基础：统一使用参数绑定，禁止字符串拼接 SQL
import { AppError } from '../utils/errors'

// 查询单行；找不到返回 null
export async function queryOne<T>(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const row = await db.prepare(sql).bind(...params).first<T>()
  return row ?? null
}

// 查询多行
export async function queryAll<T>(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await db.prepare(sql).bind(...params).all<T>()
  return result.results ?? []
}

// 执行写操作；返回影响行数
export async function execute(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  const result = await db.prepare(sql).bind(...params).run()
  if (!result.success) {
    throw new AppError('INTERNAL_ERROR', '数据库写入失败')
  }
  return result.meta.changes ?? 0
}
