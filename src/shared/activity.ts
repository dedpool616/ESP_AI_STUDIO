export interface ActivityEntry {
  id: string
  time: string
  projectPath: string
  action: string
  status: 'success' | 'error' | 'running' | 'cancelled'
  relativePath?: string
  message?: string
}
export interface ActivityResult {
  success: boolean
  entries: ActivityEntry[]
  warning?: string
  error?: string
}
