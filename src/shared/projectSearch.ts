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
