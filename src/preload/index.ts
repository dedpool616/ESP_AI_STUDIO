import {
  contextBridge,
  ipcRenderer
} from 'electron'

import {
  electronAPI
} from '@electron-toolkit/preload'

interface CreateProjectOptions {
  projectName: string
  location: string
  board: string
  idfVersion: string
  gitMode:
    | 'local'
    | 'github'
    | 'none'
}

const api = {
  selectFolder:
    (): Promise<string | null> => {
      return ipcRenderer.invoke(
        'dialog:select-folder'
      )
    },

    openProject: () => {
    return ipcRenderer.invoke(
      'project:open'
    )
  },


  createProject: (
    options: CreateProjectOptions
  ) => {
    return ipcRenderer.invoke(
      'project:create',
      options
    )
  },

  getProjectTree: (
    projectPath: string
  ) => {
    return ipcRenderer.invoke(
      'project:get-tree',
      projectPath
    )
  },

  readProjectFile: (
    projectPath: string,
    relativePath: string
  ) => {
    return ipcRenderer.invoke(
      'project:read-file',
      projectPath,
      relativePath
    )
  },

  saveProjectFile: (
    projectPath: string,
    relativePath: string,
    content: string
  ) => {
    return ipcRenderer.invoke(
      'project:save-file',
      projectPath,
      relativePath,
      content
    )
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld(
      'electron',
      electronAPI
    )

    contextBridge.exposeInMainWorld(
      'api',
      api
    )
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI

  // @ts-ignore
  window.api = api
}