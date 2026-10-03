import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  selectFolder: (): Promise<string | null> => {
    return ipcRenderer.invoke('dialog:select-folder')
  },

  createProject: (options: {
    projectName: string
    location: string
    board: string
    idfVersion: string
    gitMode: 'local' | 'github' | 'none'
  }): Promise<{
    success: boolean
    projectPath?: string
    error?: string
  }> => {
    return ipcRenderer.invoke('project:create', options)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI

  // @ts-ignore
  window.api = api
}