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
  note: string | null
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

/** PATCH /api/collections/:id 的请求体：字段全部可选，省略即不改 */
export interface CollectionPatch {
  name?: string
  color?: string
  order?: number
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
  meta?: { total: number; cursor?: string; retentionDays?: number }
  error?: { code: string; message: string }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; meta?: { total: number; cursor?: string; retentionDays?: number } }> {
  let res: Response
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      // 只在确有 body 时声明 Content-Type：无 body 的 DELETE 一旦带上
      // application/json，服务端会按 JSON 解析空请求体而直接拒绝（400）
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
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

  /**
   * 回收站列表。服务端把墓碑全量回传（单页上限 200），并告知部署实际配置的
   * 保留天数——UI 要显示「剩余 N 天」，不能把 30 写死在客户端。
   */
  async trash(): Promise<{ items: ApiSnippet[]; retentionDays: number }> {
    const { data, meta } = await request<ApiSnippet[]>('/api/snippets/trash')
    return { items: data, retentionDays: meta?.retentionDays ?? 30 }
  },

  /** 从回收站恢复：服务端清墓碑并同时推进 updatedAt / syncedAt，其它设备才拉得到 */
  async restoreSnippet(id: string): Promise<ApiSnippet> {
    // 带 body 的 POST：服务端不需要请求体，但空 body + JSON 头会被解析器拒绝
    const { data } = await request<ApiSnippet>(`/api/snippets/${id}/restore`, {
      method: 'POST',
      body: '{}',
    })
    return data
  },

  /** 彻底删除单条墓碑（不可恢复）；服务端对在用条目返回 409 NOT_TRASHED */
  async purgeSnippet(id: string): Promise<void> {
    await request(`/api/snippets/${id}/purge`, { method: 'DELETE' })
  },

  /** 清空回收站，返回被物理删除的条数 */
  async emptyTrash(): Promise<number> {
    const { data } = await request<{ count: number }>('/api/snippets/trash', { method: 'DELETE' })
    return data.count
  },

  async collections(): Promise<ApiCollection[]> {
    const { data } = await request<ApiCollection[]>('/api/collections')
    return data
  },

  async createCollection(name: string, color?: string): Promise<ApiCollection> {
    const { data } = await request<ApiCollection>('/api/collections', {
      method: 'POST',
      body: JSON.stringify({ name, ...(color ? { color } : {}) }),
    })
    return data
  },

  /** 名称 / 颜色 / 排序统一走 PATCH；只传要改的字段（省略≠清空） */
  async updateCollection(id: number, patch: CollectionPatch): Promise<void> {
    await request(`/api/collections/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
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
