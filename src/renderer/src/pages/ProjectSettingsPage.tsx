import { useEffect, useState } from 'react'
import { checkTargets, isCheckTarget, type IdfInstallation } from '../../../shared/environment'

export default function ProjectSettingsPage({
  path,
  board,
  blocked,
  onBusy,
  onSaved
}: {
  path: string
  board: string
  blocked: boolean
  onBusy: (busy: boolean) => void
  onSaved: (backup: boolean) => Promise<void>
}): React.JSX.Element {
  const [target, setTarget] = useState(board)
  const [idfPath, setIdfPath] = useState('')
  const [installations, setInstallations] = useState<IdfInstallation[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [backup, setBackup] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => {
    let cancelled = false
    void Promise.all([
      window.api.getProjectSettings(path),
      window.api.checkEnvironment(isCheckTarget(board) ? board : 'esp32s3')
    ])
      .then(([settings, environment]) => {
        if (cancelled) return
        if (!settings.success || !settings.settings)
          throw new Error(settings.error ?? 'Ошибка чтения настроек.')
        setTarget(settings.settings.board || board)
        setIdfPath(settings.settings.idfPath ?? '')
        if (environment.success && environment.report)
          setInstallations(environment.report.installations)
        else setError(environment.error ?? 'Не удалось получить установки SDK.')
      })
      .catch((error) => {
        if (!cancelled) setError(error instanceof Error ? error.message : 'Ошибка загрузки.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [path, board])
  const save = async (): Promise<void> => {
    if (!isCheckTarget(target) || blocked || saving || loading) return
    setSaving(true)
    onBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await window.api.saveProjectSettings({
        projectPath: path,
        board: target,
        idfPath: idfPath || null,
        backupBuild: backup
      })
      if (!result.success) throw new Error(result.error ?? 'Ошибка сохранения.')
      await onSaved(backup)
      setMessage(
        result.backupPath
          ? `Настройки сохранены. Резервные файлы: ${result.backupPath}`
          : 'Настройки сохранены.'
      )
      setBackup(false)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Ошибка сохранения.')
    } finally {
      setSaving(false)
      onBusy(false)
    }
  }
  return (
    <section className="build-panel">
      <h2>Настройки проекта</h2>
      <p>{path}</p>
      {loading && <p>Загрузка настроек…</p>}
      <label className="form-field">
        Плата
        <select
          value={target}
          disabled={blocked || saving || loading}
          onChange={(event) => {
            setTarget(event.target.value)
            setMessage('')
          }}
        >
          <option value="">Выберите плату</option>
          {checkTargets.map((value) => (
            <option key={value} value={value}>
              {value.toUpperCase()}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        Установка ESP-IDF для этого проекта
        <select
          value={idfPath}
          disabled={blocked || saving || loading}
          onChange={(event) => {
            setIdfPath(event.target.value)
            setMessage('')
          }}
        >
          <option value="">Использовать выбор из ESP-IDF Manager</option>
          {idfPath && !installations.some((sdk) => sdk.path === idfPath) && (
            <option value={idfPath}>{idfPath} — сохранённый путь</option>
          )}
          {installations.map((sdk) => (
            <option key={sdk.path} value={sdk.path}>
              {sdk.version ?? 'ESP-IDF'} — {sdk.path}
            </option>
          ))}
        </select>
      </label>
      <p>
        Если установки нет в списке, добавьте её через ESP-IDF Manager и откройте настройки снова.
      </p>
      <label>
        <input
          type="checkbox"
          checked={backup}
          disabled={blocked || saving || loading}
          onChange={(event) => setBackup(event.target.checked)}
        />{' '}
        Подготовить новую сборку: переместить sdkconfig, sdkconfig.old и build в резервную папку
        .espai/backups.
      </label>
      <p>
        При смене платы резервное копирование обязательно, если sdkconfig уже настроен на другую
        плату. Настройки sdkconfig будут созданы заново; исходники сохранятся.
      </p>
      {blocked && !saving && (
        <p>Сначала сохраните файлы и дождитесь завершения текущей операции.</p>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button
        type="button"
        className="build-project-button"
        disabled={blocked || saving || loading || !isCheckTarget(target)}
        onClick={() => {
          void save()
        }}
      >
        {saving ? 'Сохранение…' : 'Сохранить настройки'}
      </button>
    </section>
  )
}
