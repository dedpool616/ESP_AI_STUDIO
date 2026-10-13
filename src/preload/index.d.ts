import { ElectronAPI } from '@electron-toolkit/preload'
import type { EditorSessions } from '../shared/editorSession'

interface ProjectTreeNode {
  name: string
  relativePath: string
  type: 'file' | 'directory'
  children?: ProjectTreeNode[]
}

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

interface OpenProjectInfo {
  name: string
  path: string
  board: string
  idfVersion: string
  gitMode: 'local' | 'none'
}

interface OpenProjectResult {
  success: boolean
  canceled?: boolean
  project?: OpenProjectInfo
  error?: string
}

interface ProjectTreeResult {
  success: boolean
  tree: ProjectTreeNode[]
  error?: string
}

interface ReadFileResult {
  success: boolean
  content?: string
  error?: string
}

interface SaveFileResult {
  success: boolean
  error?: string
}

interface StoredProjectInfo {
  name: string
  path: string
  board: string
  idfVersion: string
  gitMode: 'local' | 'github' | 'none'
}

interface StoredAppState {
  editorSessions: EditorSessions
  currentProject: StoredProjectInfo | null

  recentProjects: StoredProjectInfo[]
}

interface SaveAppStateResult {
  success: boolean
  error?: string
}

interface ESPAIStudioAPI {
  inspectProject: (projectPath: string) => Promise<OpenProjectResult>
  onCloseRequested: (callback: () => void) => () => void
  confirmClose: () => void
  selectFolder: () => Promise<string | null>

  loadAppState: () => Promise<StoredAppState>

  saveAppState: (state: StoredAppState) => Promise<SaveAppStateResult>

  openProject: () => Promise<OpenProjectResult>

  createProject: (options: CreateProjectOptions) => Promise<CreateProjectResult>

  getProjectTree: (projectPath: string) => Promise<ProjectTreeResult>

  readProjectFile: (projectPath: string, relativePath: string) => Promise<ReadFileResult>

  saveProjectFile: (
    projectPath: string,
    relativePath: string,
    content: string
  ) => Promise<SaveFileResult>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ESPAIStudioAPI
  }
}
