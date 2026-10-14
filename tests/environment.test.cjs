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

function detectorFixture() {
  const files = new Map()
  const calls = []
  const failures = new Set()
  const versions = new Map()
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
    return { stdout: versions.get(normalize(name)) ?? '', stderr: '' }
  }
  const requireModule = (name) => {
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
    env,
    add,
    normalize,
    filesystem,
    requireModule
  }
}

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
      throw new Error(`Unexpected import: ${name}`)
    },
    {
      window: {
        api: {
          checkEnvironment: () => {
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
  assert.equal(find((node) => node.type === 'select').props.value, '__auto__')
  find((node) => node.type === 'select').props.onChange({ target: { value: 'C:\\invalid' } })
  await new Promise(setImmediate)
  render()
  assert.equal(find((node) => node.props?.role === 'alert').props.children, 'invalid folder')
  assert.equal(find((node) => node.type === 'select').props.value, '__auto__')
  cleanupAgain()
})
