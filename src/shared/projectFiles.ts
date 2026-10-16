export type FileAction = 'create-file' | 'create-directory' | 'rename' | 'delete'
export interface FileMutation {
  action: FileAction
  projectPath: string
  relativePath: string
  name?: string
}
export interface FileMutationResult {
  success: boolean
  relativePath?: string
  error?: string
}

export function affectsFile(file: string, directory: string): boolean {
  const normalized = file.replaceAll('\\', '/').toLowerCase()
  const prefix = directory.replaceAll('\\', '/').toLowerCase()
  return normalized === prefix || normalized.startsWith(prefix + '/')
}
