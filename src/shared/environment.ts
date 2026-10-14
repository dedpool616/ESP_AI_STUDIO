export type ToolName = 'python' | 'git' | 'cmake' | 'ninja'

export interface ToolCheck {
  name: ToolName
  status: 'found' | 'missing' | 'error'
  path?: string
  version?: string
  source?: string
  detail: string
}

export interface IdfInstallation {
  path: string
  version?: string
  source: string
}

export interface EnvironmentReport {
  checkedAt: string
  selectedPath: string | null
  idf: {
    status: 'found' | 'missing' | 'invalid'
    path?: string
    version?: string
    source?: string
    detail: string
  }
  installations: IdfInstallation[]
  tools: ToolCheck[]
  warnings: string[]
  basicToolsAvailable: boolean
}

export interface EnvironmentResult {
  success: boolean
  canceled?: boolean
  report?: EnvironmentReport
  error?: string
}
