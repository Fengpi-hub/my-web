// 统一成功响应（可附带额外响应头，如 Set-Cookie）
export function json<T>(
  data: T,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  })
}

// 统一错误响应（不暴露内部错误细节）
export function error(code: string, message: string, status = 400): Response {
  return new Response(
    JSON.stringify({ success: false, error: { code, message } }),
    {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    },
  )
}