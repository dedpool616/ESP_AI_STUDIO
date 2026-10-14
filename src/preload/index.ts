import { contextBridge, ipcRenderer } from 'electron'

import { electronAPI } from '@electron-toolkit/preload'
import type { EnvironmentResult, CheckTarget } from '../shared/environment'
import type { BuildState, BuildResult, PortsResult } from '../shared/build'
import type { MonitorState } from '../shared/monitor'

interface CreateProjectOptions {
  projectName: string
  location: string
  board: string
  idfVersion: string
  gitMode: 'local' | 'github' | 'none'
}

const api = {
  getMonitorState: (): Promise<MonitorState> => ipcRenderer.invoke('monitor:state'),
  startMonitor: (
    target: string,
    port: string,
    baud: number
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('monitor:start', target, port, baud),
  stopMonitor: (): Promise<MonitorState> => ipcRenderer.invoke('monitor:stop'),
  clearMonitor: (): Promise<MonitorState> => ipcRenderer.invoke('monitor:clear'),
  listPorts: (target: string): Promise<PortsResult> => ipcRenderer.invoke('serial:ports', target),
  startFlash: (path: string, target: string, port: string, baud = 460800): Promise<BuildResult> =>
    ipcRenderer.invoke('flash:start', path, target, port, baud),
  getBuildState: (): Promise<BuildState> => ipcRenderer.invoke('build:state'),
  startBuild: (path: string, target: string): Promise<BuildResult> =>
    ipcRenderer.invoke('build:start', path, target),
  checkEnvironment: (target?: CheckTarget): Promise<EnvironmentResult> =>
    ipcRenderer.invoke('environment:check', target),
  selectIdf: (path: string | null, target?: CheckTarget): Promise<EnvironmentResult> =>
    ipcRenderer.invoke('environment:select-idf', path, target),
  chooseIdf: (target?: CheckTarget): Promise<EnvironmentResult> =>
    ipcRenderer.invoke('environment:choose-idf', target),
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
