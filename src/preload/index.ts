import { contextBridge, ipcRenderer } from 'electron'

import { electronAPI } from '@electron-toolkit/preload'

interface CreateProjectOptions {
  projectName: string
  location: string
  board: string
  idfVersion: string
  gitMode: 'local' | 'github' | 'none'
}

const api = {
  inspectProject: (projectPath: string) => ipcRenderer.invoke('project:inspect', projectPath),
  onCloseRequested: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('window:request-close', listener)
    return () => ipcRenderer.removeListener('window:request-close', listener)
  },
  confirmClose: (): void => ipcRenderer.send('window:confirm-close'),
  selectFolder: (): Promise<string | null> => {
    return ipcRenderer.invoke('dialog:select-folder')
  },

  loadAppState: () => {
    return ipcRenderer.invoke('storage:load-app-state')
  },

  saveAppState: (state: unknown) => {
    return ipcRenderer.invoke('storage:save-app-state', state)
  },

  openProject: () => {
    return ipcRenderer.invoke('project:open')
  },

  createProject: (options: CreateProjectOptions) => {
    return ipcRenderer.invoke('project:create', options)
  },

  getProjectTree: (projectPath: string) => {
    return ipcRenderer.invoke('project:get-tree', projectPath)
  },

  readProjectFile: (projectPath: string, relativePath: string) => {
    return ipcRenderer.invoke('project:read-file', projectPath, relativePath)
  },

  saveProjectFile: (projectPath: string, relativePath: string, content: string) => {
    return ipcRenderer.invoke('project:save-file', projectPath, relativePath, content)
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
  const preloadWindow = window as typeof window & {
    electron: typeof electronAPI
    api: typeof api
  }
  preloadWindow.electron = electronAPI

  preloadWindow.api = api
}
