import type { IpcMain } from 'electron'
import { lstat, realpath, mkdir, writeFile, rename } from 'fs/promises'
import { resolve, join, relative, isAbsolute, dirname, sep } from 'path'
import type { FileMutation, FileMutationResult } from '../shared/projectFiles'

const hidden = new Set(['.git', '.espai', 'node_modules', 'build', 'out'])
export function validEntryName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 255 &&
    name.trim() === name &&
    !/[<>:"/\\|?*]/.test(name) &&
    ![...name].some((char) => char.charCodeAt(0) < 32) &&
    !/[. ]$/.test(name) &&
    name !== '.' &&
    name !== '..' &&
    !hidden.has(name.toLowerCase()) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  )
}

async function checkedPath(root: string, value: unknown, allowRoot = false): Promise<string> {
  if (typeof value !== 'string' || isAbsolute(value))
    throw new Error('Нужен относительный путь проекта.')
  const parts = value.replaceAll('\\', '/').split('/').filter(Boolean)
  if (parts.some((part) => !validEntryName(part)))
    throw new Error('Недопустимый или служебный путь.')
  if (!parts.length && !allowRoot) throw new Error('Операции с корнем проекта запрещены.')
  const target = resolve(root, ...parts)
  const local = relative(root, target)
  if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`))
    throw new Error('Путь вне проекта.')
  let current = root
  for (const part of parts) {
    current = join(current, part)
    const info = await lstat(current)
    if (info.isSymbolicLink()) throw new Error('Операции с символическими ссылками запрещены.')
  }
  return target
}

export function registerProjectFileHandlers(
  ipc: Pick<IpcMain, 'handle'>,
  trash: (path: string) => Promise<void>,
  busy: () => boolean
): void {
  let mutationBusy = false
  ipc.handle('project:mutate', async (_, request: FileMutation): Promise<FileMutationResult> => {
    if (mutationBusy || busy())
      return { success: false, error: 'Дождитесь завершения операции с проектом.' }
    mutationBusy = true
    try {
      if (!request || typeof request.projectPath !== 'string' || !isAbsolute(request.projectPath))
        throw new Error('Некорректный путь проекта.')
      const root = await realpath(request.projectPath)
      if (!(await lstat(join(root, 'CMakeLists.txt'))).isFile())
        throw new Error('Папка не является проектом.')
      const creating = request.action === 'create-file' || request.action === 'create-directory'
      const source = await checkedPath(root, request.relativePath, creating)
      if (request.action === 'delete') {
        await trash(source)
        return { success: true }
      }
      if (!creating && request.action !== 'rename') throw new Error('Неизвестная операция.')
      if (!validEntryName(request.name))
        throw new Error(
          'Недопустимое имя. Не используйте служебные имена Windows и символы <>:"/\\|?*.'
        )
      if (creating && !(await lstat(source)).isDirectory())
        throw new Error('Выберите папку для создания.')
      const destination = join(creating ? source : dirname(source), request.name)
      try {
        await lstat(destination)
        throw new Error('Файл или папка с таким именем уже существует.')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (request.action === 'create-file') await writeFile(destination, '', { flag: 'wx' })
      else if (request.action === 'create-directory') await mkdir(destination)
      else await rename(source, destination)
      return { success: true, relativePath: relative(root, destination).replaceAll('\\', '/') }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Не удалось изменить проект.'
      }
    } finally {
      mutationBusy = false
    }
  })
}
