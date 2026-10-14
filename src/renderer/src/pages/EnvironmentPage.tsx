import { useCallback, useEffect, useRef, useState } from 'react'
import type { EnvironmentReport, EnvironmentResult } from '../../../shared/environment'
import {
  checkTargets,
  isCheckTarget,
  type CheckTarget,
  type DependencyCheck
} from '../../../shared/environment'

// React StrictMode can mount twice. Share only the in-flight read-only check.
const pendingChecks = new Map<CheckTarget, Promise<EnvironmentResult>>()
function readEnvironment(target: CheckTarget): Promise<EnvironmentResult> {
  let pending = pendingChecks.get(target)
  if (!pending) {
    pending = window.api.checkEnvironment(target).finally(() => {
      pendingChecks.delete(target)
    })
    pendingChecks.set(target, pending)
  }
  return pending
}

const targetNames: Record<CheckTarget, string> = {
  esp32: 'ESP32',
  esp32s2: 'ESP32-S2',
  esp32s3: 'ESP32-S3',
  esp32c3: 'ESP32-C3',
  esp32c6: 'ESP32-C6'
}

function DependencyCard({
  title,
  check
}: {
  title: string
  check: DependencyCheck
}): React.JSX.Element {
  const labels = {
    passed: 'Пройдена',
    partial: 'Частично',
    missing: 'Не найдено',
    error: 'Ошибка',
    skipped: 'Не проверено'
  }
  return (
    <div className="environment-card">
      <h3>
        {title}
        <span
          className={`environment-badge ${check.status === 'passed' ? 'found' : check.status === 'error' ? 'error' : 'missing'}`}
        >
          {labels[check.status]}
        </span>
      </h3>
      <p>{check.detail}</p>
      {check.version && <p>Версия: {check.version}</p>}
      {check.path && <p className="environment-path">{check.path}</p>}
      {!!check.expectedVersions?.length && (
        <p>Поддерживаемые версии SDK: {check.expectedVersions.join(', ')}</p>
      )}
      {check.diagnostics && <pre className="environment-diagnostics">{check.diagnostics}</pre>}
    </div>
  )
}

export default function EnvironmentPage({
  projectTarget
}: { projectTarget?: string } = {}): React.JSX.Element {
  const [target, setTarget] = useState<CheckTarget>(
    isCheckTarget(projectTarget) ? projectTarget : 'esp32s3'
  )
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
    void readEnvironment(target)
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
  }, [target])

  return (
    <section className="environment-page">
      <h2>ESP-IDF Manager</h2>
      <p>Проверка установленного ESP-IDF и инструментов разработки.</p>
      <label className="form-field environment-selection">
        <span>Плата для проверки</span>
        <select
          disabled={busy}
          value={target}
          onChange={(event) => {
            if (isCheckTarget(event.target.value)) {
              setBusy(true)
              setError('')
              setTarget(event.target.value)
            }
          }}
        >
          {checkTargets.map((value) => (
            <option key={value} value={value}>
              {targetNames[value]}
            </option>
          ))}
        </select>
        <small>
          Плата берётся из проекта, если выбрана; иначе используется ESP32-S3. Этот выбор относится
          к проверке окружения.
        </small>
      </label>
      <div className="environment-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void run(() => readEnvironment(target))
          }}
        >
          {busy ? 'Проверка…' : 'Проверить окружение'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void run(() => window.api.chooseIdf(target))
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
          <div
            className={`environment-summary ${report.readiness?.target === target && report.readiness.dependenciesPassed ? 'available' : ''}`}
          >
            <strong>
              {report.readiness?.target === target && report.readiness.dependenciesPassed
                ? 'Проверенные зависимости готовы'
                : report.basicToolsAvailable
                  ? 'Базовые компоненты найдены'
                  : 'Окружение требует внимания'}
            </strong>
            <p>
              Проверяются основные Python-пакеты, компилятор выбранной платы и версии CMake/Ninja по
              требованиям SDK. Пробная сборка ещё не выполнялась; дополнительные инструменты,
              включая ULP, будут проверяться при подключении сборки.
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
                void run(() => window.api.selectIdf(path, target))
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
          {report.readiness && report.readiness.target === target && (
            <>
              <h3>Проверка зависимостей для {targetNames[report.readiness.target]}</h3>
              {report.readiness.pythonPackages.constraintsPath && (
                <p className="environment-path">
                  Ограничения Python: {report.readiness.pythonPackages.constraintsPath}
                </p>
              )}
              <div className="environment-tool-grid">
                <DependencyCard
                  title="Python-пакеты ESP-IDF"
                  check={report.readiness.pythonPackages}
                />
                <DependencyCard
                  title={`Основной компилятор ${targetNames[report.readiness.target]}`}
                  check={report.readiness.compiler}
                />
                {report.readiness.buildTools.map((tool) => (
                  <DependencyCard
                    key={tool.name}
                    title={`Совместимость ${tool.name === 'cmake' ? 'CMake' : 'Ninja'}`}
                    check={tool}
                  />
                ))}
              </div>
            </>
          )}
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
