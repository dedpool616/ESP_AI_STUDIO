import type { IpcMain } from 'electron'
import { spawn, execFile } from 'child_process'
import { readFile, stat, realpath } from 'fs/promises'
import { dirname, isAbsolute, join, delimiter } from 'path'
import { StringDecoder } from 'string_decoder'
import { checkEnvironment } from './environment'
import { createCheckEnvironment } from './environmentReadiness'
import { isCheckTarget, type EnvironmentReport, type CheckTarget } from '../shared/environment'
import type { BuildState, BuildResult, PortsResult } from '../shared/build'
import { flashBaudRates } from '../shared/build'
import { monitorBaudRates, type MonitorState } from '../shared/monitor'
import type { ChildProcessWithoutNullStreams } from 'child_process'

let monitor: MonitorState = { status: 'disconnected', port: '', baud: 115200, log: '' }
let monitorChild: ChildProcessWithoutNullStreams | undefined
let monitorGeneration = 0
export function stopMonitor(): void {
  monitorGeneration++
  monitorChild?.kill()
  monitorChild = undefined
  monitor.status = 'disconnected'
}

const monitorScript = `
import sys, json, codecs
import serial
def emit(value):
    print(json.dumps(value), flush=True)
try:
    connection = serial.Serial()
    connection.port = sys.argv[1]
    connection.baudrate = int(sys.argv[2])
    connection.timeout = 0.2
    connection.dtr = False
    connection.rts = False
    connection.open()
    emit({"ready": True})
    decoder = codecs.getincrementaldecoder('utf-8')(errors='replace')
    while True:
        data = connection.read(min(connection.in_waiting or 1, 4096))
        if data:
            emit({"data": decoder.decode(data)})
except Exception as error:
    emit({"error": str(error)})
    sys.exit(1)
finally:
    if 'connection' in locals() and connection.is_open:
        connection.close()
`

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
  ipc.handle('monitor:state', () => ({ ...monitor }))
  ipc.handle('monitor:clear', () => {
    monitor.log = ''
    return { ...monitor }
  })
  ipc.handle('monitor:stop', () => {
    stopMonitor()
    return { ...monitor }
  })
  ipc.handle('monitor:start', async (_, target: unknown, port: unknown, baud: unknown) => {
    if (isBuildRunning() || monitor.status === 'connecting' || monitorChild)
      return { success: false, error: 'Дождитесь завершения операции или отключите монитор.' }
    if (
      !isCheckTarget(target) ||
      typeof port !== 'string' ||
      !/^COM[1-9]\d*$/i.test(port) ||
      typeof baud !== 'number' ||
      !monitorBaudRates.includes(baud)
    )
      return { success: false, error: 'Выберите плату, COM-порт и поддерживаемую скорость.' }
    const generation = ++monitorGeneration
    monitor = { status: 'connecting', port, baud, log: monitor.log }
    try {
      const report = await environment(target)
      const env = await prepareBuildEnvironment(report, target)
      if (generation !== monitorGeneration)
        return { success: false, error: 'Подключение отменено.' }
      const child = spawn(
        report.tools.find((tool) => tool.name === 'python')!.path!,
        ['-B', '-u', '-c', monitorScript, port, String(baud)],
        { env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] }
      )
      monitorChild = child
      const decoder = new StringDecoder('utf8')
      let pending = ''
      child.stdout.on('data', (chunk: Buffer) => {
        if (generation !== monitorGeneration) return
        pending += decoder.write(chunk)
        if (pending.length > 65536) {
          monitor.error = 'Некорректный вывод процесса монитора.'
          stopMonitor()
          monitor.status = 'error'
          return
        }
        let newline: number
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline)
          pending = pending.slice(newline + 1)
          try {
            const message = JSON.parse(line)
            if (message.ready) monitor.status = 'connected'
            if (typeof message.data === 'string')
              monitor.log = (monitor.log + message.data).slice(-256 * 1024)
            if (typeof message.error === 'string') {
              monitor.status = 'error'
              monitor.error = message.error
            }
          } catch {
            /* Ignore non-protocol output. */
          }
        }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        if (generation === monitorGeneration) monitor.error = chunk.toString('utf8').slice(-4000)
      })
      child.on('error', (error) => {
        if (generation === monitorGeneration) {
          monitor.status = 'error'
          monitor.error = error.message
          monitorChild = undefined
        }
      })
      child.on('close', () => {
        if (generation !== monitorGeneration) return
        monitorChild = undefined
        if (monitor.status !== 'error') {
          monitor.status = 'error'
          monitor.error = 'Соединение с устройством закрыто.'
        }
      })
      return { success: true }
    } catch (error) {
      if (generation === monitorGeneration) {
        monitor.status = 'error'
        monitor.error = error instanceof Error ? error.message : 'Ошибка подключения.'
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Ошибка подключения.'
      }
    }
  })
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
    port?: unknown,
    baud: unknown = 460800
  ): BuildResult => {
    if (isBuildRunning())
      return { success: false, error: 'Сборка уже выполняется.', state: { ...state } }
    if (operation === 'flash' && (monitorChild || monitor.status === 'connecting'))
      return {
        success: false,
        error: 'Отключите Serial Monitor перед прошивкой, чтобы освободить COM-порт.',
        state: { ...state }
      }
    if (typeof projectPath !== 'string' || !isAbsolute(projectPath) || !isCheckTarget(target))
      return {
        success: false,
        error: 'Выберите проект и поддерживаемую плату.',
        state: { ...state }
      }
    if (operation === 'flash' && (typeof port !== 'string' || !/^COM[1-9]\d*$/i.test(port)))
      return { success: false, error: 'Выберите COM-порт.', state: { ...state } }
    if (operation === 'flash' && (typeof baud !== 'number' || !flashBaudRates.includes(baud)))
      return {
        success: false,
        error: 'Выберите поддерживаемую скорость прошивки.',
        state: { ...state }
      }
    state = {
      ...(operation === 'flash' ? { baud: baud as number } : {}),
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
          append(
            `Прошивка через ${port}, ${baud} бод. Существующая программа на плате будет заменена.\n`
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
              ...(operation === 'flash'
                ? ['-p', String(port), '-b', String(baud), 'flash']
                : ['build'])
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
  ipc.handle(
    'flash:start',
    (_, projectPath: unknown, target: unknown, port: unknown, baud: unknown = 460800) =>
      start(projectPath, target, 'flash', port, baud)
  )
}
