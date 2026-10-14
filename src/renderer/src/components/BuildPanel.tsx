import { useState } from 'react'
import { buildLabels, type BuildState, type SerialPortInfo } from '../../../shared/build'

export default function BuildPanel({
  state,
  onBuild,
  onFlash,
  target,
  blocked,
  dirty
}: {
  state: BuildState | null
  onBuild: () => void
  onFlash: (port: string) => void
  target: string
  blocked: boolean
  dirty: boolean
}): React.JSX.Element {
  const [ports, setPorts] = useState<SerialPortInfo[]>([])
  const [port, setPort] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const refresh = async (): Promise<void> => {
    if (loading) return
    setLoading(true)
    setConfirm(false)
    setError('')
    try {
      const result = await window.api.listPorts(target)
      if (!result.success) throw new Error(result.error ?? 'Ошибка поиска портов.')
      setPorts(result.ports)
      setPort((previous) => (result.ports.some((item) => item.device === previous) ? previous : ''))
    } catch (error) {
      setPorts([])
      setPort('')
      setError(error instanceof Error ? error.message : 'Ошибка поиска портов.')
    } finally {
      setLoading(false)
    }
  }
  return (
    <section className="build-panel" aria-label="Сборка проекта">
      <h3>Сборка проекта</h3>
      <p>
        Статус:{' '}
        {state?.status === 'running' && state.operation === 'flash'
          ? 'Прошивка…'
          : buildLabels[state?.status ?? 'idle']}
      </p>
      <p>Собираются файлы с диска. Прошивка платы не выполняется.</p>
      {dirty && (
        <p role="alert">
          Есть несохранённые изменения. Откройте Code Editor и нажмите «Сохранить всё» перед
          сборкой.
        </p>
      )}
      <button
        className={`build-project-button${state?.status === 'running' ? ' is-building' : ''}`}
        type="button"
        disabled={blocked || dirty || state?.status === 'running'}
        onClick={onBuild}
      >
        Собрать проект
      </button>
      <div className="flash-controls">
        <h3>Прошивка платы</h3>
        <label>
          COM-порт
          <select
            aria-label="COM-порт"
            value={port}
            disabled={blocked || loading}
            onChange={(event) => {
              setPort(event.target.value)
              setConfirm(false)
            }}
          >
            <option value="">Выберите порт</option>
            {ports.map((item) => (
              <option key={item.device} value={item.device}>
                {item.device} — {item.description}
              </option>
            ))}
          </select>
        </label>
        <button
          className={`build-project-button${loading ? ' is-building' : ''}`}
          type="button"
          disabled={blocked || loading}
          onClick={() => {
            void refresh()
          }}
        >
          {loading ? 'Поиск портов…' : 'Обновить порты'}
        </button>
        {!loading && ports.length === 0 && (
          <p>
            Нажмите «Обновить порты». Если список пуст, подключите плату USB-кабелем с передачей
            данных.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <button
          type="button"
          className="build-project-button"
          disabled={blocked || dirty || loading || !port}
          onClick={() => setConfirm(true)}
        >
          Прошить
        </button>
        {confirm && (
          <div className="flash-confirm">
            <p>
              Записать прошивку этого проекта на {port} ({target.toUpperCase()})? Существующая
              программа на плате будет заменена. ESP-IDF сначала обновит сборку при необходимости.
            </p>
            <button type="button" onClick={() => setConfirm(false)}>
              Отмена
            </button>
            <button
              type="button"
              disabled={blocked || dirty || loading || !port}
              onClick={() => {
                setConfirm(false)
                onFlash(port)
              }}
            >
              Подтвердить прошивку
            </button>
          </div>
        )}
      </div>
      {state?.error && <p role="alert">{state.error}</p>}
      <pre className="build-log" tabIndex={0} aria-label="Журнал сборки">
        {state?.log || 'Журнал появится после запуска сборки.'}
      </pre>
      <small>Показываются последние 256 КБ журнала.</small>
    </section>
  )
}
