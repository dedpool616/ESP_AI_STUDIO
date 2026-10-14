/* eslint @typescript-eslint/no-require-imports: "off", @typescript-eslint/explicit-function-return-type: "off", @typescript-eslint/no-empty-function: "off" -- Node tests execute TypeScript source with inert platform mocks. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { promisify } = require('node:util')
const ts = require('typescript')

function loadSource(file, requireModule, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX
    }
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: requireModule,
    Error,
    ...globals
  })
  return module.exports
}
const sharedEnvironment = loadSource('src/shared/environment.ts', require)

function detectorFixture() {
  const files = new Map()
  const calls = []
  const failures = new Set()
  const versions = new Map()
  const commandOutputs = new Map()
  const commandErrors = new Map()
  const env = { PATH: 'C:\\mock\\bin' }
  const normalize = (value) => path.win32.normalize(value).toLowerCase()
  const add = (name, content = '') => files.set(normalize(name), content)
  const notFound = () => Object.assign(new Error('missing'), { code: 'ENOENT' })
  const filesystem = {
    stat: async (name) => {
      const key = normalize(name)
      if (files.has(key)) return { isFile: () => true, size: Buffer.byteLength(files.get(key)) }
      if ([...files.keys()].some((file) => file.startsWith(key + '\\')))
        return { isFile: () => false, size: 0 }
      throw notFound()
    },
    readFile: async (name) => {
      if (!files.has(normalize(name))) throw notFound()
      return files.get(normalize(name))
    },
    readdir: async (name) => {
      const prefix = normalize(name) + '\\'
      const names = new Set(
        [...files.keys()]
          .filter((file) => file.startsWith(prefix))
          .map((file) => file.slice(prefix.length))
          .filter((file) => file.includes('\\'))
          .map((file) => file.split('\\')[0])
      )
      return [...names].map((name) => ({
        name,
        isDirectory: () => true,
        isSymbolicLink: () => false
      }))
    },
    mkdir: async () => undefined,
    writeFile: async (name, content) => add(name, content),
    rename: async (oldName, newName) => {
      add(newName, files.get(normalize(oldName)))
      files.delete(normalize(oldName))
    }
  }
  const executable = () => undefined
  executable[promisify.custom] = async (name, args, options) => {
    calls.push({ name, args, options })
    if (failures.has(normalize(name))) throw Object.assign(new Error('timeout'), { killed: true })
    if (commandErrors.has(args[0])) throw commandErrors.get(args[0])
    if (commandOutputs.has(args[0])) return { stdout: commandOutputs.get(args[0]), stderr: '' }
    if (args[0] === '-B') return { stdout: 'Python requirements are satisfied.', stderr: '' }
    if (args[0] === '-dumpmachine')
      return { stdout: path.win32.basename(name).replace(/-gcc\.exe$/, ''), stderr: '' }
    return { stdout: versions.get(normalize(name)) ?? '', stderr: '' }
  }
  const requireModule = (name) => {
    if (name === '../shared/environment') return sharedEnvironment
    if (name === './environmentReadiness')
      return loadSource('src/main/environmentReadiness.ts', requireModule, {
        process: { platform: 'win32', env }
      })
    if (name === 'fs/promises') return filesystem
    if (name === 'os') return { homedir: () => 'C:\\mock\\user' }
    if (name === 'child_process') return { execFile: executable }
    return require(name)
  }
  const detector = loadSource('src/main/environment.ts', requireModule, {
    process: { platform: 'win32', env }
  })
  const sdk = 'C:\\mock\\sdk'
  for (const marker of ['tools/idf.py', 'tools/idf_tools.py', 'tools/cmake/project.cmake'])
    add(path.win32.join(sdk, marker))
  add(
    path.win32.join(sdk, 'tools/cmake/version.cmake'),
    'set(IDF_VERSION_MAJOR 6)\nset(IDF_VERSION_MINOR 1)\nset(IDF_VERSION_PATCH 0)'
  )
  const tools = {
    python: 'C:\\mock\\tools\\python\\venv\\Scripts\\python.exe',
    git: 'C:\\mock\\bin\\git.exe',
    cmake: 'C:\\mock\\tools\\cmake\\4.0.3\\bin\\cmake.exe',
    ninja: 'C:\\mock\\tools\\ninja\\1.12.1\\ninja.exe'
  }
  for (const [name, file] of Object.entries(tools)) {
    add(file)
    versions.set(
      normalize(file),
      {
        python: 'Python 3.13.7',
        git: 'git version 2.50.1.windows.1',
        cmake: 'cmake version 4.0.3',
        ninja: '1.12.1'
      }[name]
    )
  }
  add(
    'C:\\Espressif\\tools\\eim_idf.json',
    JSON.stringify({
      gitPath: tools.git,
      idfSelectedId: 'sdk-1',
      idfInstalled: [
        { id: 'sdk-1', path: sdk, python: tools.python, idfToolsPath: 'C:\\mock\\tools' }
      ]
    })
  )
  return {
    detector,
    sdk,
    tools,
    files,
    calls,
    failures,
    versions,
    commandOutputs,
    commandErrors,
    env,
    add,
    normalize,
    filesystem,
    requireModule
  }
}

function addDependencyFixture(fixture) {
  const root = 'C:\\mock\\tools'
  const gcc =
    root + '\\xtensa-esp-elf\\esp-15.2.0_20251204\\xtensa-esp-elf\\bin\\xtensa-esp-elf-gcc.exe'
  fixture.add(path.win32.join(fixture.sdk, 'tools/check_python_dependencies.py'))
  fixture.add(
    path.win32.join(fixture.sdk, 'tools/requirements/requirements.core.txt'),
    'packaging\nclick'
  )
  fixture.add(path.win32.join(root, 'espidf.constraints.v6.1.txt'), 'packaging==25.0')
  fixture.add(
    path.win32.join(fixture.sdk, 'tools/tools.json'),
    JSON.stringify({
      tools: [
        {
          name: 'xtensa-esp-elf',
          supported_targets: ['esp32', 'esp32s2', 'esp32s3'],
          versions: [{ name: 'esp-15.2.0_20251204', status: 'recommended' }]
        },
        {
          name: 'riscv32-esp-elf',
          supported_targets: ['esp32c3', 'esp32c6'],
          versions: [{ name: 'esp-15.2.0_20251204', status: 'recommended' }]
        },
        { name: 'cmake', versions: [{ name: '4.0.3', status: 'recommended' }] },
        { name: 'ninja', versions: [{ name: '1.12.1', status: 'recommended' }] }
      ]
    })
  )
  fixture.add(gcc)
  fixture.versions.set(
    fixture.normalize(gcc),
    'xtensa-esp-elf-gcc (crosstool-NG esp-15.2.0_20251204) 15.2.0'
  )
  return { root, gcc }
}

test('Python requirements, compiler architecture and SDK tool versions are checked offline', async () => {
  const fixture = detectorFixture()
  addDependencyFixture(fixture)
  const readiness = (await fixture.detector.checkEnvironment(null, 'esp32s3')).readiness
  assert.equal(readiness.target, 'esp32s3')
  assert.equal(readiness.pythonPackages.status, 'passed')
  assert.equal(readiness.compiler.status, 'passed')
  assert.equal(readiness.compiler.machine, 'xtensa-esp-elf')
  assert.equal(readiness.dependenciesPassed, true)
  const python = fixture.calls.find((call) => call.args[0] === '-B')
  assert.ok(python.args.includes('--requirements'))
  assert.ok(python.args.includes('--constraints'))
  assert.equal(python.options.env.PYTHONDONTWRITEBYTECODE, '1')
  assert.equal(python.options.env.IDF_TARGET, 'esp32s3')
  assert.equal(
    fixture.calls.every((call) => call.options.shell === false),
    true
  )
  assert.equal(
    fixture.calls.some((call) => call.args.includes('install')),
    false
  )
  assert.equal(fixture.env.IDF_TARGET, undefined)
})

test('missing local constraints never produces a fully passed Python check', async () => {
  const fixture = detectorFixture()
  const { root } = addDependencyFixture(fixture)
  fixture.files.delete(fixture.normalize(path.win32.join(root, 'espidf.constraints.v6.1.txt')))
  const readiness = (await fixture.detector.checkEnvironment(null, 'esp32s3')).readiness
  assert.equal(readiness.pythonPackages.status, 'partial')
  assert.equal(readiness.dependenciesPassed, false)
  assert.equal(
    fixture.calls.find((call) => call.args[0] === '-B').args.includes('--constraints'),
    false
  )
})

test('Python failure preserves dependency diagnostics without the environment dump', async () => {
  const fixture = detectorFixture()
  addDependencyFixture(fixture)
  fixture.commandErrors.set(
    '-B',
    Object.assign(new Error('package mismatch'), {
      stdout: 'Requirement click>=8 was not met.\nDiagnostic information:\nPATH: sensitive-value',
      stderr: ''
    })
  )
  const readiness = (await fixture.detector.checkEnvironment(null, 'esp32s3')).readiness
  assert.equal(readiness.pythonPackages.status, 'error')
  assert.ok(readiness.pythonPackages.diagnostics.includes('click>=8'))
  assert.equal(readiness.pythonPackages.diagnostics.includes('sensitive-value'), false)
  assert.equal(readiness.compiler.status, 'passed')
  assert.equal(readiness.dependenciesPassed, false)
})

test('wrong compiler architecture and wrong SDK build tool versions are rejected', async () => {
  const fixture = detectorFixture()
  addDependencyFixture(fixture)
  fixture.commandOutputs.set('-dumpmachine', 'riscv32-esp-elf')
  fixture.versions.set(fixture.normalize(fixture.tools.cmake), 'cmake version 4.1.0')
  const readiness = (await fixture.detector.checkEnvironment(null, 'esp32s3')).readiness
  assert.equal(readiness.compiler.status, 'error')
  assert.equal(readiness.buildTools.find((tool) => tool.name === 'cmake').status, 'error')
  assert.equal(readiness.dependenciesPassed, false)
})

test('RISC-V target does not accept an installed Xtensa compiler', async () => {
  const fixture = detectorFixture()
  addDependencyFixture(fixture)
  const readiness = (await fixture.detector.checkEnvironment(null, 'esp32c3')).readiness
  assert.equal(readiness.compiler.name, 'riscv32-esp-elf')
  assert.equal(readiness.compiler.status, 'missing')
  assert.equal(readiness.dependenciesPassed, false)
})

test('incompatible compiler version and missing SDK metadata cannot pass readiness', async () => {
  const fixture = detectorFixture()
  const { gcc } = addDependencyFixture(fixture)
  fixture.versions.set(fixture.normalize(gcc), 'xtensa-esp-elf-gcc (crosstool-NG esp-old) 11.2.0')
  assert.equal(
    (await fixture.detector.checkEnvironment(null, 'esp32s3')).readiness.compiler.status,
    'error'
  )
  fixture.files.delete(fixture.normalize(path.win32.join(fixture.sdk, 'tools/tools.json')))
  const readiness = (await fixture.detector.checkEnvironment(null, 'esp32s3')).readiness
  assert.equal(readiness.compiler.status, 'missing')
  assert.equal(readiness.dependenciesPassed, false)
})

test('invalid target is rejected at IPC boundary before checking or changing settings', async () => {
  const fixture = detectorFixture()
  const handlers = new Map()
  const ipc = loadSource('src/main/environmentIpc.ts', (name) =>
    name === './environment' ? fixture.detector : fixture.requireModule(name)
  )
  ipc.registerEnvironmentHandlers(
    { handle: (name, callback) => handlers.set(name, callback) },
    'C:\\mock\\settings',
    async () => null
  )
  assert.equal((await handlers.get('environment:check')({}, 'esp32; install')).success, false)
  assert.equal(
    (await handlers.get('environment:select-idf')({}, fixture.sdk, 'unknown')).success,
    false
  )
  assert.equal(fixture.calls.length, 0)
  assert.equal(
    fixture.files.has(fixture.normalize('C:\\mock\\settings\\environment-settings.json')),
    false
  )
})

test('checks isolate SDK and Python paths without changing the parent environment', async () => {
  const fixture = detectorFixture()
  addDependencyFixture(fixture)
  fixture.env.IDF_PATH = 'C:\\old-sdk'
  fixture.env.PYTHONPATH = 'C:\\old-python-modules'
  const original = JSON.stringify(fixture.env)
  await fixture.detector.checkEnvironment(null, 'esp32s3')
  const python = fixture.calls.find((call) => call.args[0] === '-B')
  assert.equal(python.options.env.IDF_PATH, fixture.sdk)
  assert.equal(python.options.env.PYTHONPATH, undefined)
  assert.equal(python.options.env.IDF_PYTHON_ENV_PATH, 'C:\\mock\\tools\\python\\venv')
  assert.equal(JSON.stringify(fixture.env), original)
})

test('malformed tool version metadata is reported without crashing the check', async () => {
  const fixture = detectorFixture()
  addDependencyFixture(fixture)
  fixture.add(
    path.win32.join(fixture.sdk, 'tools/tools.json'),
    JSON.stringify({ tools: [{ name: 'xtensa-esp-elf', supported_targets: 0, versions: 0 }] })
  )
  const report = await fixture.detector.checkEnvironment(null, 'esp32s3')
  assert.equal(report.readiness.compiler.status, 'missing')
  assert.equal(report.readiness.dependenciesPassed, false)
})

test('EIM installation is detected outside PATH and only fixed version commands are executed', async () => {
  const fixture = detectorFixture()
  const report = await fixture.detector.checkEnvironment()
  assert.equal(report.idf.path, fixture.sdk)
  assert.equal(report.idf.version, '6.1.0')
  assert.equal(report.idf.source, 'Espressif Installation Manager')
  assert.equal(report.basicToolsAvailable, true)
  assert.equal(report.tools.find((tool) => tool.name === 'python').path, fixture.tools.python)
  assert.equal(report.tools.find((tool) => tool.name === 'cmake').version, '4.0.3')
  assert.equal(fixture.calls.length, 4)
  for (const call of fixture.calls) {
    assert.equal(call.args.join(','), '--version')
    assert.equal(call.options.shell, false)
    assert.equal(call.options.windowsHide, true)
    assert.equal(call.options.timeout, 3000)
  }
  assert.equal(fixture.env.IDF_PATH, undefined)
})

test('invalid saved SDK path does not silently select another installation', async () => {
  const fixture = detectorFixture()
  const report = await fixture.detector.checkEnvironment('C:\\missing-sdk')
  assert.equal(report.idf.status, 'invalid')
  assert.equal(report.idf.path, 'C:\\missing-sdk')
  assert.equal(report.basicToolsAvailable, false)
  assert.equal(report.installations.length, 1)
})

test('missing tool and timeout are reported independently, Store aliases are never executed', async () => {
  const fixture = detectorFixture()
  fixture.files.delete(fixture.normalize(fixture.tools.ninja))
  fixture.failures.add(fixture.normalize(fixture.tools.cmake))
  fixture.env.PATH += ';C:\\mock\\Microsoft\\WindowsApps'
  fixture.add('C:\\mock\\Microsoft\\WindowsApps\\python.exe')
  const report = await fixture.detector.checkEnvironment()
  assert.equal(report.tools.find((tool) => tool.name === 'ninja').status, 'missing')
  assert.equal(report.tools.find((tool) => tool.name === 'cmake').status, 'error')
  assert.equal(report.tools.find((tool) => tool.name === 'git').status, 'found')
  assert.equal(
    fixture.calls.some((call) => call.name.includes('WindowsApps')),
    false
  )
  assert.equal(report.basicToolsAvailable, false)
})

test('malformed registration is recoverable and ordinary projects are not SDK installations', async () => {
  const fixture = detectorFixture()
  fixture.add('C:\\Espressif\\tools\\eim_idf.json', '{broken')
  const report = await fixture.detector.checkEnvironment()
  assert.equal(report.idf.status, 'missing')
  assert.equal(report.warnings.length, 1)
  fixture.add('C:\\mock\\project\\CMakeLists.txt', 'include(project.cmake)')
  assert.equal(await fixture.detector.inspectIdf('C:\\mock\\project'), null)
})

test('SDK selection persists separately, invalid selection and dialog cancellation preserve it', async () => {
  const fixture = detectorFixture()
  let chosenFolder = null
  const handlers = new Map()
  const ipc = loadSource('src/main/environmentIpc.ts', (name) =>
    name === './environment' ? fixture.detector : fixture.requireModule(name)
  )
  ipc.registerEnvironmentHandlers(
    { handle: (name, callback) => handlers.set(name, callback) },
    'C:\\mock\\settings',
    async () => chosenFolder
  )
  assert.equal((await handlers.get('environment:select-idf')({}, fixture.sdk)).success, true)
  assert.equal((await handlers.get('environment:check')()).report.selectedPath, fixture.sdk)
  assert.equal((await handlers.get('environment:select-idf')({}, 'C:\\not-sdk')).success, false)
  assert.equal((await handlers.get('environment:check')()).report.selectedPath, fixture.sdk)
  assert.equal((await handlers.get('environment:choose-idf')()).canceled, true)
  assert.equal((await handlers.get('environment:check')()).report.selectedPath, fixture.sdk)
  chosenFolder = fixture.sdk
  assert.equal((await handlers.get('environment:choose-idf')()).success, true)
  assert.equal((await handlers.get('environment:select-idf')({}, null)).success, true)
  assert.equal((await handlers.get('environment:check')()).report.selectedPath, null)
})

test('concurrent configuration actions are rejected and cancellation releases the lock', async () => {
  const fixture = detectorFixture()
  let resolveFolder
  const folder = new Promise((resolve) => {
    resolveFolder = resolve
  })
  const handlers = new Map()
  const ipc = loadSource('src/main/environmentIpc.ts', (name) =>
    name === './environment' ? fixture.detector : fixture.requireModule(name)
  )
  ipc.registerEnvironmentHandlers(
    { handle: (name, callback) => handlers.set(name, callback) },
    'C:\\mock\\settings',
    () => folder
  )
  const choosing = handlers.get('environment:choose-idf')()
  assert.equal((await handlers.get('environment:select-idf')({}, fixture.sdk)).success, false)
  resolveFolder(null)
  assert.equal((await choosing).canceled, true)
  assert.equal((await handlers.get('environment:check')()).success, true)
})

test('EnvironmentPage survives StrictMode replay and folder cancellation without stale loading state', async () => {
  const slots = []
  let checkedTarget
  let cursor = 0,
    effect,
    tree,
    calls = 0,
    resolveCheck
  const pending = new Promise((resolve) => {
    resolveCheck = resolve
  })
  const react = {
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = initial
      return [
        slots[i],
        (value) => {
          slots[i] = typeof value === 'function' ? value(slots[i]) : value
        }
      ]
    },
    useRef(initial) {
      const i = cursor++
      return (slots[i] ??= { current: initial })
    },
    useCallback: (callback) => callback,
    useEffect: (callback) => {
      effect = callback
    }
  }
  const report = {
    checkedAt: '2026-10-14T00:00:00Z',
    selectedPath: null,
    idf: { status: 'missing', detail: 'not found' },
    installations: [],
    tools: [],
    warnings: [],
    basicToolsAvailable: false
  }
  const Component = loadSource(
    'src/renderer/src/pages/EnvironmentPage.tsx',
    (name) => {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime') return require(name)
      if (name.includes('shared/environment')) return sharedEnvironment
      throw new Error(`Unexpected import: ${name}`)
    },
    {
      window: {
        api: {
          checkEnvironment: (target) => {
            checkedTarget = target
            calls++
            return pending
          },
          chooseIdf: async () => ({ success: false, canceled: true }),
          selectIdf: async () => ({ success: false, error: 'invalid folder' })
        }
      }
    }
  ).default
  const render = () => {
    cursor = 0
    tree = Component()
  }
  const find = (predicate, node = tree) => {
    if (!node || typeof node !== 'object') return null
    if (predicate(node)) return node
    for (const child of [node.props?.children].flat(Infinity)) {
      if (child == null) continue
      const match = find(predicate, child)
      if (match) return match
    }
    return null
  }
  render()
  const cleanup = effect()
  cleanup()
  const cleanupAgain = effect()
  assert.equal(calls, 1)
  resolveCheck({ success: true, report })
  await new Promise(setImmediate)
  render()
  assert.equal(
    find((node) => node.type === 'button' && node.props.children === 'Проверить окружение').props
      .disabled,
    false
  )
  find(
    (node) => node.type === 'button' && node.props.children === 'Указать папку ESP-IDF'
  ).props.onClick()
  await new Promise(setImmediate)
  render()
  assert.equal(
    find((node) => node.type === 'button' && node.props.children === 'Проверить окружение').props
      .disabled,
    false
  )
  assert.ok(find((node) => node.type === 'select' && node.props.value === '__auto__'))
  find((node) => node.type === 'select' && node.props.value === '__auto__').props.onChange({
    target: { value: 'C:\\invalid' }
  })
  await new Promise(setImmediate)
  render()
  assert.equal(find((node) => node.props?.role === 'alert').props.children, 'invalid folder')
  assert.ok(find((node) => node.type === 'select' && node.props.value === '__auto__'))
  find((node) => node.type === 'select' && node.props.value === 'esp32s3').props.onChange({
    target: { value: 'esp32c3' }
  })
  render()
  assert.ok(
    find((node) => node.type === 'button' && node.props.children === 'Проверка…').props.disabled
  )
  cleanupAgain()
  const cleanupTarget = effect()
  await new Promise(setImmediate)
  render()
  assert.equal(checkedTarget, 'esp32c3')
  assert.equal(
    find((node) => node.type === 'select' && node.props.value === 'esp32c3').props.disabled,
    false
  )
  cleanupTarget()
})
