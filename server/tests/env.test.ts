/**
 * 探针与环境校验单元测试：healthz / readyz 信封、env 启动即失败、时间戳钳制。
 */
import { describe, expect, it } from 'vitest'
import { loadEnv, formatEnvIssues } from '../src/env.js'
import { clampTimestamp } from '../src/schemas/timestamps.js'
import { z } from 'zod'

describe('env.ts（启动即失败）', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    SESSION_SECRET: 'x'.repeat(32),
  }

  it('缺 DATABASE_URL 或弱 SESSION_SECRET 时抛错并列出字段', () => {
    expect(() => loadEnv({} as NodeJS.ProcessEnv)).toThrow(/环境变量校验失败/)
    expect(() => loadEnv({ DATABASE_URL: base.DATABASE_URL } as NodeJS.ProcessEnv)).toThrow(
      /SESSION_SECRET/,
    )
    expect(() => loadEnv({ ...base, SESSION_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow(
      /至少 32 字符/,
    )
    expect(() => loadEnv({ ...base, DATABASE_URL: 'mysql://nope' } as NodeJS.ProcessEnv)).toThrow(
      /postgres/,
    )
  })

  it('默认值与布尔解析：DISABLE_REGISTRATION 默认 true，"false" 为 false', () => {
    const env = loadEnv(base as unknown as NodeJS.ProcessEnv)
    expect(env.DISABLE_REGISTRATION).toBe(true)
    expect(env.MAX_CONTENT_CHARS).toBe(100_000)
    expect(env.PORT).toBe(3000)

    const open = loadEnv({ ...base, DISABLE_REGISTRATION: 'false' } as unknown as NodeJS.ProcessEnv)
    expect(open.DISABLE_REGISTRATION).toBe(false)
  })

  it('formatEnvIssues 不回显输入值', () => {
    const parsed = z
      .object({ SECRET: z.string().min(100) })
      .safeParse({ SECRET: 'tiny-value-with-password' })
    if (parsed.success) throw new Error('expected failure')
    const text = formatEnvIssues(parsed.error)
    expect(text).not.toContain('tiny-value-with-password')
  })
})

describe('clampTimestamp（合理性钳制）', () => {
  const now = Date.UTC(2026, 0, 15, 12, 0, 0)

  it('正常时间原样保留', () => {
    const t = now - 3 * 24 * 60 * 60 * 1000 // 三天前（另一台机器离线改的）
    expect(clampTimestamp(t, now)).toBe(t)
  })

  it('超过 5 分钟的未来时间钳到 now', () => {
    expect(clampTimestamp(now + 6 * 60 * 1000, now)).toBe(now)
  })

  it('5 分钟容差内的未来时间保留', () => {
    const t = now + 4 * 60 * 1000
    expect(clampTimestamp(t, now)).toBe(t)
  })

  it('1970 纪元值与非法值钳到 now', () => {
    expect(clampTimestamp(3600_000, now)).toBe(now)
    expect(clampTimestamp(Number.NaN, now)).toBe(now)
  })
})
