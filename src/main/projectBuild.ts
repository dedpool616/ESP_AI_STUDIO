import type { IpcMain } from 'electron'
import { spawn } from 'child_process'
import { readFile, stat, realpath } from 'fs/promises'
import { dirname, isAbsolute, join, delimiter } from 'path'
import { StringDecoder } from 'string_decoder'
import { checkEnvironment } from './environment'
import { createCheckEnvironment } from './environmentReadiness'
import { isCheckTarget, type EnvironmentReport, type CheckTarget } from '../shared/environment'
import type { BuildState, BuildResult } from '../shared/build'

let state: BuildState = { status: 'idle', projectPath: '', target: '', log: '' }
export function isBuildRunning(): boolean {
  return state.status === 'running'
}

function append(text: string): void {
  state.log = (state.log + text).slice(-256 * 1024)
}

export async function prepareBuildEnvironment(
  report: EnvironmentReport,
  target: CheckTarget
): Promise<NodeJS.ProcessEnv> {
  const root = report.readiness?.pythonPackages.constraintsPath
    ? dirname(report.readiness.pythonPackages.constraintsPath)
    : undefined
  if (!root || !report.idf.path || !report.readiness?.compiler.path)
    throw new Error('Не удалось определить окружение выбранного SDK.')
  const env = createCheckEnvironment(report, target, root, report.readiness.compiler.path)
  const metadata = JSON.parse(await readFile(join(report.idf.path, 'tools/tools.json'), 'utf8'))
  const paths: string[] = []
  for (const tool of metadata.tools) {
    if (
      tool.supported_targets &&
      !tool.supported_targets.includes('all') &&
      !tool.supported_targets.includes(target)
    )
      continue
    if (!/^[\w-]+$/.test(tool.name)) continue
    const version = tool.versions?.find(
      (item: { status: string }) => item.status === 'recommended'
    )?.name
    if (typeof version !== 'string' || !/^[\w.-]+$/.test(version) || version.includes('..'))
      continue
    const base = join(root, tool.name, version)
    for (const parts of tool.export_paths ?? []) {
      if (
        !Array.isArray(parts) ||
        !parts.every(
          (part) => typeof part === 'string' && !part.includes('..') && !isAbsolute(part)
        )
      )
        continue
      const directory = join(base, ...parts)
      try {
        if ((await stat(directory)).isDirectory()) paths.push(directory)
      } catch {
        /* Optional tool. */
      }
    }
    for (const [key, value] of Object.entries(tool.export_vars ?? {})) {
      // SDK tool data must not replace the selected Python or process search path.
      if (key.startsWith('ESP_') && typeof value === 'string')
        env[key] = value.replaceAll('${TOOL_PATH}', base)
    }
  }
  env.PATH = [env.PATH, ...paths].filter(Boolean).join(delimiter)
  env.IDF_COMPONENT_MANAGER = '0'
  env.IDF_CCACHE_ENABLE = '0'
  return env
}

async function optionalRead(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function validateBuildProject(
  projectPath: string,
  target: CheckTarget
): Promise<void> {
  for (const name of ['CMakeLists.txt', 'main/CMakeLists.txt']) {
    if (!(await stat(join(projectPath, name))).isFile())
      throw new Error('Папка не является поддерживаемым ESP-IDF проектом.')
  }
  if (
    (await optionalRead(join(projectPath, 'idf_component.yml'))) !== null ||
    (await optionalRead(join(projectPath, 'main/idf_component.yml'))) !== null
  )
    throw new Error(
      'Сборка проектов с внешними компонентами пока не поддерживается: автоматическое скачивание отключено.'
    )
  const config = await optionalRead(join(projectPath, 'sdkconfig'))
  const configured = config?.match(/^CONFIG_IDF_TARGET="([^"]+)"/m)?.[1]
  if (configured && configured !== target)
    throw new Error(
      `sdkconfig настроен на ${configured}, а проект — на ${target}. Автоматическая смена платы отключена.`
    )
  const cache = await optionalRead(join(projectPath, 'build/CMakeCache.txt'))
  if (cache) {
    const home = cache.match(/^CMAKE_HOME_DIRECTORY:INTERNAL=(.+)$/m)?.[1]?.trim()
    if (
      home &&
      (await realpath(home)).toLowerCase() !== (await realpath(projectPath)).toLowerCase()
    )
      throw new Error(
        'Папка build создана в другом расположении. Переместите её из проекта и повторите сборку.'
      )
    const cachedTarget = cache.match(/^IDF_TARGET:STRING=(.+)$/m)?.[1]?.trim()
    if (cachedTarget && cachedTarget !== target)
      throw new Error('Плата в кэше build отличается от платы проекта.')
  }
}

export function registerBuildHandlers(ipc: Pick<IpcMain, 'handle'>, userDataPath: string): void {
  ipc.handle('build:state', () => ({ ...state }))
  ipc.handle('build:start', (_, projectPath: unknown, target: unknown): BuildResult => {
    if (isBuildRunning())
      return { success: false, error: 'Сборка уже выполняется.', state: { ...state } }
    if (typeof projectPath !== 'string' || !isAbsolute(projectPath) || !isCheckTarget(target))
      return {
        success: false,
        error: 'Выберите проект и поддерживаемую плату.',
        state: { ...state }
      }
    state = {
      status: 'running',
      projectPath,
      target,
      log: 'Проверка проекта и окружения…\n',
      startedAt: new Date().toISOString()
    }
    void (async () => {
      try {
        await validateBuildProject(projectPath, target)
        const settings = await optionalRead(join(userDataPath, 'environment-settings.json'))
        const selected = settings ? JSON.parse(settings).idfPath : null
        if (selected !== null && (typeof selected !== 'string' || !isAbsolute(selected)))
          throw new Error('Некорректный путь SDK в настройках.')
        const report = await checkEnvironment(selected, target)
        if (!report.readiness?.dependenciesPassed)
          throw new Error('Проверка зависимостей не пройдена. Откройте ESP-IDF Manager.')
        const python = report.tools.find((tool) => tool.name === 'python')!.path!
        const env = await prepareBuildEnvironment(report, target)
        append(
          `ESP-IDF ${report.idf.version}; плата ${target}\nПроект: ${projectPath}\nСборка файлов с диска. Внешние компоненты отключены.\n`
        )
        await new Promise<void>((resolve, reject) => {
          const child = spawn(
            python,
            [
              '-B',
              join(report.idf.path!, 'tools/idf.py'),
              '-C',
              projectPath,
              '-D',
              `IDF_TARGET=${target}`,
              'build'
            ],
            {
              cwd: projectPath,
              env,
              windowsHide: true,
              shell: false,
              stdio: ['ignore', 'pipe', 'pipe']
            }
          )
          const stdout = new StringDecoder('utf8'),
            stderr = new StringDecoder('utf8')
          child.stdout.on('data', (chunk: Buffer) => append(stdout.write(chunk)))
          child.stderr.on('data', (chunk: Buffer) => append(stderr.write(chunk)))
          child.on('error', reject)
          child.on('close', (code) => {
            append(stdout.end() + stderr.end())
            if (code === 0) resolve()
            else reject(new Error(`Сборка завершилась с кодом ${code}. См. журнал.`))
          })
        })
        state.status = 'success'
        append('\nСборка завершена успешно. Результаты находятся в папке build проекта.\n')
      } catch (error) {
        state.status = 'error'
        state.error = error instanceof Error ? error.message : 'Ошибка сборки.'
        append(`\n${state.error}\n`)
      } finally {
        state.finishedAt = new Date().toISOString()
      }
    })()
    return { success: true, state: { ...state } }
  })
}
