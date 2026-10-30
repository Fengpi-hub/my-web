// 极简路由：按方法 + 路径匹配，支持 :param 段

export interface RouteContext<E> {
  request: Request
  env: E
  params: Record<string, string>
  url: URL
  // 运行时上下文：用于 waitUntil 等后台任务
  ctx: ExecutionContext
}

export type RouteHandler<E> = (ctx: RouteContext<E>) => Promise<Response> | Response

interface RegisteredRoute<E> {
  method: string
  pattern: string[]
  handler: RouteHandler<E>
}

export class Router<E = unknown> {
  private readonly routes: RegisteredRoute<E>[] = []

  get(path: string, handler: RouteHandler<E>): this {
    return this.add('GET', path, handler)
  }

  post(path: string, handler: RouteHandler<E>): this {
    return this.add('POST', path, handler)
  }

  put(path: string, handler: RouteHandler<E>): this {
    return this.add('PUT', path, handler)
  }

  delete(path: string, handler: RouteHandler<E>): this {
    return this.add('DELETE', path, handler)
  }

  // 返回 null 表示无匹配路由
  async handle(request: Request, env: E, ctx: ExecutionContext): Promise<Response | null> {
    const url = new URL(request.url)
    const segments = url.pathname.split('/').filter(Boolean)

    for (const route of this.routes) {
      if (route.method !== request.method) continue
      const params = matchPattern(route.pattern, segments)
      if (params) {
        return route.handler({ request, env, params, url, ctx })
      }
    }
    return null
  }

  private add(method: string, path: string, handler: RouteHandler<E>): this {
    this.routes.push({
      method,
      pattern: path.split('/').filter(Boolean),
      handler,
    })
    return this
  }
}

function matchPattern(
  pattern: string[],
  segments: string[],
): Record<string, string> | null {
  if (pattern.length !== segments.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < pattern.length; i++) {
    const part = pattern[i]
    if (part.startsWith(':')) {
      params[part.slice(1)] = decodeURIComponent(segments[i])
    } else if (part !== segments[i]) {
      return null
    }
  }
  return params
}
