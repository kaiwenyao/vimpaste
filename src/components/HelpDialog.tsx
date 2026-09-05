import type { ReactNode } from 'react'
import { Dialog } from './Dialog'
import { IconShield } from './icons'

function Row({ keys, desc }: { keys: string; desc: string }) {
  return (
    <div className="help-row">
      <kbd>{keys}</kbd>
      <span>{desc}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="help-section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="快捷键与使用帮助" closeLabel="关闭帮助">
      <Section title="核心流程">
        <p className="help-flow">
          <span>粘贴命令</span>
          <span aria-hidden="true">→</span>
          <kbd>]v</kbd>
          <span>跳到变量</span>
          <span aria-hidden="true">→</span>
          <kbd>c</kbd>
          <span>修改</span>
          <span aria-hidden="true">→</span>
          <kbd>⌘↵</kbd>
          <span>复制</span>
        </p>
      </Section>
      <Section title="占位符与通用">
        <Row keys="]v" desc="跳到下一个占位符（并选中，可直接替换）" />
        <Row keys="[v" desc="跳到上一个占位符" />
        <Row keys="Ctrl/Cmd+F" desc="搜索（工具栏 ‹ › 按钮也可跳转占位符）" />
        <Row keys="Ctrl/Cmd+Enter" desc="复制全部内容（编辑器聚焦时）" />
        <Row keys="Ctrl/Cmd+S" desc="保存到片段库（唯一的保存入口，不会自动保存）" />
        <Row keys="Esc" desc="关闭本面板" />
      </Section>
      <Section title="Vim 模式（在设置中切换）">
        <Row keys="h j k l" desc="移动；w/b/e 词级移动；0/$ 行首/行尾；gg/G 文件首/尾" />
        <Row keys="f{char} / t{char}" desc="行内查找字符 / 查找前一个字符" />
        <Row keys="i a o" desc="插入（前/后/下一行）；Esc 返回 Normal" />
        <Row keys="x r" desc="删除字符 / 替换字符" />
        <Row keys="d c y" desc="删除/修改/复制，可搭配 w、iw、f{char} 等" />
        <Row keys="/ 与 ?" desc="向下/向上搜索；n/N 下一个/上一个匹配" />
        <Row keys="u / Ctrl+r" desc="撤销 / 重做" />
        <Row keys="v / V" desc="字符/行可视模式" />
      </Section>
      <Section title="Emacs 模式（在设置中切换）">
        <Row keys="Ctrl+a / Ctrl+e" desc="行首 / 行尾" />
        <Row keys="Ctrl+k" desc="删除光标到行尾" />
        <Row keys="Ctrl+b / Ctrl+f" desc="后退 / 前进一个字符" />
        <Row keys="Meta+b / Meta+f" desc="后退 / 前进一个词" />
        <p className="help-note">
          普通编辑器模式下按系统标准行为处理按键。浏览器刷新、关闭标签页等系统快捷键不受影响。
        </p>
      </Section>
      <Section title="隐私">
        <div className="help-privacy">
          <span className="help-privacy-mark" aria-hidden="true">
            <IconShield size={16} />
          </span>
          <p>
            无后端、无账号、无统计。编辑与识别全在本机完成；只有偏好与手动保存的片段写入本浏览器。
            <br />
            <span className="en">No backend, no account, no analytics.</span>
          </p>
        </div>
        <p className="help-note">
          VimPaste
          完全在你的浏览器本地运行：编辑、语言识别、占位符标记与高亮全部在本机完成，没有后端服务器。
          编辑内容不会写入 URL，也不会发送到网络。没有任何自动保存——只有点「保存」（
          Ctrl/Cmd+S）才会把内容存进片段库；未保存的内容在刷新或关闭页面后即消失。
          已保存的片段可以在「已保存」页面查看详情、搜索与删除。
          键位模式、字号等非敏感偏好同样只保存在本机。
          浏览器扩展或操作系统级剪贴板同步工具不在本应用控制范围内。
        </p>
      </Section>
    </Dialog>
  )
}
