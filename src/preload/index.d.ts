import { ElectronAPI } from '@electron-toolkit/preload'

interface CreateProjectOptions {
  projectName: string
  location: string
  board: string
  idfVersion: string
  gitMode: 'local' | 'github' | 'none'
}

interface CreateProjectResult {
  success: boolean
  projectPath?: string
  error?: string
}

interface ESPAIStudioAPI {
  selectFolder: () => Promise<string | null>

  createProject: (
    options: CreateProjectOptions
  ) => Promise<CreateProjectResult>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ESPAIStudioAPI
  }
}