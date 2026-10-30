// 访客端公开内容接口：首页随机照片、照片墙、时间轴
import type { Env } from '../env'
import type { RouteHandler, Router } from '../utils/router'
import { json } from '../utils/response'
import { readPositiveInt, validateMonth, validateYear } from '../utils/http'
import {
  getHomeRandomPhotos,
  getPhotoPeriods,
  getPublicPhotos,
  getPublicTimeline,
  getTimelinePeriods,
} from '../services/public-content-service'

export function registerPublicContentRoutes(router: Router<Env>): void {
  router.get('/api/public/home/random-photos', handleRandomPhotos)
  router.get('/api/public/photos', handlePhotos)
  router.get('/api/public/photos/periods', handlePhotoPeriods)
  router.get('/api/public/timeline', handleTimeline)
  router.get('/api/public/timeline/periods', handleTimelinePeriods)
}

const handleRandomPhotos: RouteHandler<Env> = async ({ env, url }) => {
  const limit = readPositiveInt(url.searchParams.get('limit'), 12, 24)
  return json(await getHomeRandomPhotos(env.DB, limit))
}

const handlePhotos: RouteHandler<Env> = async ({ env, url }) => {
  const limit = readPositiveInt(url.searchParams.get('limit'), 21, 60)
  const yearParam = url.searchParams.get('year')
  const monthParam = url.searchParams.get('month')
  return json(
    await getPublicPhotos(env.DB, {
      limit,
      year: yearParam ? validateYear(yearParam) : null,
      month: monthParam ? validateMonth(monthParam) : null,
      cursor: url.searchParams.get('cursor'),
    }),
  )
}

const handlePhotoPeriods: RouteHandler<Env> = async ({ env }) => {
  return json(await getPhotoPeriods(env.DB))
}

const handleTimeline: RouteHandler<Env> = async ({ env, url }) => {
  const limit = readPositiveInt(url.searchParams.get('limit'), 20, 50)
  const yearParam = url.searchParams.get('year')
  const monthParam = url.searchParams.get('month')
  return json(
    await getPublicTimeline(env.DB, {
      limit,
      year: yearParam ? validateYear(yearParam) : null,
      month: monthParam ? validateMonth(monthParam) : null,
      cursor: url.searchParams.get('cursor'),
    }),
  )
}

const handleTimelinePeriods: RouteHandler<Env> = async ({ env }) => {
  return json(await getTimelinePeriods(env.DB))
}
