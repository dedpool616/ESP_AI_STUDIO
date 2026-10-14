/* eslint @typescript-eslint/no-require-imports: "off", @typescript-eslint/explicit-function-return-type: "off" -- Execute TypeScript backend with controlled filesystem and process mocks. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const ts = require('typescript')

function fixture() {
  const files = new Map()
  const handlers = new Map()
  const calls = []
  let child
  const report = {
    idf: { path: 'C:\\sdk', version: '6.1' },
    tools: [{ name: 'python', path: 'C:\\python.exe' }],
    readiness: {
      dependenciesPassed: true,
      compiler: { path: 'C:\\gcc.exe' },
      pythonPackages: { constraintsPath: 'C:\\tools\\constraints.txt' }
    }
  }
  const code = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '../src/main/projectBuild.ts'), 'utf8'),
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }
  ).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    Buffer,
    Date,
    Error,
    require(name) {
      if (name === 'path') return path.win32
      if (name === 'fs/promises')
        return {
          stat: async () => ({ isFile: () => true, isDirectory: () => true }),
          realpath: async (value) => value,
          readFile: async (file) => {
            if (file === 'C:\\sdk\\tools\\tools.json') return '{"tools":[]}'
            if (files.has(file)) return files.get(file)
            throw Object.assign(new Error('missing'), { code: 'ENOENT' })
          }
        }
      if (name === './environment') return { checkEnvironment: async () => report }
      if (name === './environmentReadiness')
        return { createCheckEnvironment: () => ({ PATH: 'selected-tools' }) }
      if (name.includes('shared/environment'))
        return { isCheckTarget: (value) => ['esp32s3', 'esp32c3'].includes(value) }
      if (name === 'child_process')
        return {
          spawn(executable, args, options) {
            calls.push({ executable, args, options })
            child = new EventEmitter()
            child.stdout = new EventEmitter()
            child.stderr = new EventEmitter()
            return child
          }
        }
      return require(name)
    }
  })
  module.exports.registerBuildHandlers(
    { handle: (name, callback) => handlers.set(name, callback) },
    'C:\\userdata'
  )
  return {
    files,
    calls,
    report,
    api: module.exports,
    start: (project = 'C:\\project', target = 'esp32s3') =>
      handlers.get('build:start')({}, project, target),
    state: () => handlers.get('build:state')(),
    child: () => child
  }
}
const settle = () => new Promise((resolve) => setImmediate(resolve))

test('build rejects invalid requests and parallel starts; streams UTF-8 output and succeeds', async () => {
  const f = fixture()
  assert.equal(f.start('relative').success, false)
  assert.equal(f.start('C:\\project', 'invalid').success, false)
  assert.equal(f.start().success, true)
  assert.equal(f.start().success, false)
  await settle()
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].options.shell, false)
  assert.equal(f.calls[0].options.windowsHide, true)
  assert.equal(f.calls[0].options.env.IDF_COMPONENT_MANAGER, '0')
  assert.equal(f.calls[0].args.at(-1), 'build')
  const message = Buffer.from('Сборка')
  f.child().stdout.emit('data', message.subarray(0, 1))
  f.child().stdout.emit('data', message.subarray(1))
  f.child().emit('close', 0)
  await settle()
  assert.equal(f.state().status, 'success')
  assert.match(f.state().log, /Сборка/)
})

test('wrong target and moved build cache fail before any process is launched', async () => {
  const f = fixture()
  f.files.set('C:\\project\\sdkconfig', 'CONFIG_IDF_TARGET="esp32c3"')
  f.start()
  await settle()
  assert.equal(f.state().status, 'error')
  assert.equal(f.calls.length, 0)
  f.files.delete('C:\\project\\sdkconfig')
  f.files.set('C:\\project\\build\\CMakeCache.txt', 'CMAKE_HOME_DIRECTORY:INTERNAL=C:\\old')
  f.start()
  await settle()
  assert.match(f.state().error, /другом расположении/)
  assert.equal(f.calls.length, 0)
})

test('missing dependencies and external components block build without installing', async () => {
  const f = fixture()
  f.report.readiness.dependenciesPassed = false
  f.start()
  await settle()
  assert.equal(f.state().status, 'error')
  assert.equal(f.calls.length, 0)
  f.files.set('C:\\project\\main\\idf_component.yml', 'dependencies: {}')
  f.start()
  await settle()
  assert.match(f.state().error, /внешними компонентами/)
})

test('nonzero exit keeps bounded diagnostics and unlocks the next build', async () => {
  const f = fixture()
  f.start()
  await settle()
  f.child().stderr.emit('data', Buffer.from('x'.repeat(300000)))
  f.child().emit('close', 1)
  await settle()
  assert.equal(f.state().status, 'error')
  assert.ok(f.state().log.length <= 256 * 1024)
  assert.equal(f.start().success, true)
})
