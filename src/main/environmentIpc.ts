import type { IpcMain } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { isAbsolute, join } from 'path'
import { checkEnvironment, inspectIdf } from './environment'
import type { EnvironmentResult } from '../shared/environment'

export function registerEnvironmentHandlers(
  ipc: Pick<IpcMain, 'handle'>,
  userDataPath: string,
  chooseFolder: () => Promise<string | null>
): void {
  const settingsPath = join(userDataPath, 'environment-settings.json')
  let busy = false

  const run = async (action: () => Promise<EnvironmentResult>): Promise<EnvironmentResult> => {
    if (busy) return { success: false, error: 'Проверка окружения уже выполняется.' }
    busy = true
    try {
      return await action()
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Не удалось проверить окружение.'
      }
    } finally {
      busy = false
    }
  }

  const select = async (path: unknown): Promise<EnvironmentResult> => {
    if (path !== null && (typeof path !== 'string' || !isAbsolute(path))) {
      return { success: false, error: 'Укажите абсолютный путь к папке ESP-IDF.' }
    }
    const installation = path === null ? null : await inspectIdf(path as string)
    if (path !== null && !installation) {
      return {
        success: false,
        error:
          'В выбранной папке нет ESP-IDF SDK. Нужна папка с tools/idf.py, tools/idf_tools.py и tools/cmake/project.cmake.'
      }
    }
    const selectedPath = installation?.path ?? null
    await mkdir(userDataPath, { recursive: true })
    await writeFile(
      `${settingsPath}.tmp`,
      JSON.stringify({ idfPath: selectedPath }, null, 2),
      'utf8'
    )
    await rename(`${settingsPath}.tmp`, settingsPath)
    return { success: true, report: await checkEnvironment(selectedPath) }
  }

  ipc.handle('environment:check', () =>
    run(async () => {
      let selectedPath: string | null = null
      let warning: string | undefined
      try {
        const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
        if (settings.idfPath === null) selectedPath = null
        else if (typeof settings.idfPath === 'string' && isAbsolute(settings.idfPath))
          selectedPath = settings.idfPath
        else warning = 'Сохранённый путь ESP-IDF некорректен. Используется автоматический поиск.'
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
          warning = 'Не удалось прочитать настройки ESP-IDF. Используется автоматический поиск.'
        }
      }
      const report = await checkEnvironment(selectedPath)
      if (warning) report.warnings.push(warning)
      return { success: true, report }
    })
  )
  ipc.handle('environment:select-idf', (_, path: unknown) => run(() => select(path)))
  ipc.handle('environment:choose-idf', () =>
    run(async () => {
      const folder = await chooseFolder()
      return folder ? await select(folder) : { success: false, canceled: true }
    })
  )
}
