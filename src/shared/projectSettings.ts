import type { CheckTarget } from './environment'
export interface ProjectSettings {
  board: string
  idfPath: string | null
}
export interface SaveProjectSettings {
  projectPath: string
  board: CheckTarget
  idfPath: string | null
  backupBuild: boolean
}
export interface ProjectSettingsResult {
  success: boolean
  settings?: ProjectSettings
  backupPath?: string
  error?: string
}
