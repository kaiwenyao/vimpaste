import { useEffect, useRef, useState } from 'react'
import { createEditor } from '../editor/createEditor'
import type { EditorCallbacks } from '../editor/createEditor'

interface CodeMirrorEditorProps {
  vimEnabled: boolean
  onReady: (api: ReturnType<typeof createEditor>) => void
  callbacks: EditorCallbacks
}

export function CodeMirrorEditor({ vimEnabled, onReady, callbacks }: CodeMirrorEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const callbacksRef = useRef(callbacks)
  const onReadyRef = useRef(onReady)
  const [initialVim] = useState(vimEnabled)

  useEffect(() => {
    callbacksRef.current = callbacks
    onReadyRef.current = onReady
  })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const api = createEditor(
      host,
      {
        onDocChanged: (t) => callbacksRef.current.onDocChanged(t),
        onCursor: (l, c) => callbacksRef.current.onCursor(l, c),
        onPlaceholderCount: (n) => callbacksRef.current.onPlaceholderCount(n),
        onVimMode: (m) => callbacksRef.current.onVimMode(m),
      },
      { vim: initialVim },
    )
    onReadyRef.current(api)
    return () => api.destroy()
  }, [initialVim])

  return <div className="editor-host" ref={hostRef} />
}
