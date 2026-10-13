import { useEffect, useRef } from 'react'

interface RecentProjectMenuProps {
  x: number
  y: number
  trigger: HTMLButtonElement
  onClose: () => void
  onRemove: () => void
}

export default function RecentProjectMenu({
  x,
  y,
  trigger,
  onClose,
  onRemove
}: RecentProjectMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const dismiss = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    const close = (): void => onClose()
    document.addEventListener('pointerdown', dismiss, true)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [onClose])

  return (
    <div
      ref={menuRef}
      className="recent-project-menu"
      role="menu"
      aria-label="Действия с проектом"
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - 208)),
        top: Math.max(8, Math.min(y, window.innerHeight - 64))
      }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault()
          onClose()
          trigger.focus()
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault()
        }
      }}
    >
      <button type="button" role="menuitem" autoFocus onClick={onRemove}>
        Убрать проект
      </button>
    </div>
  )
}
