import type { IpcMain } from 'electron'
import { opendir, lstat, realpath, readFile } from 'fs/promises'
import { isAbsolute, join, relative, sep } from 'path'
import { TextDecoder } from 'util'
import type { SearchRequest, SearchResult, ProjectFileList } from '../shared/projectSearch'

const ignored = new Set([
  '.git',
  '.espai',
  'node_modules',
  'build',
  'out',
  'dist',
  '.idea',
  '.vscode'
])
export async function searchProject(request: SearchRequest): Promise<SearchResult> {
  const result: SearchResult = {
    success: true,
    matches: [],
    scanned: 0,
    skipped: 0,
    truncated: false
  }
  try {
    if (
      !request ||
      typeof request.projectPath !== 'string' ||
      !isAbsolute(request.projectPath) ||
      typeof request.query !== 'string' ||
      !request.query.trim() ||
      request.query.length > 256 ||
      typeof request.caseSensitive !== 'boolean'
    )
      throw new Error('Введите текст от 1 до 256 символов и выберите проект.')
    const root = await realpath(request.projectPath)
    if (!(await lstat(join(root, 'CMakeLists.txt'))).isFile())
      throw new Error('Выберите доступный ESP-IDF проект.')
    const pattern = new RegExp(
      request.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      request.caseSensitive ? 'gu' : 'giu'
    )
    let bytes = 0,
      entries = 0
    const deadline = Date.now() + 10000
    const inside = (path: string): boolean => {
      const local = relative(root, path)
      return !isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`)
    }
    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > 32) {
        result.skipped++
        result.truncated = true
        return
      }
      try {
        const handle = await opendir(directory)
        for await (const entry of handle) {
          if (
            ++entries > 10000 ||
            bytes >= 32 * 1024 * 1024 ||
            result.scanned >= 5000 ||
            Date.now() > deadline ||
            result.matches.length >= 500
          ) {
            result.truncated = true
            return
          }
          if (ignored.has(entry.name.toLowerCase())) continue
          try {
            const candidate = join(directory, entry.name)
            const info = await lstat(candidate)
            if (info.isSymbolicLink()) {
              result.skipped++
              continue
            }
            const resolved = await realpath(candidate)
            if (!inside(resolved)) {
              result.skipped++
              continue
            }
            if (info.isDirectory()) {
              await walk(resolved, depth + 1)
              continue
            }
            if (
              !info.isFile() ||
              info.size > 2 * 1024 * 1024 ||
              bytes + info.size > 32 * 1024 * 1024
            ) {
              result.skipped++
              continue
            }
            const buffer = await readFile(resolved)
            bytes += buffer.length
            if (buffer.includes(0)) {
              result.skipped++
              continue
            }
            let text: string
            try {
              text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
            } catch {
              result.skipped++
              continue
            }
            result.scanned++
            const lines = text.split(/\r?\n/)
            for (let index = 0; index < lines.length; index++) {
              pattern.lastIndex = 0
              let match: RegExpExecArray | null
              while ((match = pattern.exec(lines[index]))) {
                const start = Math.max(0, match.index - 70)
                result.matches.push({
                  relativePath: relative(root, resolved).replaceAll('\\', '/'),
                  line: index + 1,
                  column: match.index + 1,
                  snippet:
                    (start ? '…' : '') +
                    lines[index].slice(start, start + 240) +
                    (lines[index].length > start + 240 ? '…' : '')
                })
                if (result.matches.length >= 500) {
                  result.truncated = true
                  return
                }
              }
            }
          } catch {
            result.skipped++
          }
        }
      } catch {
        result.skipped++
      }
    }
    await walk(root, 0)
    return result
  } catch (error) {
    return {
      ...result,
      success: false,
      error: error instanceof Error ? error.message : 'Ошибка поиска.'
    }
  }
}

export async function listProjectFiles(projectPath: unknown): Promise<ProjectFileList> {
  const result: ProjectFileList = { success: true, files: [], truncated: false }
  try {
    if (typeof projectPath !== 'string' || !isAbsolute(projectPath))
      throw new Error('Выберите проект.')
    const root = await realpath(projectPath)
    if (!(await lstat(join(root, 'CMakeLists.txt'))).isFile())
      throw new Error('Папка проекта недоступна.')
    let count = 0
    const deadline = Date.now() + 5000
    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > 32) {
        result.truncated = true
        return
      }
      try {
        for await (const entry of await opendir(directory)) {
          if (result.files.length >= 10000 || ++count > 20000 || Date.now() > deadline) {
            result.truncated = true
            return
          }
          if (ignored.has(entry.name.toLowerCase())) continue
          try {
            const candidate = join(directory, entry.name)
            const info = await lstat(candidate)
            if (info.isSymbolicLink()) continue
            const resolved = await realpath(candidate)
            const local = relative(root, resolved)
            if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) continue
            if (info.isDirectory()) await walk(resolved, depth + 1)
            else if (info.isFile() && info.size <= 2 * 1024 * 1024)
              result.files.push(local.replaceAll('\\', '/'))
          } catch {
            result.truncated = true
          }
        }
      } catch {
        result.truncated = true
      }
    }
    await walk(root, 0)
    result.files.sort()
    return result
  } catch (error) {
    return {
      ...result,
      success: false,
      error: error instanceof Error ? error.message : 'Ошибка списка файлов.'
    }
  }
}

export function registerProjectSearch(ipc: Pick<IpcMain, 'handle'>): void {
  ipc.handle('project:list-files', (_, projectPath: unknown) => listProjectFiles(projectPath))
  let busy = false
  ipc.handle('project:search', async (_, request: SearchRequest): Promise<SearchResult> => {
    if (busy)
      return {
        success: false,
        matches: [],
        scanned: 0,
        skipped: 0,
        truncated: false,
        error: 'Поиск уже выполняется.'
      }
    busy = true
    try {
      return await searchProject(request)
    } finally {
      busy = false
    }
  })
}
