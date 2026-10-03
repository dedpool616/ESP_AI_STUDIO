import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, resolve } from 'path'
import { mkdir, writeFile, access } from 'fs/promises'
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

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 850,
    minHeight: 600,
    title: 'ESP AI Studio',
    show: false,
    autoHideMenuBar: true,

    ...(process.platform === 'linux' ? { icon } : {}),

    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)

    return {
      action: 'deny'
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('io.github.dedpool616.espaistudio')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  /*
   * Folder selection
   */
  ipcMain.handle('dialog:select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  /*
   * Create new ESP-IDF project
   */
  ipcMain.handle(
    'project:create',
    async (_, request: CreateProjectRequest): Promise<CreateProjectResult> => {
      try {
        const projectName = request.projectName.trim()
        const location = request.location.trim()

        if (!projectName) {
          return {
            success: false,
            error: 'Project name is required.'
          }
        }

        if (!location) {
          return {
            success: false,
            error: 'Project location is required.'
          }
        }

        /*
         * Для ESP-IDF лучше пока использовать простые имена
         * без пробелов и специальных символов.
         */
        const validProjectName = /^[A-Za-z0-9_-]+$/

        if (!validProjectName.test(projectName)) {
          return {
            success: false,
            error:
              'Project name may contain only letters, numbers, "_" and "-".'
          }
        }

        if (request.gitMode === 'github') {
          return {
            success: false,
            error:
              'GitHub integration is not connected yet. Use Local Git or No Git for now.'
          }
        }

        const projectPath = resolve(location, projectName)

        /*
         * Не разрешаем случайно перезаписать существующую папку.
         */
        try {
          await access(projectPath)

          return {
            success: false,
            error: `Folder already exists: ${projectPath}`
          }
        } catch {
          // Папки нет — можно создавать.
        }

        const mainDirectory = join(projectPath, 'main')

        await mkdir(mainDirectory, {
          recursive: true
        })

        /*
         * Root CMakeLists.txt
         */
        const rootCMake = `cmake_minimum_required(VERSION 3.16)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)

project(${projectName})
`

        /*
         * main/CMakeLists.txt
         */
        const mainCMake = `idf_component_register(
    SRCS "main.c"
    INCLUDE_DIRS "."
)
`

        /*
         * main/main.c
         */
        const mainC = `#include <stdio.h>

void app_main(void)
{
    printf("Hello from ESP AI Studio!\\n");
}
`

        /*
         * Basic Git ignore
         */
        const gitIgnore = `build/
*.log
sdkconfig.old
`

        await writeFile(
          join(projectPath, 'CMakeLists.txt'),
          rootCMake,
          'utf8'
        )

        await writeFile(
          join(mainDirectory, 'CMakeLists.txt'),
          mainCMake,
          'utf8'
        )

        await writeFile(
          join(mainDirectory, 'main.c'),
          mainC,
          'utf8'
        )

        await writeFile(
          join(projectPath, '.gitignore'),
          gitIgnore,
          'utf8'
        )

        /*
         * Local Git initialization.
         */
        if (request.gitMode === 'local') {
          await execFileAsync(
            'git',
            ['init'],
            {
              cwd: projectPath
            }
          )

          /*
           * Главную ветку называем main.
           */
          await execFileAsync(
            'git',
            ['branch', '-M', 'main'],
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
        console.error('Project creation failed:', error)

        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : 'Unknown error while creating project.'
        }
      }
    }
  )

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})