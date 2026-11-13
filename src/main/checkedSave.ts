import { readFile, stat, writeFile } from 'fs/promises'

export interface CheckedSaveResult {
  success: boolean
  conflict?: boolean
  currentContent?: string | null
  error?: string
}

export async function checkedSave(
  path: string,
  content: unknown,
  expected: unknown
): Promise<CheckedSaveResult> {
  if (typeof content !== 'string' || (typeof expected !== 'string' && expected !== null))
    return {
      success: false,
      error: 'Полностью перезапустите приложение: сохранение требует проверки версии файла.'
    }
  let current: string | null
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > 2 * 1024 * 1024)
      throw new Error('Файл недоступен для текстового редактора.')
    current = await readFile(path, 'utf8')
    if (current.includes('\u0000')) throw new Error('Файл стал бинарным; перезапись заблокирована.')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') current = null
    else
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Не удалось прочитать файл перед сохранением.'
      }
  }
  if (current !== expected)
    return {
      success: false,
      conflict: true,
      currentContent: current,
      error: current === null ? 'Файл удалён вне приложения.' : 'Файл изменён вне приложения.'
    }
  try {
    await writeFile(path, content, { encoding: 'utf8', flag: current === null ? 'wx' : 'w' })
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Не удалось сохранить файл.'
    }
  }
}
