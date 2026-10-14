import { useCallback, useEffect, useRef, useState } from 'react'
import type { EnvironmentReport, EnvironmentResult } from '../../../shared/environment'

// React StrictMode can mount twice. Share only the in-flight read-only check.
let pendingCheck: Promise<EnvironmentResult> | null = null
function readEnvironment(): Promise<EnvironmentResult> {
  pendingCheck ??= window.api.checkEnvironment().finally(() => {
    pendingCheck = null
  })
  return pendingCheck
}

export default function EnvironmentPage(): React.JSX.Element {
  const [report, setReport] = useState<EnvironmentReport | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const busyRef = useRef(true)

  const run = useCallback(async (action: () => Promise<EnvironmentResult>): Promise<void> => {
    if (busyRef.current) return
    const request = generation.current
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const result = await action()
      if (request !== generation.current || result.canceled) return
      if (result.success && result.report) setReport(result.report)
      else setError(result.error ?? 'Не удалось проверить окружение.')
    } catch (error) {
      if (request === generation.current)
        setError(error instanceof Error ? error.message : 'Не удалось проверить окружение.')
    } finally {
      if (request === generation.current) {
        busyRef.current = false
        setBusy(false)
      }
    }
  }, [])

  useEffect(() => {
    let canceled = false
    const request = ++generation.current
    busyRef.current = true
    void readEnvironment()
      .then(
        (result) => {
          if (canceled) return
          if (result.success && result.report) setReport(result.report)
          else setError(result.error ?? 'Не удалось проверить окружение.')
        },
        (error: unknown) => {
          if (!canceled)
            setError(error instanceof Error ? error.message : 'Не удалось проверить окружение.')
        }
      )
      .finally(() => {
        if (!canceled) {
          busyRef.current = false
          setBusy(false)
        }
      })
    return () => {
      canceled = true
      generation.current = request + 1
      busyRef.current = false
    }
  }, [])

  return (
    <section className="environment-page">
      <h2>ESP-IDF Manager</h2>
      <p>Проверка установленного ESP-IDF и инструментов разработки.</p>
      <div className="environment-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void run(readEnvironment)
          }}
        >
          {busy ? 'Проверка…' : 'Проверить окружение'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void run(() => window.api.chooseIdf())
          }}
        >
          Указать папку ESP-IDF
        </button>
      </div>
      {busy && <p role="status">Чтение конфигурации и проверка версий инструментов…</p>}
      {error && (
        <div className="project-form-error" role="alert">
          {error}
        </div>
      )}
      {report && (
        <>
          <div className={`environment-summary ${report.basicToolsAvailable ? 'available' : ''}`}>
            <strong>
              {report.basicToolsAvailable
                ? 'Базовые компоненты найдены'
                : 'Окружение требует внимания'}
            </strong>
            <p>
              Проверена доступность инструментов. Полная готовность к сборке ещё не подтверждена:
              совместимость версий, Python-пакеты и компилятор ESP32 будут проверяться следующим
              этапом.
            </p>
            <small>Последняя проверка: {new Date(report.checkedAt).toLocaleString('ru-RU')}</small>
          </div>
          <label className="form-field environment-selection">
            <span>Выбор установки ESP-IDF</span>
            <select
              disabled={busy}
              value={report.selectedPath ?? '__auto__'}
              onChange={(event) => {
                const path = event.target.value === '__auto__' ? null : event.target.value
                void run(() => window.api.selectIdf(path))
              }}
            >
              <option value="__auto__">Автоматический поиск</option>
              {report.selectedPath &&
                !report.installations.some((item) => item.path === report.selectedPath) && (
                  <option value={report.selectedPath}>
                    Недоступная установка: {report.selectedPath}
                  </option>
                )}
              {report.installations.map((installation) => (
                <option key={installation.path} value={installation.path}>
                  {installation.version ? `v${installation.version}` : 'Версия неизвестна'} —{' '}
                  {installation.path}
                </option>
              ))}
            </select>
            <small>Выбор сохраняется между запусками приложения.</small>
          </label>
          <div className="environment-card">
            <h3>
              ESP-IDF{' '}
              <span
                className={`environment-badge ${report.idf.status === 'found' ? 'found' : 'error'}`}
              >
                {report.idf.status === 'found'
                  ? 'Найден'
                  : report.idf.status === 'invalid'
                    ? 'Папка недоступна'
                    : 'Не найден'}
              </span>
            </h3>
            {report.idf.version && <p>Версия: {report.idf.version}</p>}
            {report.idf.path && <p className="environment-path">{report.idf.path}</p>}
            <p>{report.idf.detail}</p>
            {report.idf.source && <small>Источник: {report.idf.source}</small>}
          </div>
          <div className="environment-tool-grid">
            {report.tools.map((tool) => (
              <div className="environment-card" key={tool.name}>
                <h3>
                  {{ python: 'Python', git: 'Git', cmake: 'CMake', ninja: 'Ninja' }[tool.name]}
                  <span className={`environment-badge ${tool.status}`}>
                    {tool.status === 'found'
                      ? 'Найден'
                      : tool.status === 'missing'
                        ? 'Не найден'
                        : 'Ошибка проверки'}
                  </span>
                </h3>
                {tool.version && <p>Версия: {tool.version}</p>}
                {tool.path && <p className="environment-path">{tool.path}</p>}
                <p>{tool.detail}</p>
                {tool.source && <small>Источник: {tool.source}</small>}
              </div>
            ))}
          </div>
          {report.warnings.length > 0 && (
            <div className="environment-summary" role="status">
              {report.warnings.map((warning, index) => (
                <p key={index}>{warning}</p>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
