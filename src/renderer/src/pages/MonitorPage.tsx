import { useEffect, useState } from 'react'
import { monitorBaudRates, type MonitorState } from '../../../shared/monitor'
import type { SerialPortInfo } from '../../../shared/build'

export default function MonitorPage({
  target,
  blocked
}: {
  target: string
  blocked: boolean
}): React.JSX.Element {
  const [state, setState] = useState<MonitorState>({
    status: 'disconnected',
    port: '',
    baud: 115200,
    log: ''
  })
  const [ports, setPorts] = useState<SerialPortInfo[]>([])
  const [port, setPort] = useState('')
  const [baud, setBaud] = useState(115200)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = state.status === 'connected' || state.status === 'connecting'
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const poll = async (): Promise<void> => {
      try {
        const result = await window.api.getMonitorState()
        if (!cancelled) setState(result)
      } catch {
        if (!cancelled) setError('Не удалось получить состояние монитора.')
      }
      if (!cancelled)
        timer = window.setTimeout(() => {
          void poll()
        }, 400)
    }
    void poll()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])
  const action = async (callback: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await callback()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Ошибка операции.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="build-panel">
      <h2>Serial Monitor</h2>
      <p>Сообщения устройства в UTF-8. Перед прошивкой отключите монитор.</p>
      <div className="flash-controls">
        <label>
          COM-порт{' '}
          <select
            aria-label="Порт монитора"
            value={port}
            disabled={busy || active}
            onChange={(event) => setPort(event.target.value)}
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
          className="build-project-button"
          disabled={busy || blocked || active || !target}
          onClick={() => {
            void action(async () => {
              const result = await window.api.listPorts(target)
              if (!result.success) throw new Error(result.error)
              setPorts(result.ports)
              setPort((previous) =>
                result.ports.some((item) => item.device === previous) ? previous : ''
              )
              if (!result.ports.length) setError('COM-порты не найдены. Подключите плату.')
            })
          }}
        >
          Обновить порты
        </button>
        <label>
          Скорость{' '}
          <select
            aria-label="Скорость монитора"
            value={baud}
            disabled={busy || active}
            onChange={(event) => setBaud(Number(event.target.value))}
          >
            {monitorBaudRates.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <button
          className="build-project-button"
          disabled={busy || blocked || active || !port || !target}
          onClick={() => {
            void action(async () => {
              const result = await window.api.startMonitor(target, port, baud)
              if (!result.success) throw new Error(result.error)
              setState(await window.api.getMonitorState())
            })
          }}
        >
          Подключить
        </button>
        <button
          className="monitor-red-button"
          disabled={busy || !active}
          onClick={() => {
            void action(async () => {
              setState(await window.api.stopMonitor())
            })
          }}
        >
          Отключить
        </button>
        <button
          className="monitor-red-button"
          disabled={busy}
          onClick={() => {
            void action(async () => {
              setState(await window.api.clearMonitor())
            })
          }}
        >
          Очистить вывод
        </button>
      </div>
      <p>
        Статус:{' '}
        {
          {
            disconnected: 'Отключён',
            connecting: 'Подключение…',
            connected: 'Подключён',
            error: 'Ошибка'
          }[state.status]
        }{' '}
        {active && `— ${state.port}, ${state.baud} бод`}
      </p>
      {!target && <p>Откройте проект с выбранной платой.</p>}
      {(error || state.error) && <p role="alert">{error || state.error}</p>}
      <pre className="build-log" tabIndex={0} aria-label="Вывод устройства">
        {state.log || 'Сообщений пока нет.'}
      </pre>
      <small>Последние 256 КБ. При переходе на другую страницу соединение сохраняется.</small>
    </section>
  )
}
