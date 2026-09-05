/**
 * 云端会话装配（plan-v2-accounts.md Phase 4）：
 * - restoreSession：页面加载时用 /api/auth/me 静默恢复会话；
 * - startCloudSession：登录成功后建 store + engine，执行 v1→v2 迁移与全量拉取；
 * - 会话对象持有 store（换给 App）与 engine（同步状态/合并/销毁）。
 */
import { LocalSnippetStore } from '../storage/SnippetStore'
import type { Snippet } from '../storage/snippets'
import {
  CLOUD_CACHE_STORAGE,
  migrateV1ToV2,
  MAX_LOCAL_SNIPPETS,
  loadSnippetsFrom,
  LOCAL_SNIPPET_STORAGE,
} from '../storage/snippets'
import { cloudApi, CloudApiError } from './api'
import type { CloudUser } from './api'
import { SyncEngine } from './sync'
import type { SyncStatus } from './sync'

export interface CloudSessionOptions {
  onStatus: (status: SyncStatus) => void
}

const MERGE_ASKED_KEY = 'vimpaste.mergeasked.v1'

function mergeAlreadyAsked(): boolean {
  try {
    return localStorage.getItem(MERGE_ASKED_KEY) === '1'
  } catch {
    return false
  }
}

function markMergeAsked(): void {
  try {
    localStorage.setItem(MERGE_ASKED_KEY, '1')
  } catch {
    /* 忽略 */
  }
}

export class CloudSession {
  readonly store: LocalSnippetStore
  readonly engine: SyncEngine
  readonly user: CloudUser
  /** 本机迁入缓存、尚未合并到云端的条目数（合并向导用；问过一次就不再问） */
  readonly localUnsynced: Snippet[]

  constructor(store: LocalSnippetStore, engine: SyncEngine, user: CloudUser) {
    this.store = store
    this.engine = engine
    this.user = user
    this.localUnsynced = mergeAlreadyAsked()
      ? []
      : store.current().filter((s) => s.syncState === 'local' && !s.localOnly)
  }

  /** 合并向导「合并到云端」：全部本机条目入队推送 */
  mergeLocal(): void {
    markMergeAsked()
    this.engine.enqueueMany(this.localUnsynced)
  }

  /** 合并向导「暂不合并」：条目留在本地缓存，不入队 */
  keepLocal(): void {
    markMergeAsked()
    /* syncState 保持 local，仅后续编辑会单独入队 */
  }

  async destroy(): Promise<void> {
    this.engine.stop()
    try {
      await cloudApi.logout()
    } catch {
      /* 会话吊销失败不阻塞登出 UI */
    }
  }
}

/** 登录成功：迁移 v1 → v2 缓存，装配 store/engine，全量拉取 */
export async function startCloudSession(
  user: CloudUser,
  options: CloudSessionOptions,
): Promise<CloudSession> {
  // 迁移：v1 存在且 v2 不存在时读 v1 → 补默认字段 → 写 v2（v1 键保留）
  migrateV1ToV2()
  const store = new LocalSnippetStore(CLOUD_CACHE_STORAGE, {
    onUpsert: (snippet) => {
      if (!engine.remoteWrite) engine.enqueueUpsert(snippet)
    },
    onRemove: (id) => {
      if (!engine.remoteWrite) engine.enqueueDelete(id)
    },
  })
  const engine = new SyncEngine({ store, onStatus: options.onStatus })
  engine.start()
  await engine.pullAll()
  return new CloudSession(store, engine, user)
}

/** 页面加载时静默恢复会话；未登录或网络失败返回 null（保持本地模式） */
export async function restoreSession(options: CloudSessionOptions): Promise<CloudSession | null> {
  try {
    const user = await cloudApi.me()
    if (!user) return null
    return await startCloudSession(user, options)
  } catch (error) {
    if (error instanceof CloudApiError && error.status === 401) return null
    // 会话恢复失败：退回本地模式，不打断编辑
    options.onStatus({ state: 'paused', lastSyncAt: null })
    return null
  }
}

/** 登出后回到本地模式：重读 v1 匿名存储 */
export function localStoreAfterLogout(): LocalSnippetStore {
  return new LocalSnippetStore(LOCAL_SNIPPET_STORAGE)
}

/** 匿名本地历史条数（登录对话框的合并向导文案用） */
export function countLocalHistory(): number {
  return loadSnippetsFrom(LOCAL_SNIPPET_STORAGE).length
}

export { MAX_LOCAL_SNIPPETS }
