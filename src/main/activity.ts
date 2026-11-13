import type { IpcMain } from 'electron'
import { mkdir, readFile, writeFile, rename, stat } from 'fs/promises'
import { join, isAbsolute } from 'path'
import { randomUUID } from 'crypto'
import type { ActivityEntry, ActivityResult } from '../shared/activity'

type Draft = Omit<ActivityEntry, 'id' | 'time'>
export function createActivityStore(directory: string): {
  record: (entry: Draft) => Promise<void>
  list: (projectPath?: string) => Promise<ActivityResult>
  flush: () => Promise<void>
} {
  let entries: ActivityEntry[] = []
  let warning: string | undefined
  let blocked = false
  let queue = Promise.resolve()
  const file = join(directory, 'activity.json')
  const ready = (async (): Promise<void> => {
    try {
      if ((await stat(file)).size > 8 * 1024 * 1024)
        throw new Error('Слишком большой файл истории.')
      const parsed = JSON.parse(await readFile(file, 'utf8'))
      if (!Array.isArray(parsed)) throw new Error('Некорректный формат истории.')
      entries = parsed
        .filter(
          (entry): entry is ActivityEntry =>
            entry &&
            typeof entry.id === 'string' &&
            typeof entry.time === 'string' &&
            typeof entry.projectPath === 'string' &&
            typeof entry.action === 'string' &&
            ['success', 'error', 'running', 'cancelled'].includes(entry.status) &&
            (entry.relativePath === undefined || typeof entry.relativePath === 'string') &&
            (entry.message === undefined || typeof entry.message === 'string')
        )
        .slice(0, 500)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        blocked = true
        warning =
          'Не удалось прочитать сохранённую историю. Новые записи доступны только в этом сеансе; исходный файл не перезаписан.'
      }
    }
  })()
  return {
    flush: async (): Promise<void> => {
      await ready
      await queue
    },
    record: async (draft): Promise<void> => {
      await ready
      const entry: ActivityEntry = {
        id: randomUUID(),
        time: new Date().toISOString(),
        projectPath: draft.projectPath.slice(0, 4096),
        action: draft.action.slice(0, 120),
        status: draft.status,
        ...(draft.relativePath ? { relativePath: draft.relativePath.slice(0, 4096) } : {}),
        ...(draft.message ? { message: draft.message.slice(0, 1000) } : {})
      }
      entries = [entry, ...entries].slice(0, 500)
      if (blocked) return
      const snapshot = JSON.stringify(entries)
      queue = queue
        .catch(() => undefined)
        .then(async () => {
          await mkdir(directory, { recursive: true })
          await writeFile(file + '.tmp', snapshot, 'utf8')
          await rename(file + '.tmp', file)
          warning = undefined
        })
        .catch(() => {
          warning = 'Не удалось сохранить историю на диск. Записи пока доступны в текущем сеансе.'
        })
      await queue
    },
    list: async (projectPath): Promise<ActivityResult> => {
      await ready
      if (
        projectPath !== undefined &&
        (typeof projectPath !== 'string' || !isAbsolute(projectPath))
      )
        return { success: false, entries: [], error: 'Некорректный путь проекта.' }
      return {
        success: true,
        entries: entries
          .filter(
            (entry) =>
              !projectPath ||
              entry.projectPath.toLowerCase().replaceAll('\\', '/') ===
                projectPath.toLowerCase().replaceAll('\\', '/')
          )
          .map((entry) => ({ ...entry })),
        warning
      }
    }
  }
}

export function activityIpc(
  ipc: Pick<IpcMain, 'handle'>,
  record: (entry: Draft) => Promise<void>
): Pick<IpcMain, 'handle'> {
  const labels: Record<string, string> = {
    'project:save-file': 'Сохранение файла',
    'project:create': 'Создание проекта',
    'project:open': 'Открытие проекта',
    'project:save-settings': 'Настройки проекта',
    'build:start': 'Сборка',
    'flash:start': 'Прошивка'
  }
  const fileLabels: Record<string, string> = {
    'create-file': 'Создание файла',
    'create-directory': 'Создание папки',
    rename: 'Переименование',
    delete: 'Удаление в корзину'
  }
  return {
    handle: (channel, listener): void => {
      ipc.handle(channel, async (event, ...args: unknown[]) => {
        const response = await listener(event, ...args)
        if (!response || typeof response !== 'object') return response
        const result = response as Record<string, unknown>
        if (result.canceled === true) return response
        const request =
          args[0] && typeof args[0] === 'object' ? (args[0] as Record<string, unknown>) : null
        const project =
          result.project && typeof result.project === 'object'
            ? (result.project as Record<string, unknown>)
            : null
        const projectPath = project?.path ?? result.projectPath ?? request?.projectPath ?? args[0]
        const label =
          channel === 'project:mutate' ? fileLabels[String(request?.action)] : labels[channel]
        if (label && typeof projectPath === 'string' && isAbsolute(projectPath)) {
          const asynchronous = channel === 'build:start' || channel === 'flash:start'
          void record({
            projectPath,
            action: label,
            status: result.success === true ? (asynchronous ? 'running' : 'success') : 'error',
            relativePath:
              channel === 'project:save-file'
                ? String(args[1])
                : typeof request?.relativePath === 'string'
                  ? request.relativePath
                  : undefined,
            message:
              result.success === true &&
              channel === 'project:mutate' &&
              typeof result.relativePath === 'string'
                ? result.relativePath
                : typeof result.error === 'string'
                  ? result.error
                  : undefined
          })
        }
        return response
      })
    }
  }
}
