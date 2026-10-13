interface ProjectUnavailableDialogProps {
  name: string
  path: string
  error: string
  busy: boolean
  onCancel: () => void
  onLocate: () => void
  onRemove: () => void
}

export default function ProjectUnavailableDialog({
  name,
  path,
  error,
  busy,
  onCancel,
  onLocate,
  onRemove
}: ProjectUnavailableDialogProps): React.JSX.Element {
  return (
    <div className="editor-confirm-overlay">
      <div
        className="editor-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Проект недоступен"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.preventDefault()
            onCancel()
          }
          if (event.key === 'Tab') {
            const buttons =
              event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
            const first = buttons[0]
            const last = buttons[buttons.length - 1]
            if (!first) {
              event.preventDefault()
            } else if (event.shiftKey && document.activeElement === first) {
              event.preventDefault()
              last.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first.focus()
            }
          }
        }}
      >
        <h3>Проект недоступен</h3>
        <p>
          <strong>{name}</strong>
        </p>
        <p className="unavailable-project-path">{path}</p>
        <p role="alert">{error}</p>
        <p>
          Если проект перемещён, укажите папку этого же проекта. Вкладки и несохранённый текст будут
          привязаны к новому расположению.
        </p>
        <p>Удаление из списка не удаляет файлы на диске или сохранённую сессию редактора.</p>
        <div className="editor-confirm-actions unavailable-project-actions">
          <button type="button" autoFocus disabled={busy} onClick={onCancel}>
            Отмена
          </button>
          <button type="button" disabled={busy} onClick={onLocate}>
            {busy ? 'Проверка…' : 'Указать папку проекта'}
          </button>
          <button type="button" disabled={busy} onClick={onRemove}>
            Убрать из списка
          </button>
        </div>
      </div>
    </div>
  )
}
