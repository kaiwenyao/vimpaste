/**
 * 统一响应信封（plan-v2-accounts.md §6）：所有端点只输出两种形状之一。
 * 错误信息面向用户与日志，绝不含请求体内容（编辑内容可能含真实密钥）。
 */

export interface ApiErrorBody {
  code: string
  message: string
}

export type ApiResponse<T> =
  | { ok: true; data: T; meta?: { total: number; cursor?: string } }
  | { ok: false; error: ApiErrorBody }

export function ok<T>(data: T, meta?: { total: number; cursor?: string }): ApiResponse<T> {
  return meta ? { ok: true, data, meta } : { ok: true, data }
}

/** 带 HTTP 状态码的业务错误；route 层抛出，由全局错误处理器转成信封 */
export class ApiError extends Error {
  readonly statusCode: number
  readonly code: string

  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

export function fail(statusCode: number, code: string, message: string): ApiError {
  return new ApiError(statusCode, code, message)
}
