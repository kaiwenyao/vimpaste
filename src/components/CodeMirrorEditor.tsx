import { useEffect, useRef, useState } from 'react'
import { createEditor } from '../editor/createEditor'
import type { EditorCallbacks } from '../editor/createEditor'
import type { EditorMode } from '../editor/editorMode'

interface CodeMirrorEditorProps {
  editorMode: EditorMode
  onReady: (api: ReturnType<typeof createEditor>) => void
  callbacks: EditorCallbacks
}

export function CodeMirrorEditor({ editorMode, onReady, callbacks }: CodeMirrorEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const callbacksRef = useRef(callbacks)
  const onReadyRef = useRef(onReady)
  const [initialMode] = useState(editorMode)

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
        onPaste: () => callbacksRef.current.onPaste?.(),
      },
      { editorMode: initialMode },
    )
    onReadyRef.current(api)
    return () => api.destroy()
  }, [initialMode])

  return <div className="editor-host" ref={hostRef} />
}
