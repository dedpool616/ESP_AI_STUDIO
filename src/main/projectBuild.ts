import type { IpcMain } from 'electron'
import { spawn, execFile } from 'child_process'
import { readFile, stat, realpath } from 'fs/promises'
import { dirname, isAbsolute, join, delimiter } from 'path'
import { StringDecoder } from 'string_decoder'
import { checkEnvironment } from './environment'
import { createCheckEnvironment } from './environmentReadiness'
import { isCheckTarget, type EnvironmentReport, type CheckTarget } from '../shared/environment'
import type { BuildState, BuildResult, PortsResult } from '../shared/build'

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
  const environment = async (target: CheckTarget): Promise<EnvironmentReport> => {
    const settings = await optionalRead(join(userDataPath, 'environment-settings.json'))
    const selected = settings ? JSON.parse(settings).idfPath : null
    if (selected !== null && (typeof selected !== 'string' || !isAbsolute(selected)))
      throw new Error('Некорректный путь SDK в настройках.')
    const report = await checkEnvironment(selected, target)
    if (!report.readiness?.dependenciesPassed)
      throw new Error('Проверка зависимостей не пройдена. Откройте ESP-IDF Manager.')
    return report
  }
  const ports = async (target: CheckTarget): Promise<PortsResult> => {
    try {
      const report = await environment(target)
      const python = report.tools.find((tool) => tool.name === 'python')!.path!
      const env = await prepareBuildEnvironment(report, target)
      const script =
        'import json; from serial.tools.list_ports import comports; print(json.dumps([{"device": p.device, "description": p.description or ""} for p in comports()]))'
      const output = await new Promise<string>((resolve, reject) => {
        execFile(
          python,
          ['-B', '-c', script],
          {
            env,
            windowsHide: true,
            shell: false,
            timeout: 10000,
            maxBuffer: 65536,
            encoding: 'utf8'
          },
          (error, stdout) => {
            if (error)
              reject(new Error('Не удалось получить COM-порты через Python выбранного SDK.'))
            else resolve(stdout)
          }
        )
      })
      const values = JSON.parse(output)
      if (!Array.isArray(values)) throw new Error('Некорректный ответ списка портов.')
      return {
        success: true,
        ports: values.filter(
          (value) =>
            typeof value.device === 'string' &&
            /^COM[1-9]\d*$/i.test(value.device) &&
            typeof value.description === 'string'
        )
      }
    } catch (error) {
      return {
        success: false,
        ports: [],
        error: error instanceof Error ? error.message : 'Ошибка поиска портов.'
      }
    }
  }
  ipc.handle('serial:ports', (_, target: unknown): Promise<PortsResult> =>
    isCheckTarget(target)
      ? ports(target)
      : Promise.resolve({
          success: false,
          ports: [],
          error: 'Выберите поддерживаемую плату проекта.'
        })
  )
  ipc.handle('build:state', () => ({ ...state }))
  const start = (
    projectPath: unknown,
    target: unknown,
    operation: 'build' | 'flash',
    port?: unknown
  ): BuildResult => {
    if (isBuildRunning())
      return { success: false, error: 'Сборка уже выполняется.', state: { ...state } }
    if (typeof projectPath !== 'string' || !isAbsolute(projectPath) || !isCheckTarget(target))
      return {
        success: false,
        error: 'Выберите проект и поддерживаемую плату.',
        state: { ...state }
      }
    if (operation === 'flash' && (typeof port !== 'string' || !/^COM[1-9]\d*$/i.test(port)))
      return { success: false, error: 'Выберите COM-порт.', state: { ...state } }
    state = {
      operation,
      port: typeof port === 'string' ? port : undefined,
      status: 'running',
      projectPath,
      target,
      log: 'Проверка проекта и окружения…\n',
      startedAt: new Date().toISOString()
    }
    void (async () => {
      try {
        await validateBuildProject(projectPath, target)
        const report = await environment(target)
        if (operation === 'flash') {
          const description = JSON.parse(
            (await optionalRead(join(projectPath, 'build/project_description.json'))) ?? '{}'
          )
          if (
            description.target !== target ||
            description.project_path?.replaceAll('\\', '/').toLowerCase() !==
              projectPath.replaceAll('\\', '/').toLowerCase()
          )
            throw new Error('Сначала успешно соберите этот проект для выбранной платы.')
          const available = await ports(target)
          if (
            !available.success ||
            !available.ports.some(
              (item) => item.device.toLowerCase() === String(port).toLowerCase()
            )
          )
            throw new Error(
              available.error ?? 'Выбранный COM-порт больше недоступен. Обновите список.'
            )
        }
        const python = report.tools.find((tool) => tool.name === 'python')!.path!
        const env = await prepareBuildEnvironment(report, target)
        append(
          `ESP-IDF ${report.idf.version}; плата ${target}\nПроект: ${projectPath}\nСборка файлов с диска. Внешние компоненты отключены.\n`
        )
        if (operation === 'flash')
          append(`Прошивка через ${port}. Существующая программа на плате будет заменена.\n`)
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
              ...(operation === 'flash' ? ['-p', String(port), '-b', '460800', 'flash'] : ['build'])
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
            else reject(new Error(`Операция завершилась с кодом ${code}. См. журнал.`))
          })
        })
        state.status = 'success'
        append(
          operation === 'flash'
            ? '\nПрошивка завершена успешно.\n'
            : '\nСборка завершена успешно. Результаты находятся в папке build проекта.\n'
        )
      } catch (error) {
        state.status = 'error'
        state.error = error instanceof Error ? error.message : 'Ошибка сборки.'
        append(`\n${state.error}\n`)
      } finally {
        state.finishedAt = new Date().toISOString()
      }
    })()
    return { success: true, state: { ...state } }
  }
  ipc.handle('build:start', (_, projectPath: unknown, target: unknown) =>
    start(projectPath, target, 'build')
  )
  ipc.handle('flash:start', (_, projectPath: unknown, target: unknown, port: unknown) =>
    start(projectPath, target, 'flash', port)
  )
}
