import { useEffect, useRef } from 'react'
import { DiffEditor } from '@monaco-editor/react'

export interface FileComparison {
  projectPath: string
  relativePath: string
  original: string | null
  modified: string
  language: string
}

export default function FileCompareDialog({
  comparison,
  onClose
}: {
  comparison: FileComparison
  onClose: () => void
}): React.JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
      if (event.key === 'Tab' && !event.altKey && !event.ctrlKey) {
        // Keep Tab within the read-only comparison, which has one application action.
        event.preventDefault()
        closeRef.current?.focus()
      }
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [onClose])
  const base = `espai-diff://${encodeURIComponent(comparison.projectPath)}/${encodeURIComponent(comparison.relativePath)}`
  return (
    <div className="file-compare-overlay">
      <section
        className="file-compare-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Сравнение версий файла"
      >
        <header className="file-compare-header">
          <div>
            <h3>Сравнение версий</h3>
            <p>{comparison.relativePath}</p>
          </div>
          <button ref={closeRef} type="button" className="build-project-button" onClick={onClose}>
            Закрыть · Esc
          </button>
        </header>
        <p>
          Только просмотр: файлы и текст вкладки не меняются. Это снимок на момент открытия; для
          обновления закройте и откройте сравнение снова.
        </p>
        <div className="file-compare-labels">
          <strong>На диске{comparison.original === null ? ' — файл удалён' : ''}</strong>
          <strong>Текст вкладки</strong>
        </div>
        <div className="file-compare-editor">
          <DiffEditor
            height="100%"
            original={comparison.original ?? ''}
            modified={comparison.modified}
            language={comparison.language}
            originalModelPath={`${base}/disk`}
            modifiedModelPath={`${base}/buffer`}
            keepCurrentOriginalModel={false}
            keepCurrentModifiedModel={false}
            theme="vs-dark"
            loading="Загрузка сравнения…"
            options={{
              readOnly: true,
              originalEditable: false,
              renderSideBySide: true,
              useInlineViewWhenSpaceIsLimited: false,
              automaticLayout: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false
            }}
          />
        </div>
        <small>
          Подсвечены отличающиеся строки. Чтобы выбрать версию, закройте сравнение и используйте
          действия уведомления.
        </small>
      </section>
    </div>
  )
}
