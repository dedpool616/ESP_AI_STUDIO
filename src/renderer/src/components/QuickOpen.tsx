import { useEffect, useRef, useState } from 'react'
import { filterProjectFiles } from '../../../shared/projectSearch'

export default function QuickOpen({
  projectPath,
  onClose,
  onOpen
}: {
  projectPath: string
  onClose: () => void
  onOpen: (path: string) => void
}): React.JSX.Element {
  const [files, setFiles] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [loading, setLoading] = useState(true)
  const [partial, setPartial] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const results = filterProjectFiles(files, query)
  useEffect(() => {
    let cancelled = false
    const previous = document.activeElement as HTMLElement | null
    void (async () => {
      try {
        if (typeof window.api.listProjectFiles !== 'function')
          throw new Error('Полностью перезапустите приложение для подключения быстрого поиска.')
        const response = await window.api.listProjectFiles(projectPath)
        if (cancelled) return
        if (!response.success) throw new Error(response.error ?? 'Не удалось получить файлы.')
        setFiles(response.files)
        setPartial(response.truncated)
      } catch (error) {
        if (!cancelled) setError(error instanceof Error ? error.message : 'Ошибка списка файлов.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      if (previous?.isConnected) previous.focus()
    }
  }, [projectPath])
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  return (
    <div
      className="quick-open-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="quick-open-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Быстро открыть файл"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setSelected((index) =>
              results.length
                ? (index + (event.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length
                : 0
            )
          }
          if (event.key === 'Tab') {
            event.preventDefault()
            const elements = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>('input,button')
            )
            const index = elements.indexOf(document.activeElement as HTMLElement)
            elements[
              (index + (event.shiftKey ? elements.length - 1 : 1)) % elements.length
            ]?.focus()
          }
        }}
      >
        <div className="quick-open-heading">
          <h3>Быстро открыть файл</h3>
          <button type="button" onClick={onClose} aria-label="Закрыть быстрый поиск">
            ×
          </button>
        </div>
        <input
          autoFocus
          aria-label="Имя или путь файла"
          placeholder="Введите часть имени или пути…"
          value={query}
          maxLength={256}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelected(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              if (results[selected]) onOpen(results[selected])
            }
          }}
        />
        {loading && <p role="status">Загрузка файлов…</p>}
        {error && <p role="alert">{error}</p>}
        {!loading && !error && !results.length && <p>Файлы не найдены.</p>}
        <div className="quick-open-results" ref={listRef}>
          {results.map((path, index) => (
            <button
              type="button"
              key={path}
              data-index={index}
              className={index === selected ? 'selected' : ''}
              onFocus={() => setSelected(index)}
              onClick={() => onOpen(path)}
            >
              {path}
            </button>
          ))}
        </div>
        <small>
          ↑ ↓ — выбор · Enter — открыть · Esc — закрыть. До 100 результатов.
          {partial && ' Список проекта ограничен или часть папок недоступна.'}
        </small>
      </div>
    </div>
  )
}
