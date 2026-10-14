export type ToolName = 'python' | 'git' | 'cmake' | 'ninja'
export const checkTargets = ['esp32', 'esp32s2', 'esp32s3', 'esp32c3', 'esp32c6'] as const
export type CheckTarget = (typeof checkTargets)[number]
export function isCheckTarget(value: unknown): value is CheckTarget {
  return checkTargets.some((target) => target === value)
}

export interface DependencyCheck {
  status: 'passed' | 'partial' | 'missing' | 'error' | 'skipped'
  detail: string
  path?: string
  version?: string
  expectedVersions?: string[]
  diagnostics?: string
}

export interface ReadinessReport {
  target: CheckTarget
  pythonPackages: DependencyCheck & { constraintsPath?: string }
  compiler: DependencyCheck & { name?: string; machine?: string }
  buildTools: Array<DependencyCheck & { name: 'cmake' | 'ninja' }>
  dependenciesPassed: boolean
}

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
  readiness?: ReadinessReport
}

export interface EnvironmentResult {
  success: boolean
  canceled?: boolean
  report?: EnvironmentReport
  error?: string
}
