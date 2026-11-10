import { useEffect, useRef, useState } from 'react'
import type { SearchMatch, SearchResult } from '../../../shared/projectSearch'

export default function ProjectSearchPage({
  projectPath,
  onOpen,
  blocked,
  active
}: {
  projectPath: string
  onOpen: (match: SearchMatch) => void
  blocked: boolean
  active: boolean
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const mounted = useRef(true)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (active && !blocked) inputRef.current?.focus()
  }, [active, blocked])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const search = async (): Promise<void> => {
    if (pending.current || !query.trim() || !projectPath) return
    pending.current = true
    setBusy(true)
    setError('')
    setResult(null)
    try {
      if (typeof window.api.searchProject !== 'function') {
        throw new Error(
          'Поиск ещё не подключён в текущем окне. Полностью закройте ESP AI Studio и запустите приложение заново: после обновления требуется перезапуск основной части и preload.'
        )
      }
      const response = await window.api.searchProject({ projectPath, query, caseSensitive })
      if (!mounted.current) return
      if (!response.success) throw new Error(response.error ?? 'Не удалось выполнить поиск.')
      setResult(response)
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : 'Ошибка поиска.')
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <section className="project-search">
      <h2>Поиск по проекту</h2>
      <p>
        Поиск сохранённых текстовых файлов. Несохранённые изменения редактора в результаты не
        входят.
      </p>
      <form
        className="project-search-form"
        onSubmit={(event) => {
          event.preventDefault()
          void search()
        }}
      >
        <label>
          Текст для поиска
          <input
            type="search"
            ref={inputRef}
            maxLength={256}
            value={query}
            disabled={busy}
            onChange={(event) => {
              setQuery(event.target.value)
              setResult(null)
              setError('')
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={caseSensitive}
            disabled={busy}
            onChange={(event) => {
              setCaseSensitive(event.target.checked)
              setResult(null)
            }}
          />{' '}
          Учитывать регистр
        </label>
        <button type="submit" className="build-project-button" disabled={busy || !query.trim()}>
          {busy ? 'Поиск…' : 'Найти'}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {result && (
        <>
          <p role="status">
            Совпадений: {result.matches.length}. Проверено файлов: {result.scanned}. Пропущено:{' '}
            {result.skipped}.
          </p>
          {result.truncated && (
            <p>
              Показан ограниченный результат. Уточните запрос: до 500 совпадений, 5000 файлов, 32
              МиБ и 10 секунд поиска.
            </p>
          )}
          {!result.matches.length && <p>Совпадений не найдено в проверенных файлах.</p>}
          <div className="project-search-results">
            {result.matches.map((match, index) => (
              <button
                type="button"
                key={`${match.relativePath}:${match.line}:${match.column}:${index}`}
                disabled={blocked}
                className="project-search-result"
                onClick={() => onOpen(match)}
              >
                <strong>
                  {match.relativePath}:{match.line}:{match.column}
                </strong>
                <code>{match.snippet}</code>
              </button>
            ))}
          </div>
        </>
      )}
      <small>
        Без регулярных выражений. Служебные каталоги, ссылки, бинарные файлы, файлы больше 2 МиБ и
        кодировки кроме UTF-8 пропускаются.
      </small>
    </section>
  )
}
