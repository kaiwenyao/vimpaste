import { useState } from 'react'
import { Dialog } from '../../components/Dialog'
import { cloudApi } from '../api'
import type { CloudUser } from '../api'
import { startCloudSession, type CloudSession } from '../session'
import type { SyncStatus } from '../sync'
import type { ApiCollection } from '../api'

/**
 * 账号对话框（plan-v2-accounts.md Phase 4）：登录 / 注册 / 合并向导 / 已登录管理。
 * 本组件属于云端模块：只被动态 import()（VITE_CLOUD_ENABLED=false 的构建不进包）。
 */

interface AccountDialogProps {
  open: boolean
  onClose: () => void
  session: CloudSession | null
  syncStatus: SyncStatus
  /** 同步状态上报给 App（登录建立会话时需要） */
  onStatus: (status: SyncStatus) => void
  onSessionReady: (session: CloudSession, collections: ApiCollection[]) => void
  onLogout: () => Promise<void>
  onRetrySync: () => void
}

type Step = 'auth' | 'merge' | 'account'

export function AccountDialog({
  open,
  onClose,
  session,
  syncStatus,
  onStatus,
  onSessionReady,
  onLogout,
  onRetrySync,
}: AccountDialogProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [step, setStep] = useState<Step>(session ? 'account' : 'auth')
  const [pendingSession, setPendingSession] = useState<CloudSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!open) return null

  const handleSubmit = async () => {
    setError(null)
    setBusy(true)
    try {
      const user: CloudUser =
        mode === 'login'
          ? await cloudApi.login(email.trim(), password)
          : await cloudApi.register(email.trim(), password, name.trim() || undefined)
      const newSession = await startCloudSession(user, { onStatus })
      onSessionReady(newSession, await cloudApi.collections())
      if (newSession.localUnsynced.length > 0) {
        setPendingSession(newSession)
        setStep('merge')
      } else {
        onClose()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '登录失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  const handleMergeChoice = (merge: boolean) => {
    const target = pendingSession ?? session
    if (target) {
      if (merge) target.mergeLocal()
      else target.keepLocal()
    }
    setPendingSession(null)
    onClose()
  }

  const handleLogout = async () => {
    await onLogout()
    setStep('auth')
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} title={step === 'account' ? '账号' : '登录 VimPaste 云端'}>
      {step === 'auth' && (
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault()
            void handleSubmit()
          }}
        >
          <p className="account-hint">
            登录后片段同步到你自托管的服务器；未登录时一切照旧，内容只留本机。
          </p>
          {mode === 'register' && (
            <label className="account-field">
              <span>显示名（可选）</span>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          <label className="account-field">
            <span>邮箱</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="account-field">
            <span>密码</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p className="account-error" role="alert">
              {error}
            </p>
          )}
          <div className="account-actions">
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册'}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login')
                setError(null)
              }}
            >
              {mode === 'login' ? '没有账号？注册' : '返回登录'}
            </button>
          </div>
        </form>
      )}

      {step === 'merge' && (
        <div className="account-merge">
          <p>
            本机有 <strong>{pendingSession?.localUnsynced.length ?? 0}</strong>{' '}
            条历史记录，合并到云端后可在所有设备上使用。
          </p>
          <p className="account-hint">含「仅本地」标记的条目不会上传。</p>
          <div className="account-actions">
            <button type="button" className="btn primary" onClick={() => handleMergeChoice(true)}>
              合并到云端
            </button>
            <button type="button" className="btn ghost" onClick={() => handleMergeChoice(false)}>
              暂不合并
            </button>
          </div>
        </div>
      )}

      {step === 'account' && session && (
        <div className="account-manage">
          <p>
            已登录：<strong>{session.user.email}</strong>
          </p>
          <p className="account-hint">
            {syncStatus.state === 'paused'
              ? '同步暂停 · 点击「立即同步」重试'
              : syncStatus.lastSyncAt
                ? `上次同步：${new Date(syncStatus.lastSyncAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
                : '尚未同步'}
          </p>
          <div className="account-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                onRetrySync()
                onClose()
              }}
            >
              立即同步
            </button>
            <button type="button" className="btn ghost danger" onClick={() => void handleLogout()}>
              退出登录
            </button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

export default AccountDialog
