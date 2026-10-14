export interface BuildState {
  operation?: 'build' | 'flash'
  port?: string
  status: 'idle' | 'running' | 'success' | 'error'
  projectPath: string
  target: string
  log: string
  error?: string
  startedAt?: string
  finishedAt?: string
}

export interface SerialPortInfo {
  device: string
  description: string
}

export interface PortsResult {
  success: boolean
  ports: SerialPortInfo[]
  error?: string
}

export interface BuildResult {
  success: boolean
  error?: string
  state: BuildState
}
export const buildLabels = {
  idle: 'Не собирался',
  running: 'Сборка…',
  success: 'Успешно',
  error: 'Ошибка'
}
