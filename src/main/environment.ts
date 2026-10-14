import { execFile } from 'child_process'
import { readFile, readdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'path'
import { promisify } from 'util'
import type { EnvironmentReport, IdfInstallation, ToolCheck, ToolName } from '../shared/environment'
import type { CheckTarget } from '../shared/environment'
import { checkReadiness } from './environmentReadiness'

const execFileAsync = promisify(execFile)

interface Candidate {
  path: string
  source: string
  python?: string
  toolsPath?: string
  git?: string
  preferred?: boolean
}

interface Executable {
  path: string
  source: string
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find((key) => key.toUpperCase() === name.toUpperCase())
  return key ? env[key] : undefined
}

function pathKey(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function readSmallFile(path: string): Promise<string> {
  if ((await stat(path)).size > 512 * 1024) throw new Error('Файл конфигурации слишком большой.')
  return await readFile(path, 'utf8')
}

export async function inspectIdf(path: string): Promise<IdfInstallation | null> {
  if (typeof path !== 'string' || !isAbsolute(path)) return null
  const root = resolve(path)
  // Detect the SDK itself, not a user's ESP-IDF project or a tools directory.
  const markers = ['tools/idf.py', 'tools/idf_tools.py', 'tools/cmake/project.cmake']
  if (!(await Promise.all(markers.map((marker) => isFile(join(root, marker))))).every(Boolean)) {
    return null
  }
  let version: string | undefined
  try {
    version = (await readSmallFile(join(root, 'version.txt')))
      .trim()
      .match(/^v?(\d+\.\d+(?:\.\d+)?(?:[-.][\w.-]+)?)/)?.[1]
  } catch {
    /* Git checkouts may not contain version.txt. */
  }
  if (!version) {
    try {
      const content = await readSmallFile(join(root, 'tools', 'cmake', 'version.cmake'))
      const parts = ['MAJOR', 'MINOR', 'PATCH'].map(
        (part) =>
          content.match(new RegExp(`set\\(\\s*IDF_VERSION_${part}\\s+["']?(\\d+)`, 'i'))?.[1]
      )
      if (parts.every(Boolean)) version = parts.join('.')
    } catch {
      /* Report an unknown version without executing SDK scripts. */
    }
  }
  return { path: root, version, source: '' }
}

async function childDirectories(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))
      .slice(0, 40)
      .map((entry) => join(path, entry.name))
  } catch {
    return []
  }
}

// Bounded discovery inside known tool folders; never scan entire drives.
async function findTool(directory: string, executable: string): Promise<string[]> {
  let level = [directory]
  const found: string[] = []
  let visited = 0
  for (let depth = 0; depth <= 3 && level.length && visited < 80; depth++) {
    const next: string[] = []
    for (const path of level) {
      if (++visited > 80) break
      const candidate = join(path, executable)
      if (await isFile(candidate)) found.push(candidate)
      if (found.length >= 4) return found
      next.push(...(await childDirectories(path)))
    }
    level = next
  }
  return found
}

function executableNames(name: ToolName): string[] {
  if (process.platform === 'win32')
    return name === 'python' ? ['python.exe', 'python3.exe'] : [`${name}.exe`]
  return name === 'python' ? ['python3', 'python'] : [name]
}

export function parseToolVersion(name: ToolName, output: string): string | undefined {
  const patterns: Record<ToolName, RegExp> = {
    python: /Python\s+(\d+\.\d+(?:\.\d+)?[\w.+-]*)/i,
    git: /git version\s+(\d+\.\d+(?:\.\d+)?[\w.+-]*)/i,
    cmake: /cmake version\s+(\d+\.\d+(?:\.\d+)?[\w.+-]*)/i,
    ninja: /^(\d+\.\d+(?:\.\d+)?[\w.+-]*)\s*$/m
  }
  return output.match(patterns[name])?.[1]
}

async function probeTool(name: ToolName, candidates: Executable[]): Promise<ToolCheck> {
  const seen = new Set<string>()
  let failure: ToolCheck | undefined
  let attempts = 0
  for (const candidate of candidates) {
    if (
      !isAbsolute(candidate.path) ||
      !executableNames(name).includes(basename(candidate.path).toLowerCase())
    )
      continue
    const key = pathKey(candidate.path)
    // Windows Store execution aliases can open the Store instead of checking Python.
    if (seen.has(key) || /[/\\]microsoft[/\\]windowsapps[/\\]/i.test(candidate.path)) continue
    seen.add(key)
    if (!(await isFile(candidate.path))) continue
    if (++attempts > 5) break
    try {
      const { stdout, stderr } = await execFileAsync(candidate.path, ['--version'], {
        timeout: 3000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
        shell: false,
        cwd: dirname(candidate.path),
        encoding: 'utf8',
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: '1',
          PYTHONNOUSERSITE: '1',
          GIT_OPTIONAL_LOCKS: '0'
        }
      })
      const version = parseToolVersion(name, `${stdout}\n${stderr}`)
      if (!version) throw new Error('Команда не вернула распознаваемую версию.')
      return {
        name,
        status: 'found',
        path: candidate.path,
        source: candidate.source,
        version,
        detail: 'Команда версии выполнена успешно.'
      }
    } catch (error) {
      const timedOut = !!error && typeof error === 'object' && 'killed' in error && error.killed
      failure ??= {
        name,
        status: 'error',
        path: candidate.path,
        source: candidate.source,
        detail: timedOut
          ? 'Превышено время ожидания команды версии (3 секунды).'
          : 'Файл найден, но команда версии не выполнена успешно.'
      }
    }
  }
  return (
    failure ?? {
      name,
      status: 'missing',
      detail: 'Не найден в PATH и известных каталогах Espressif.'
    }
  )
}

export async function checkEnvironment(
  selectedPath: string | null = null,
  target?: CheckTarget
): Promise<EnvironmentReport> {
  const env = process.env
  const home = homedir()
  const warnings: string[] = []
  const candidates: Candidate[] = []
  const add = (candidate: Candidate): void => {
    if (typeof candidate.path === 'string' && isAbsolute(candidate.path)) candidates.push(candidate)
  }
  if (selectedPath) add({ path: selectedPath, source: 'Выбор пользователя' })
  const envIdf = envValue(env, 'IDF_PATH')
  if (envIdf) add({ path: envIdf, source: 'IDF_PATH' })
  const toolsRoots = [
    ...new Set(
      [
        envValue(env, 'IDF_TOOLS_PATH'),
        join(home, '.espressif'),
        join(home, '.espressif', 'tools'),
        ...(process.platform === 'win32' ? ['C:\\Espressif\\tools', 'C:\\Espressif'] : [])
      ].filter((path): path is string => !!path && isAbsolute(path))
    )
  ]

  for (const toolsPath of toolsRoots) {
    for (const fileName of ['eim_idf.json', 'idf-env.json']) {
      const configPath = join(toolsPath, fileName)
      if (!(await isFile(configPath))) continue
      try {
        const config = JSON.parse(await readSmallFile(configPath))
        const records = config.idfInstalled
        const entries = Array.isArray(records)
          ? records
          : records && typeof records === 'object'
            ? Object.values(records)
            : []
        for (const record of entries.slice(0, 40)) {
          if (!record || typeof record.path !== 'string') continue
          add({
            path: record.path,
            source: fileName === 'eim_idf.json' ? 'Espressif Installation Manager' : 'idf-env.json',
            python: typeof record.python === 'string' ? record.python : undefined,
            toolsPath:
              typeof record.idfToolsPath === 'string' && isAbsolute(record.idfToolsPath)
                ? record.idfToolsPath
                : toolsPath,
            git: typeof config.gitPath === 'string' ? config.gitPath : undefined,
            preferred: typeof record.id === 'string' && record.id === config.idfSelectedId
          })
        }
      } catch {
        warnings.push(`Не удалось прочитать конфигурацию ${configPath}.`)
      }
    }
  }
  const roots = [
    join(home, 'esp'),
    ...(process.platform === 'win32'
      ? ['C:\\esp', 'C:\\Espressif\\frameworks']
      : [join(home, '.espressif')])
  ]
  for (const root of roots) {
    add({ path: join(root, 'esp-idf'), source: 'Стандартный каталог' })
    for (const directory of await childDirectories(root)) {
      add({ path: directory, source: 'Стандартный каталог' })
      add({ path: join(directory, 'esp-idf'), source: 'Стандартный каталог' })
    }
  }
  const installations: IdfInstallation[] = []
  const validCandidates: Candidate[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const key = pathKey(candidate.path)
    const existing = validCandidates.find((item) => pathKey(item.path) === key)
    if (existing) {
      existing.python ??= candidate.python
      existing.toolsPath ??= candidate.toolsPath
      existing.git ??= candidate.git
      existing.preferred ||= candidate.preferred
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    const installation = await inspectIdf(candidate.path)
    if (installation) {
      installations.push({ ...installation, source: candidate.source })
      validCandidates.push({ ...candidate, path: installation.path })
    }
  }
  const selected = selectedPath
    ? validCandidates.find((candidate) => pathKey(candidate.path) === pathKey(selectedPath))
    : (validCandidates.find((candidate) => candidate.source === 'IDF_PATH') ??
      validCandidates.find((candidate) => candidate.preferred) ??
      validCandidates[0])
  if (envIdf && !validCandidates.some((candidate) => pathKey(candidate.path) === pathKey(envIdf))) {
    warnings.push(
      'IDF_PATH указывает на недоступную папку SDK. Используйте обнаруженную установку или выберите папку вручную.'
    )
  }
  const idf = selected
    ? installations.find((item) => pathKey(item.path) === pathKey(selected.path))
    : undefined
  const toolChecks = await Promise.all(
    (['python', 'git', 'cmake', 'ninja'] as const).map(async (name) => {
      const executables: Executable[] = []
      if (name === 'python' && selected?.python)
        executables.push({ path: selected.python, source: 'Python выбранной установки ESP-IDF' })
      if (name === 'git' && selected?.git)
        executables.push({ path: selected.git, source: 'Конфигурация Espressif' })
      if (
        name === 'python' &&
        envValue(env, 'IDF_PYTHON_ENV_PATH') &&
        (!selected || (envIdf && pathKey(envIdf) === pathKey(selected.path)))
      ) {
        executables.push({
          path: join(
            envValue(env, 'IDF_PYTHON_ENV_PATH')!,
            process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
          ),
          source: 'IDF_PYTHON_ENV_PATH'
        })
      }
      if (name === 'cmake' || name === 'ninja') {
        for (const root of [
          ...new Set([selected?.toolsPath, ...toolsRoots].filter((path): path is string => !!path))
        ]) {
          for (const executable of await findTool(
            join(root, name === 'cmake' ? 'cmake' : 'ninja'),
            executableNames(name)[0]
          )) {
            executables.push({ path: executable, source: 'Каталог инструментов Espressif' })
          }
        }
      }
      for (const directory of (envValue(env, 'PATH') ?? '')
        .split(delimiter)
        .map((path) => path.replace(/^"|"$/g, ''))
        .filter(isAbsolute)) {
        for (const executable of executableNames(name))
          executables.push({ path: join(directory, executable), source: 'PATH приложения' })
      }
      return await probeTool(name, executables)
    })
  )
  if (
    selected?.python &&
    toolChecks.find((tool) => tool.name === 'python')?.source !==
      'Python выбранной установки ESP-IDF'
  ) {
    warnings.push(
      'Python выбранной установки недоступен. Найденный системный Python может не содержать пакеты ESP-IDF.'
    )
  }
  const report: EnvironmentReport = {
    checkedAt: new Date().toISOString(),
    selectedPath,
    idf: idf
      ? { status: 'found', ...idf, detail: 'Найдены файлы ESP-IDF SDK.' }
      : {
          status: selectedPath ? 'invalid' : 'missing',
          path: selectedPath ?? undefined,
          detail: selectedPath
            ? 'Сохранённая папка ESP-IDF недоступна или не содержит SDK. Выберите другую папку или автоматический поиск.'
            : 'ESP-IDF не найден автоматически. Можно указать папку SDK вручную.'
        },
    installations,
    tools: toolChecks,
    warnings,
    basicToolsAvailable: !!idf && toolChecks.every((tool) => tool.status === 'found')
  }
  if (target)
    report.readiness = await checkReadiness(
      report,
      target,
      [...new Set([selected?.toolsPath, ...toolsRoots].filter((root): root is string => !!root))],
      findTool
    )
  return report
}
