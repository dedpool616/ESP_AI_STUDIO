import { ElectronAPI } from '@electron-toolkit/preload'
import type { EditorSessions } from '../shared/editorSession'
import type { EnvironmentResult, CheckTarget } from '../shared/environment'
import type { BuildState, BuildResult, PortsResult } from '../shared/build'

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
  listPorts: (target: string) => Promise<PortsResult>
  startFlash: (path: string, target: string, port: string) => Promise<BuildResult>
  getBuildState: () => Promise<BuildState>
  startBuild: (path: string, target: string) => Promise<BuildResult>
  checkEnvironment: (target?: CheckTarget) => Promise<EnvironmentResult>
  selectIdf: (path: string | null, target?: CheckTarget) => Promise<EnvironmentResult>
  chooseIdf: (target?: CheckTarget) => Promise<EnvironmentResult>
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
