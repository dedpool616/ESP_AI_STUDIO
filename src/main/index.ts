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

        await mkdir(
          mainDirectory,
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