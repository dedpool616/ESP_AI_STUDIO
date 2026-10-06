import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import {
  join,
  resolve,
  relative,
  sep,
  isAbsolute
} from 'path'
import {
  mkdir,
  writeFile,
  access,
  readdir,
  readFile,
  stat
} from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

const execFileAsync = promisify(execFile)

interface CreateProjectRequest {
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

interface ProjectTreeNode {
  name: string
  relativePath: string
  type: 'file' | 'directory'
  children?: ProjectTreeNode[]
}

const ignoredProjectEntries = new Set([
  '.git',
  '.espai',
  'node_modules',
  'build',
  'out'
])

function resolveSafeProjectPath(
  projectPath: string,
  relativePath: string
): string {
  const projectRoot = resolve(projectPath)
  const targetPath = resolve(projectRoot, relativePath)

  const relativeTarget = relative(
    projectRoot,
    targetPath
  )

  if (
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..${sep}`) ||
    isAbsolute(relativeTarget)
  ) {
    throw new Error(
      'Requested path is outside the project directory.'
    )
  }

  return targetPath
}

async function buildProjectTree(
  projectPath: string,
  currentRelativePath = ''
): Promise<ProjectTreeNode[]> {
  const directoryPath = resolveSafeProjectPath(
    projectPath,
    currentRelativePath
  )

  const entries = await readdir(
    directoryPath,
    {
      withFileTypes: true
    }
  )

  entries.sort((a, b) => {
    if (
      a.isDirectory() &&
      !b.isDirectory()
    ) {
      return -1
    }

    if (
      !a.isDirectory() &&
      b.isDirectory()
    ) {
      return 1
    }

    return a.name.localeCompare(b.name)
  })

  const result: ProjectTreeNode[] = []

  for (const entry of entries) {
    if (
      ignoredProjectEntries.has(entry.name)
    ) {
      continue
    }

    if (entry.isSymbolicLink()) {
      continue
    }

    const relativeEntryPath = currentRelativePath
      ? join(currentRelativePath, entry.name)
      : entry.name

    if (entry.isDirectory()) {
      result.push({
        name: entry.name,
        relativePath: relativeEntryPath,
        type: 'directory',
        children: await buildProjectTree(
          projectPath,
          relativeEntryPath
        )
      })

      continue
    }

    if (entry.isFile()) {
      result.push({
        name: entry.name,
        relativePath: relativeEntryPath,
        type: 'file'
      })
    }
  }

  return result
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 850,
    minHeight: 600,
    title: 'ESP AI Studio',
    show: false,
    autoHideMenuBar: true,

    ...(process.platform === 'linux'
      ? { icon }
      : {}),

    webPreferences: {
      preload: join(
        __dirname,
        '../preload/index.js'
      ),
      sandbox: false
    }
  })

  mainWindow.on(
    'ready-to-show',
    () => {
      mainWindow.show()
    }
  )

  mainWindow.webContents.setWindowOpenHandler(
    (details) => {
      shell.openExternal(details.url)

      return {
        action: 'deny'
      }
    }
  )

  if (
    is.dev &&
    process.env['ELECTRON_RENDERER_URL']
  ) {
    mainWindow.loadURL(
      process.env['ELECTRON_RENDERER_URL']
    )
  } else {
    mainWindow.loadFile(
      join(
        __dirname,
        '../renderer/index.html'
      )
    )
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId(
    'io.github.dedpool616.espaistudio'
  )

  app.on(
    'browser-window-created',
    (_, window) => {
      optimizer.watchWindowShortcuts(
        window
      )
    }
  )

  /*
   * Select folder
   */
  ipcMain.handle(
    'dialog:select-folder',
    async () => {
      const result =
        await dialog.showOpenDialog({
          properties: [
            'openDirectory',
            'createDirectory'
          ]
        })

      if (
        result.canceled ||
        result.filePaths.length === 0
      ) {
        return null
      }

      return result.filePaths[0]
    }
  )

        /*
   * Open existing ESP-IDF project
   */
  ipcMain.handle(
    'project:open',
    async () => {
      try {
        const result =
          await dialog.showOpenDialog({
            title: 'Open ESP-IDF Project',
            properties: [
              'openDirectory'
            ]
          })

        if (
          result.canceled ||
          result.filePaths.length === 0
        ) {
          return {
            success: false,
            canceled: true
          }
        }

        const projectPath =
          resolve(result.filePaths[0])

        const cmakePath =
          join(
            projectPath,
            'CMakeLists.txt'
          )

        try {
          await access(cmakePath)
        } catch {
          return {
            success: false,
            error:
              'В выбранной папке нет CMakeLists.txt.'
          }
        }

        const cmakeContent =
          await readFile(
            cmakePath,
            'utf8'
          )

        const looksLikeEspIdf =
          cmakeContent.includes(
            'project.cmake'
          ) &&
          cmakeContent.includes(
            'project('
          )

        if (!looksLikeEspIdf) {
          return {
            success: false,
            error:
              'Эта папка не похожа на ESP-IDF проект.'
          }
        }

        /*
         * Try to read project name from:
         * project(my_project)
         */
        const projectMatch =
          cmakeContent.match(
            /project\s*\(\s*([A-Za-z0-9_-]+)/
          )

        const projectName =
          projectMatch?.[1] ??
          projectPath
            .split(/[\\/]/)
            .pop() ??
          'ESP-IDF Project'

        /*
         * Detect Git
         */
        let gitMode:
          | 'local'
          | 'none' = 'none'

        try {
          const gitStats =
            await stat(
              join(
                projectPath,
                '.git'
              )
            )

          if (gitStats.isDirectory()) {
            gitMode = 'local'
          }
        } catch {
          // Project does not use Git.
        }

        /*
 * Detect Board and ESP-IDF version.
 */
let board = ''
let idfVersion = 'later'

/*
 * First try ESP AI Studio metadata.
 */
try {
  const espaiMetadata =
    await readFile(
      join(
        projectPath,
        '.espai',
        'project.json'
      ),
      'utf8'
    )

  const metadata =
    JSON.parse(espaiMetadata)

  if (
    typeof metadata.board ===
    'string'
  ) {
    board = metadata.board
  }

  if (
    typeof metadata.idfVersion ===
    'string'
  ) {
    idfVersion =
      metadata.idfVersion
  }
} catch {
  // Not an ESP AI Studio project
  // or metadata does not exist.
}

/*
 * Try ESP-IDF build information.
 */
try {
  const descriptionContent =
    await readFile(
      join(
        projectPath,
        'build',
        'project_description.json'
      ),
      'utf8'
    )

  const description =
    JSON.parse(descriptionContent)

  if (
    !board &&
    typeof description.target ===
      'string'
  ) {
    board =
      description.target
  }

  if (
    idfVersion === 'later' &&
    typeof description.idf_ver ===
      'string'
  ) {
    idfVersion =
      description.idf_ver
  }
} catch {
  // Project has not been built yet.
}

/*
 * Try sdkconfig as another Board source.
 */
if (!board) {
  try {
    const sdkconfig =
      await readFile(
        join(
          projectPath,
          'sdkconfig'
        ),
        'utf8'
      )

    const targetMatch =
      sdkconfig.match(
        /CONFIG_IDF_TARGET="([^"]+)"/
      )

    if (targetMatch) {
      board =
        targetMatch[1]
    }
  } catch {
    // sdkconfig does not exist.
  }
}

return {
  success: true,

  project: {
    name: projectName,
    path: projectPath,
    board,
    idfVersion,
    gitMode
  }
}
      } catch (error) {
        console.error(
          'Open project failed:',
          error
        )

        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : 'Unable to open project.'
        }
      }
    }
  )

  /*
   * Create ESP-IDF project
   */
  ipcMain.handle(
    'project:create',
    async (
      _,
      request: CreateProjectRequest
    ): Promise<CreateProjectResult> => {
      try {
        const projectName =
          request.projectName.trim()

        const location =
          request.location.trim()

        if (!projectName) {
          return {
            success: false,
            error:
              'Project name is required.'
          }
        }

        if (!location) {
          return {
            success: false,
            error:
              'Project location is required.'
          }
        }

        const validProjectName =
          /^[A-Za-z0-9_-]+$/

        if (
          !validProjectName.test(
            projectName
          )
        ) {
          return {
            success: false,
            error:
              'Project name may contain only letters, numbers, "_" and "-".'
          }
        }

        if (
          request.gitMode === 'github'
        ) {
          return {
            success: false,
            error:
              'GitHub integration is not connected yet.'
          }
        }

        const projectPath = resolve(
          location,
          projectName
        )

        try {
          await access(projectPath)

          return {
            success: false,
            error:
              `Folder already exists: ${projectPath}`
          }
        } catch {
          // Folder does not exist.
        }

        const mainDirectory = join(
          projectPath,
          'main'
        )

        const espaiDirectory = join(
          projectPath,
          '.espai'
        )

        await mkdir(
          mainDirectory,
          {
            recursive: true
          }
        )

        await mkdir(
           espaiDirectory,
          {
            recursive: true
          }
        )

        const rootCMake =
`cmake_minimum_required(VERSION 3.16)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)

project(${projectName})
`

        const mainCMake =
`idf_component_register(
    SRCS "main.c"
    INCLUDE_DIRS "."
)
`

        const mainC =
`#include <stdio.h>

void app_main(void)
{
    printf("Hello from ESP AI Studio!\\n");
}
`

        const gitIgnore =
`build/
*.log
sdkconfig.old
`

        await writeFile(
          join(
            projectPath,
            'CMakeLists.txt'
          ),
          rootCMake,
          'utf8'
        )

        await writeFile(
          join(
            mainDirectory,
            'CMakeLists.txt'
          ),
          mainCMake,
          'utf8'
        )

        await writeFile(
          join(
            mainDirectory,
            'main.c'
          ),
          mainC,
          'utf8'
        )

        await writeFile(
          join(
            projectPath,
            '.gitignore'
          ),
          gitIgnore,
          'utf8'
        )


        const espaiProjectInfo = {
  board: request.board,
  idfVersion: request.idfVersion
}

await writeFile(
  join(
    espaiDirectory,
    'project.json'
  ),
  JSON.stringify(
    espaiProjectInfo,
    null,
    2
  ),
  'utf8'
)

        if (
          request.gitMode === 'local'
        ) {
          await execFileAsync(
            'git',
            ['init'],
            {
              cwd: projectPath
            }
          )

          await execFileAsync(
            'git',
            [
              'branch',
              '-M',
              'main'
            ],
            {
              cwd: projectPath
            }
          )
        }

        return {
          success: true,
          projectPath
        }
      } catch (error) {
        console.error(
          'Project creation failed:',
          error
        )

        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : 'Unknown project creation error.'
        }
      }
    }
  )

  /*
   * Read project tree
   */
  ipcMain.handle(
    'project:get-tree',
    async (
      _,
      projectPath: string
    ) => {
      try {
        const tree =
          await buildProjectTree(
            projectPath
          )

        return {
          success: true,
          tree
        }
      } catch (error) {
        return {
          success: false,
          tree: [],
          error:
            error instanceof Error
              ? error.message
              : 'Unable to read project tree.'
        }
      }
    }
  )

  /*
   * Read one project file
   */
  ipcMain.handle(
    'project:read-file',
    async (
      _,
      projectPath: string,
      relativePath: string
    ) => {
      try {
        const filePath =
          resolveSafeProjectPath(
            projectPath,
            relativePath
          )

        const fileStats =
          await stat(filePath)

        if (!fileStats.isFile()) {
          throw new Error(
            'Selected path is not a file.'
          )
        }

        /*
         * Prevent accidentally opening
         * huge generated/binary files.
         */
        if (
          fileStats.size >
          2 * 1024 * 1024
        ) {
          throw new Error(
            'File is larger than 2 MB.'
          )
        }

        const content =
          await readFile(
            filePath,
            'utf8'
          )

        if (
          content.includes('\u0000')
        ) {
          throw new Error(
            'Binary files cannot be opened in the code editor.'
          )
        }

        return {
          success: true,
          content
        }
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : 'Unable to read file.'
        }
      }
    }
  )

  /*
   * Save project file
   */
  ipcMain.handle(
    'project:save-file',
    async (
      _,
      projectPath: string,
      relativePath: string,
      content: string
    ) => {
      try {
        const filePath =
          resolveSafeProjectPath(
            projectPath,
            relativePath
          )

        const fileStats =
          await stat(filePath)

        if (!fileStats.isFile()) {
          throw new Error(
            'Selected path is not a file.'
          )
        }

        await writeFile(
          filePath,
          content,
          'utf8'
        )

        return {
          success: true
        }
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : 'Unable to save file.'
        }
      }
    }
  )

  createWindow()

  app.on(
    'activate',
    () => {
      if (
        BrowserWindow.getAllWindows()
          .length === 0
      ) {
        createWindow()
      }
    }
  )
})

app.on(
  'window-all-closed',
  () => {
    if (
      process.platform !== 'darwin'
    ) {
      app.quit()
    }
  }
)