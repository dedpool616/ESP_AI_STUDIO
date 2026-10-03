import { ElectronAPI } from '@electron-toolkit/preload'

interface ESPAIStudioAPI {
  selectFolder: () => Promise<string | null>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ESPAIStudioAPI
  }
}