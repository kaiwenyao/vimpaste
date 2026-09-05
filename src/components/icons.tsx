import type { SVGProps } from 'react'

/**
 * 统一的线性图标集：24 视窗、currentColor 描边，随按钮文字颜色与主题变量变化。
 * 描边宽度 2.75 取自设计稿——比常见图标粗一档，才压得住大圆角与暖色底。
 * 全部 aria-hidden，可访问名称由所在按钮的 aria-label 提供。
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 15, ...rest }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.75,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: false,
    ...rest,
  }
}

export function IconHistory(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4l3 2" />
    </svg>
  )
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.4-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.8 1.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4Z" />
    </svg>
  )
}

export function IconHelp(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.6 2.6 0 1 1 3.6 2.4c-.7.3-1.1.9-1.1 1.6v.3" />
      <path d="M12 17.2h.01" />
    </svg>
  )
}

export function IconClose(props: IconProps) {
  return (
    <svg {...base({ strokeWidth: 3, ...props })}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

export function IconChevronLeft(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}

export function IconChevronRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

export function IconArrowRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

export function IconCopy(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="9" y="9" width="11" height="11" rx="3" />
      <path d="M5 15V6a2 2 0 0 1 2-2h8" />
    </svg>
  )
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base({ strokeWidth: 3.2, ...props })}>
      <path d="m4 12 5 5L20 6" />
    </svg>
  )
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4.3-4.3" />
    </svg>
  )
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function IconTrash(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
    </svg>
  )
}

export function IconShield(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3 5 6v6c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-3Z" />
    </svg>
  )
}

export function IconUser(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </svg>
  )
}

export function IconPin(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 17v5" />
      <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z" />
    </svg>
  )
}

export function IconLock(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="5" y="11" width="14" height="9" rx="2.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

export function IconCloud(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 18a4.5 4.5 0 0 1-.4-8.98A6 6 0 0 1 18.3 10.6 3.8 3.8 0 0 1 17.5 18H7Z" />
    </svg>
  )
}

export function IconDownload(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4v11M7 11l5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  )
}

export function IconTerminal(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m5 8 4 4-4 4" />
      <path d="M12 17h7" />
    </svg>
  )
}

export function IconSparkles(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4c.5 3.4 1.6 4.5 5 5-3.4.5-4.5 1.6-5 5-.5-3.4-1.6-4.5-5-5 3.4-.5 4.5-1.6 5-5Z" />
      <path d="M18.5 15.5c.25 1.6.8 2.15 2.5 2.5-1.7.35-2.25.9-2.5 2.5-.25-1.6-.8-2.15-2.5-2.5 1.7-.35 2.25-.9 2.5-2.5Z" />
    </svg>
  )
}

export function IconSync(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3" />
      <path d="M20 4v4h-4M4 20v-4h4" />
    </svg>
  )
}
