/**
 * 云端 API 客户端（plan-v2-accounts.md §6）。
 * 只走同源相对路径 `/api/...`（CSP connect-src 'self' 的前提），Cookie 自动随发。
 * 所有响应遵循统一信封；非 2xx 一律抛 CloudApiError（message 面向用户）。
 */

export interface CloudUser {
  id: number
  email: string
  name: string | null
}

export interface ApiSnippet {
  id: string
  kind: 'command' | 'prompt'
  title: string
  content: string
  langId: string
  pinned: boolean
  usageCount: number
  lastUsedAt: number | null
  collectionId: number | null
  tags: string[]
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface ApiCollection {
  id: number
  name: string
  color: string
  order: number
}

export interface ApiTag {
  name: string
  count: number
}

export interface SyncResult {
  applied: string[]
  conflicts: { id: string; server: ApiSnippet | null }[]
  pulled: ApiSnippet[]
  now: number
}

export class CloudApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

interface Envelope<T> {
  ok: boolean
  data?: T
  meta?: { total: number; cursor?: string }
  error?: { code: string; message: string }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; meta?: { total: number; cursor?: string } }> {
  let res: Response
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
  } catch {
    throw new CloudApiError(0, 'NETWORK', '网络不可用，稍后会自动重试')
  }
  let body: Envelope<T> | null = null
  try {
    body = (await res.json()) as Envelope<T>
  } catch {
    /* 非 JSON 响应按未知错误处理 */
  }
  if (!res.ok || !body?.ok || body.data === undefined) {
    const code = body?.error?.code ?? 'UNKNOWN'
    const message = body?.error?.message ?? `请求失败（${res.status}）`
    throw new CloudApiError(res.status, code, message)
  }
  return { data: body.data, meta: body.meta }
}

export const cloudApi = {
  async me(): Promise<CloudUser | null> {
    try {
      const { data } = await request<{ user: CloudUser }>('/api/auth/me')
      return data.user
    } catch (error) {
      if (error instanceof CloudApiError && error.status === 401) return null
      throw error
    }
  },

  async login(email: string, password: string): Promise<CloudUser> {
    const { data } = await request<{ user: CloudUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    return data.user
  },

  async register(email: string, password: string, name?: string): Promise<CloudUser> {
    const { data } = await request<{ user: CloudUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, ...(name ? { name } : {}) }),
    })
    return data.user
  },

  async logout(): Promise<void> {
    await request('/api/auth/logout', { method: 'POST', body: '{}' })
  },

  async sync(since: number, changes: ApiSnippet[]): Promise<SyncResult> {
    const { data } = await request<SyncResult>('/api/snippets/sync', {
      method: 'POST',
      body: JSON.stringify({ since, changes }),
    })
    return data
  },

  async deleteSnippet(id: string): Promise<void> {
    await request(`/api/snippets/${id}`, { method: 'DELETE' })
  },

  async collections(): Promise<ApiCollection[]> {
    const { data } = await request<ApiCollection[]>('/api/collections')
    return data
  },

  async createCollection(name: string): Promise<ApiCollection> {
    const { data } = await request<ApiCollection>('/api/collections', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
    return data
  },

  async renameCollection(id: number, name: string): Promise<void> {
    await request(`/api/collections/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    })
  },

  async deleteCollection(id: number): Promise<void> {
    await request(`/api/collections/${id}`, { method: 'DELETE' })
  },

  async tags(): Promise<ApiTag[]> {
    const { data } = await request<ApiTag[]>('/api/tags')
    return data
  },
}
