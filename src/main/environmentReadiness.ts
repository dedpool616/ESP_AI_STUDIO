import { execFile } from 'child_process'
import { readFile, stat } from 'fs/promises'
import { basename, delimiter, dirname, isAbsolute, join } from 'path'
import { promisify } from 'util'
import type {
  CheckTarget,
  DependencyCheck,
  EnvironmentReport,
  ReadinessReport
} from '../shared/environment'

const execFileAsync = promisify(execFile)
interface ToolDefinition {
  name: string
  supported_targets?: string[]
  versions?: Array<{ name: string; status: string }>
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function acceptedVersions(tool?: ToolDefinition): string[] {
  return (tool?.versions ?? [])
    .filter(
      (version) =>
        typeof version.name === 'string' && ['recommended', 'supported'].includes(version.status)
    )
    .map((version) => version.name)
}

export function createCheckEnvironment(
  report: EnvironmentReport,
  target: CheckTarget,
  toolsRoot?: string,
  compilerPath?: string
): NodeJS.ProcessEnv {
  const env = { ...process.env }
  // Use an isolated child environment, independent of an unrelated activated SDK.
  const inheritedPath = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? ''
  for (const key of Object.keys(env)) {
    if (
      [
        'PATH',
        'PYTHONHOME',
        'PYTHONPATH',
        'IDF_PATH',
        'IDF_TOOLS_PATH',
        'IDF_PYTHON_ENV_PATH',
        'IDF_TARGET'
      ].includes(key.toUpperCase())
    )
      delete env[key]
  }
  const python = report.tools.find((tool) => tool.name === 'python')?.path
  const paths = report.tools
    .filter((tool) => tool.status === 'found' && tool.path)
    .map((tool) => dirname(tool.path!))
  if (compilerPath) paths.unshift(dirname(compilerPath))
  if (report.idf.path) paths.push(join(report.idf.path, 'tools'))
  env.PATH = [...new Set(paths), inheritedPath].filter(Boolean).join(delimiter)
  env.IDF_PATH = report.idf.path
  env.IDF_TOOLS_PATH = toolsRoot
  env.IDF_TARGET = target
  env.PYTHONDONTWRITEBYTECODE = '1'
  env.PYTHONNOUSERSITE = '1'
  env.PYTHONIOENCODING = 'utf-8'
  env.GIT_OPTIONAL_LOCKS = '0'
  if (python && ['scripts', 'bin'].includes(basename(dirname(python)).toLowerCase())) {
    env.IDF_PYTHON_ENV_PATH = dirname(dirname(python))
  }
  return env
}

function diagnostics(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Не удалось выполнить проверку.'
  if ('killed' in error && error.killed) return 'Превышено время ожидания проверки.'
  const output = ['stdout', 'stderr']
    .map((key) =>
      key in error && typeof error[key as keyof typeof error] === 'string'
        ? String(error[key as keyof typeof error])
        : ''
    )
    .join('\n')
  // SDK diagnostic trailers may dump PATH; keep dependency messages only.
  return (
    output.split('Diagnostic information:')[0].trim().slice(0, 8000) ||
    ('code' in error && typeof error.code === 'string'
      ? `Не удалось запустить проверку (${error.code}).`
      : 'Команда проверки завершилась с ошибкой.')
  )
}

async function checkPythonPackages(
  report: EnvironmentReport,
  target: CheckTarget,
  roots: string[]
): Promise<ReadinessReport['pythonPackages']> {
  const python = report.tools.find((tool) => tool.name === 'python')
  if (
    report.idf.status !== 'found' ||
    !report.idf.path ||
    python?.status !== 'found' ||
    !python.path
  ) {
    return { status: 'skipped', detail: 'Для проверки нужны найденные ESP-IDF и Python.' }
  }
  const checker = join(report.idf.path, 'tools', 'check_python_dependencies.py')
  const requirements = join(report.idf.path, 'tools', 'requirements', 'requirements.core.txt')
  if (!(await isFile(checker)) || !(await isFile(requirements))) {
    return {
      status: 'missing',
      detail: 'В SDK отсутствует проверяющий скрипт или requirements.core.txt.'
    }
  }
  let constraintsPath: string | undefined
  const majorMinor = report.idf.version?.match(/^(\d+\.\d+)/)?.[1]
  if (majorMinor) {
    for (const root of roots) {
      const file = join(root, `espidf.constraints.v${majorMinor}.txt`)
      if (await isFile(file)) {
        constraintsPath = file
        break
      }
    }
  }
  const args = ['-B', checker, '--requirements', requirements]
  if (constraintsPath) args.push('--constraints', constraintsPath)
  try {
    const { stdout } = await execFileAsync(python.path, args, {
      shell: false,
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 128 * 1024,
      encoding: 'utf8',
      cwd: report.idf.path,
      env: createCheckEnvironment(report, target, roots[0])
    })
    if (!stdout.includes('Python requirements are satisfied.')) {
      return {
        status: 'error',
        path: python.path,
        constraintsPath,
        detail: 'Проверяющий скрипт не подтвердил выполнение требований.'
      }
    }
    return {
      status: constraintsPath ? 'passed' : 'partial',
      path: python.path,
      constraintsPath,
      detail: constraintsPath
        ? 'Основные Python-пакеты и их зависимости соответствуют локальным требованиям и ограничениям выбранного SDK.'
        : 'Основные пакеты найдены, но локальный constraints-файл отсутствует. Совместимость версий подтверждена не полностью.'
    }
  } catch (error) {
    return {
      status: 'error',
      path: python.path,
      constraintsPath,
      detail: 'Проверка Python-пакетов не пройдена.',
      diagnostics: diagnostics(error)
    }
  }
}

async function checkCompiler(
  report: EnvironmentReport,
  target: CheckTarget,
  roots: string[],
  definitions: ToolDefinition[],
  findTool: (root: string, executable: string) => Promise<string[]>
): Promise<ReadinessReport['compiler']> {
  if (report.idf.status !== 'found')
    return { status: 'skipped', detail: 'Сначала выберите доступный ESP-IDF.' }
  const names =
    target === 'esp32c3' || target === 'esp32c6'
      ? ['riscv32-esp-elf']
      : [`xtensa-${target}-elf`, 'xtensa-esp-elf']
  const definition = names
    .map((name) =>
      definitions.find((tool) => tool.name === name && tool.supported_targets?.includes(target))
    )
    .find(Boolean)
  if (!definition)
    return {
      status: 'missing',
      detail: `В tools.json выбранного SDK нет подходящего основного компилятора для ${target}.`
    }
  const expectedVersions = acceptedVersions(definition)
  const executable = `${definition.name}-gcc${process.platform === 'win32' ? '.exe' : ''}`
  const candidates: string[] = []
  for (const root of roots)
    candidates.push(...(await findTool(join(root, definition.name), executable)))
  const pathVariable =
    Object.entries(process.env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? ''
  for (const directory of pathVariable
    .split(delimiter)
    .map((value) => value.replace(/^"|"$/g, ''))
    .filter(isAbsolute)) {
    candidates.push(join(directory, executable))
  }
  let failure: ReadinessReport['compiler'] | undefined
  let attempts = 0
  for (const candidate of [...new Set(candidates)]) {
    if (!(await isFile(candidate))) continue
    if (++attempts > 5) break
    const options = {
      shell: false,
      windowsHide: true,
      timeout: 3000,
      maxBuffer: 64 * 1024,
      encoding: 'utf8' as const,
      cwd: dirname(candidate),
      env: createCheckEnvironment(report, target, roots[0], candidate)
    }
    try {
      const { stdout, stderr } = await execFileAsync(candidate, ['--version'], options)
      const version = `${stdout}\n${stderr}`.match(
        /\(crosstool-NG\s+(?:crosstool-ng-)?([0-9A-Za-z._-]+)\)/
      )?.[1]
      const machine = (await execFileAsync(candidate, ['-dumpmachine'], options)).stdout.trim()
      const compatible =
        !!version && expectedVersions.includes(version) && machine === definition.name
      const result: ReadinessReport['compiler'] = {
        status: compatible ? 'passed' : 'error',
        name: definition.name,
        path: candidate,
        version,
        machine,
        expectedVersions,
        detail: compatible
          ? `Версия и архитектура основного компилятора подходят для ${target}.`
          : 'Компилятор найден, но его версия или архитектура не соответствуют требованиям SDK.'
      }
      if (compatible) return result
      failure ??= result
    } catch (error) {
      failure ??= {
        status: 'error',
        name: definition.name,
        path: candidate,
        expectedVersions,
        detail: 'Не удалось проверить компилятор.',
        diagnostics: diagnostics(error)
      }
    }
  }
  return (
    failure ?? {
      status: 'missing',
      name: definition.name,
      expectedVersions,
      detail: `Основной компилятор ${definition.name} для ${target} не найден.`
    }
  )
}

export async function checkReadiness(
  report: EnvironmentReport,
  target: CheckTarget,
  roots: string[],
  findTool: (root: string, executable: string) => Promise<string[]>
): Promise<ReadinessReport> {
  let definitions: ToolDefinition[] = []
  if (report.idf.status === 'found' && report.idf.path) {
    try {
      const file = join(report.idf.path, 'tools', 'tools.json')
      if ((await stat(file)).size > 1024 * 1024) throw new Error('tools.json слишком большой')
      const data = JSON.parse(await readFile(file, 'utf8'))
      if (Array.isArray(data.tools))
        definitions = data.tools.filter(
          (tool: ToolDefinition) =>
            tool &&
            typeof tool.name === 'string' &&
            (tool.supported_targets === undefined ||
              (Array.isArray(tool.supported_targets) &&
                tool.supported_targets.every((value) => typeof value === 'string'))) &&
            (tool.versions === undefined ||
              (Array.isArray(tool.versions) &&
                tool.versions.every(
                  (version) =>
                    version &&
                    typeof version.name === 'string' &&
                    typeof version.status === 'string'
                )))
        )
    } catch {
      /* Individual checks report missing metadata, never assume compatibility. */
    }
  }
  const buildTools = (['cmake', 'ninja'] as const).map((name) => {
    const actual = report.tools.find((tool) => tool.name === name)
    const expectedVersions = acceptedVersions(definitions.find((tool) => tool.name === name))
    const status: DependencyCheck['status'] =
      actual?.status !== 'found'
        ? 'missing'
        : expectedVersions.length === 0
          ? 'partial'
          : expectedVersions.includes(actual.version ?? '')
            ? 'passed'
            : 'error'
    return {
      name,
      status,
      path: actual?.path,
      version: actual?.version,
      expectedVersions,
      detail:
        status === 'passed'
          ? 'Версия поддерживается tools.json выбранного SDK.'
          : status === 'partial'
            ? 'В tools.json нет данных для подтверждения совместимости.'
            : status === 'missing'
              ? 'Инструмент недоступен.'
              : 'Найденная версия отсутствует в списке поддерживаемых версий SDK.'
    }
  })
  const [pythonPackages, compiler] = await Promise.all([
    checkPythonPackages(report, target, roots),
    checkCompiler(report, target, roots, definitions, findTool)
  ])
  return {
    target,
    pythonPackages,
    compiler,
    buildTools,
    dependenciesPassed:
      report.basicToolsAvailable &&
      pythonPackages.status === 'passed' &&
      compiler.status === 'passed' &&
      buildTools.every((tool) => tool.status === 'passed')
  }
}
