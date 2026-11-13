export interface SearchRequest {
  projectPath: string
  query: string
  caseSensitive: boolean
}
export interface SearchMatch {
  relativePath: string
  line: number
  column: number
  snippet: string
}
export interface SearchResult {
  success: boolean
  matches: SearchMatch[]
  scanned: number
  skipped: number
  truncated: boolean
  error?: string
}
export interface ProjectFileList {
  success: boolean
  files: string[]
  truncated: boolean
  error?: string
}

export function filterProjectFiles(files: string[], query: string): string[] {
  const needle = query.trim().replaceAll('\\', '/').toLowerCase()
  const rank = (file: string): number => {
    const name = file.split('/').at(-1)!.toLowerCase()
    return name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(needle) ? 2 : 3
  }
  return files
    .filter((file) => file.toLowerCase().includes(needle))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .slice(0, 100)
}
