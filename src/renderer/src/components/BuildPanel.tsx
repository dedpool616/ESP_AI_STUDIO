import { buildLabels, type BuildState } from '../../../shared/build'

export default function BuildPanel({
  state,
  onBuild,
  blocked,
  dirty
}: {
  state: BuildState | null
  onBuild: () => void
  blocked: boolean
  dirty: boolean
}): React.JSX.Element {
  return (
    <section className="build-panel" aria-label="Сборка проекта">
      <h3>Сборка проекта</h3>
      <p>Статус: {buildLabels[state?.status ?? 'idle']}</p>
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
      {state?.error && <p role="alert">{state.error}</p>}
      <pre className="build-log" tabIndex={0} aria-label="Журнал сборки">
        {state?.log || 'Журнал появится после запуска сборки.'}
      </pre>
      <small>Показываются последние 256 КБ журнала.</small>
    </section>
  )
}
