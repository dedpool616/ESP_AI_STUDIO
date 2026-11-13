import { useEffect, useState } from 'react'
import type { ActivityEntry } from '../../../shared/activity'

const labels = {
  success: 'Успешно',
  error: 'Ошибка',
  running: 'Запущено',
  cancelled: 'Остановлено'
}
export default function ActivityPage({ projectPath }: { projectPath?: string }): React.JSX.Element {
  const [allProjects, setAllProjects] = useState(false)
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [status, setStatus] = useState('Загрузка истории…')
  const [warning, setWarning] = useState('')
  const [error, setError] = useState('')
  const [errorsOnly, setErrorsOnly] = useState(false)
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const refresh = async (): Promise<void> => {
      try {
        if (typeof window.api.getActivity !== 'function')
          throw new Error('Полностью перезапустите приложение для подключения истории действий.')
        const result = await window.api.getActivity(allProjects ? undefined : projectPath)
        if (cancelled) return
        if (!result.success) throw new Error(result.error ?? 'Не удалось прочитать историю.')
        setEntries(result.entries)
        setWarning(result.warning ?? '')
        setError('')
        setStatus('')
      } catch (error) {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : 'Ошибка истории.')
          setStatus('')
        }
      }
      if (!cancelled)
        timer = window.setTimeout(() => {
          void refresh()
        }, 1500)
    }
    void refresh()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [projectPath, allProjects])
  const visible = entries.filter((entry) => !errorsOnly || entry.status === 'error')
  return (
    <section className="activity-page">
      <h2>Activity — история действий</h2>
      <p>
        Последние 500 действий. История ведётся с момента добавления этой функции и сохраняется
        между запусками.
      </p>
      <div className="activity-filters">
        <label>
          <input
            type="checkbox"
            checked={allProjects}
            disabled={!projectPath}
            onChange={(event) => setAllProjects(event.target.checked)}
          />{' '}
          Все проекты
        </label>
        <label>
          <input
            type="checkbox"
            checked={errorsOnly}
            onChange={(event) => setErrorsOnly(event.target.checked)}
          />{' '}
          Только ошибки
        </label>
      </div>
      <p>{allProjects || !projectPath ? 'Показана история всех проектов.' : projectPath}</p>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
      {warning && <p role="alert">{warning}</p>}
      {!status && !error && !visible.length && <p>Действий для этого фильтра пока нет.</p>}
      <ol className="activity-list">
        {visible.map((entry) => (
          <li key={entry.id} className={`activity-entry activity-${entry.status}`}>
            <div>
              <time dateTime={entry.time}>{new Date(entry.time).toLocaleString('ru-RU')}</time>{' '}
              <strong>{entry.action}</strong> <span>{labels[entry.status]}</span>
            </div>
            {(allProjects || !projectPath) && <p>{entry.projectPath}</p>}
            {entry.relativePath && <p>{entry.relativePath}</p>}
            {entry.message && <p>{entry.message}</p>}
          </li>
        ))}
      </ol>
    </section>
  )
}
