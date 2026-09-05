/**
 * SnippetStore 抽象（plan-v2-accounts.md §4.3）：UI 不关心数据在哪。
 * - LocalSnippetStore：localStorage（匿名路径，也是登录后的本地缓存底层）；
 * - CloudSnippetStore：包一层同步队列——读走本地（瞬时响应），写先落本地再入队推送。
 *
 * 与计划中接口的差异：list/upsert/remove 之外增加了 subscribe（React 状态同步用）
 * 与 replaceAll（登录全量拉取 / 登出回退用），均为实现同步引擎所需的最小扩展。
 */
import type { Snippet } from './snippets'
import {
  loadSnippetsFrom,
  saveSnippetsTo,
  upsertSnippet,
  type SnippetStorageConfig,
} from './snippets'

export interface SnippetStore {
  /** 当前快照（同步返回，便于 React 初始化） */
  current(): Snippet[]
  upsert(snippet: Snippet): void
  remove(id: string): void
  /** 全量替换（登录全量拉取、合并向导、登出回退） */
  replaceAll(snippets: Snippet[]): void
  /** 订阅变更；返回取消订阅函数 */
  subscribe(listener: (snippets: Snippet[]) => void): () => void
}

export interface LocalWriteHooks {
  /** 写透本地缓存后触发（云端 store 用它把变更推入同步队列） */
  onUpsert?: (snippet: Snippet) => void
  /** 本地删除后触发（云端 store 用它入队软删除） */
  onRemove?: (id: string) => void
}

export class LocalSnippetStore implements SnippetStore {
  private list: Snippet[]
  private readonly listeners = new Set<(snippets: Snippet[]) => void>()

  constructor(
    private readonly storage: SnippetStorageConfig,
    private readonly hooks: LocalWriteHooks = {},
  ) {
    this.list = loadSnippetsFrom(storage)
  }

  current(): Snippet[] {
    return this.list
  }

  upsert(snippet: Snippet): void {
    this.list = upsertSnippet(this.list, snippet)
    this.persist()
    this.hooks.onUpsert?.(snippet)
    this.emit()
  }

  remove(id: string): void {
    this.list = this.list.filter((s) => s.id !== id)
    this.persist()
    this.hooks.onRemove?.(id)
    this.emit()
  }

  replaceAll(snippets: Snippet[]): void {
    this.list = snippets
    this.persist()
    this.emit()
  }

  subscribe(listener: (snippets: Snippet[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private persist(): void {
    saveSnippetsTo(this.storage, this.list)
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.list)
  }
}
