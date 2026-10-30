// 访客端日记接口（只读取已发布内容）
import type { Env } from '../env'
import type { RouteHandler, Router } from '../utils/router'
import { json } from '../utils/response'
import { readPositiveInt, validateMonth, validateYear } from '../utils/http'
import * as diaryService from '../services/diary-service'

export function registerPublicDiaryRoutes(router: Router<Env>): void {
  router.get('/api/public/diaries', handleList)
  router.get('/api/public/diaries/:id', handleDetail)
}

const handleList: RouteHandler<Env> = async ({ env, url }) => {
  const page = readPositiveInt(url.searchParams.get('page'), 1, 1000)
  // 访客端单页上限 50，避免一次拉取过多数据
  const limit = readPositiveInt(url.searchParams.get('limit'), 12, 50)
  const yearParam = url.searchParams.get('year')
  const monthParam = url.searchParams.get('month')

  return json(
    await diaryService.listPublicDiaries(env.DB, {
      page,
      limit,
      offset: (page - 1) * limit,
      year: yearParam ? validateYear(yearParam) : null,
      month: monthParam ? validateMonth(monthParam) : null,
    }),
  )
}

const handleDetail: RouteHandler<Env> = async ({ env, params }) => {
  return json(await diaryService.getPublicDiary(env.DB, params.id))
}
