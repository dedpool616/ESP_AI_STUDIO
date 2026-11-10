import type { IpcMain } from 'electron'
import { readFile, mkdir, rename, writeFile, lstat, realpath } from 'fs/promises'
import { join, isAbsolute } from 'path'
import { randomUUID } from 'crypto'
import { isCheckTarget } from '../shared/environment'
import { inspectIdf } from './environment'
import type { ProjectSettingsResult, SaveProjectSettings } from '../shared/projectSettings'

async function optionalText(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
async function safeFolder(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink())
      throw new Error('Служебная папка не должна быть ссылкой.')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export function registerProjectSettings(ipc: Pick<IpcMain, 'handle'>, busy: () => boolean): void {
  let saving = false
  const root = async (value: unknown): Promise<string> => {
    if (typeof value !== 'string' || !isAbsolute(value))
      throw new Error('Некорректный путь проекта.')
    const path = await realpath(value)
    const cmake = await readFile(join(path, 'CMakeLists.txt'), 'utf8')
    if (!cmake.includes('project.cmake')) throw new Error('Выберите ESP-IDF проект.')
    await safeFolder(join(path, '.espai'))
    return path
  }
  ipc.handle('project:settings', async (_, path: unknown): Promise<ProjectSettingsResult> => {
    try {
      const directory = await root(path)
      const raw = await optionalText(join(directory, '.espai/project.json'))
      const metadata = raw ? JSON.parse(raw) : {}
      return {
        success: true,
        settings: {
          board: typeof metadata.board === 'string' ? metadata.board : '',
          idfPath: typeof metadata.idfPath === 'string' ? metadata.idfPath : null
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Ошибка чтения настроек.'
      }
    }
  })
  ipc.handle(
    'project:save-settings',
    async (_, request: SaveProjectSettings): Promise<ProjectSettingsResult> => {
      if (saving || busy())
        return { success: false, error: 'Дождитесь завершения сборки или прошивки.' }
      saving = true
      const moved: Array<[string, string]> = []
      try {
        if (
          !request ||
          !isCheckTarget(request.board) ||
          typeof request.backupBuild !== 'boolean' ||
          (request.idfPath !== null &&
            (typeof request.idfPath !== 'string' || !isAbsolute(request.idfPath)))
        )
          throw new Error('Некорректные настройки проекта.')
        const directory = await root(request.projectPath)
        const sdk = request.idfPath === null ? null : await inspectIdf(request.idfPath)
        if (request.idfPath !== null && !sdk)
          throw new Error('Выбранная установка ESP-IDF недоступна.')
        const metadataPath = join(directory, '.espai/project.json')
        await safeFolder(metadataPath)
        const raw = await optionalText(metadataPath)
        const metadata = raw ? JSON.parse(raw) : {}
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
          throw new Error('Некорректный project.json.')
        const config = await optionalText(join(directory, 'sdkconfig'))
        const configured = config?.match(/^CONFIG_IDF_TARGET="([^"]+)"/m)?.[1]
        const descriptionText = await optionalText(
          join(directory, 'build/project_description.json')
        )
        const description = descriptionText ? JSON.parse(descriptionText) : null
        const conflict =
          (configured && configured !== request.board) ||
          (description &&
            (description.target !== request.board ||
              (sdk &&
                description.idf_path?.replaceAll('\\', '/').toLowerCase() !==
                  sdk.path.replaceAll('\\', '/').toLowerCase())))
        if (conflict && !request.backupBuild)
          throw new Error(
            'Настройки отличаются от sdkconfig или build. Подтвердите резервное копирование старой конфигурации и сборки.'
          )
        await mkdir(join(directory, '.espai'), { recursive: true })
        let backupPath: string | undefined
        if (request.backupBuild) {
          await safeFolder(join(directory, '.espai/backups'))
          backupPath = join(directory, '.espai/backups', `settings-${Date.now()}`)
          await mkdir(backupPath, { recursive: true })
          for (const name of ['sdkconfig', 'sdkconfig.old', 'build']) {
            const source = join(directory, name)
            try {
              await lstat(source)
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
              throw error
            }
            await safeFolder(source)
            const destination = join(backupPath, name)
            await rename(source, destination)
            moved.push([source, destination])
          }
        }
        const settings = { board: request.board, idfPath: sdk?.path ?? null }
        const temporary = metadataPath + `.${randomUUID()}.tmp`
        await writeFile(
          temporary,
          JSON.stringify(
            { ...metadata, ...settings, idfVersion: sdk?.version ?? 'recommended' },
            null,
            2
          ),
          { flag: 'wx' }
        )
        await rename(temporary, metadataPath)
        return { success: true, settings, backupPath }
      } catch (error) {
        const failures: string[] = []
        for (const [source, destination] of moved.reverse()) {
          try {
            await rename(destination, source)
          } catch {
            failures.push(destination)
          }
        }
        return {
          success: false,
          error:
            (error instanceof Error ? error.message : 'Ошибка сохранения настроек.') +
            (failures.length ? ` Резервные файлы сохранены: ${failures.join(', ')}` : '')
        }
      } finally {
        saving = false
      }
    }
  )
}
