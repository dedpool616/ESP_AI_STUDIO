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
      if (name.includes('shared/monitor')) return { monitorBaudRates: [115200, 9600] }
      if (name === 'child_process')
        return {
          execFile(executable, args, options, callback) {
            assert.equal(options.shell, false)
            assert.equal(options.windowsHide, true)
            callback(null, JSON.stringify([{ device: 'COM3', description: 'USB serial' }]))
          },
          spawn(executable, args, options) {
            calls.push({ executable, args, options })
            child = new EventEmitter()
            child.stdout = new EventEmitter()
            child.stderr = new EventEmitter()
            child.kill = () => child.emit('close', null)
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
    monitorStart: (baud = 115200) => handlers.get('monitor:start')({}, 'esp32s3', 'COM3', baud),
    monitorState: () => handlers.get('monitor:state')(),
    monitorStop: () => handlers.get('monitor:stop')(),
    monitorClear: () => handlers.get('monitor:clear')(),
    ports: () => handlers.get('serial:ports')({}, 'esp32s3'),
    flash: (port = 'COM3') => handlers.get('flash:start')({}, 'C:\\project', 'esp32s3', port),
    start: (project = 'C:\\project', target = 'esp32s3') =>
      handlers.get('build:start')({}, project, target),
    state: () => handlers.get('build:state')(),
    child: () => child
  }
}
const settle = () => new Promise((resolve) => setImmediate(resolve))

test('monitor validates baud, streams protocol, blocks flash, clears output and disconnects', async () => {
  const f = fixture()
  assert.equal((await f.monitorStart(1)).success, false)
  assert.equal((await f.monitorStart()).success, true)
  f.child().stdout.emit('data', Buffer.from('{"ready":true}\n{"data":"Hello ESP"}\n'))
  assert.equal(f.monitorState().status, 'connected')
  assert.equal(f.monitorState().log, 'Hello ESP')
  assert.equal(f.flash().success, false)
  f.monitorClear()
  assert.equal(f.monitorState().log, '')
  f.monitorStop()
  assert.equal(f.monitorState().status, 'disconnected')
})

test('monitor reports device failure and ignores output from disconnected process', async () => {
  const f = fixture()
  await f.monitorStart()
  const previous = f.child()
  previous.stdout.emit('data', Buffer.from('{"error":"device removed"}\n'))
  previous.emit('close', 1)
  assert.equal(f.monitorState().status, 'error')
  assert.equal(f.monitorState().error, 'device removed')
  f.monitorStop()
  previous.stdout.emit('data', Buffer.from('{"ready":true}\n'))
  assert.equal(f.monitorState().status, 'disconnected')
})

test('disconnect during preparation cancels connection before spawning Python', async () => {
  const f = fixture()
  const pending = f.monitorStart()
  f.monitorStop()
  assert.equal((await pending).success, false)
  assert.equal(f.calls.length, 0)
})

test('port discovery is read-only and flashing requires valid port and matching build', async () => {
  const f = fixture()
  assert.equal((await f.ports()).ports[0].device, 'COM3')
  assert.equal(f.calls.length, 0)
  assert.equal(f.flash('COM3 & command').success, false)
  f.flash()
  await settle()
  assert.equal(f.state().status, 'error')
  assert.equal(f.calls.length, 0)
  f.files.set(
    'C:\\project\\build\\project_description.json',
    JSON.stringify({ target: 'esp32s3', project_path: 'C:/project' })
  )
  f.flash('COM9')
  await settle()
  assert.equal(f.state().status, 'error')
  assert.equal(f.calls.length, 0)
  f.flash()
  assert.equal(f.start().success, false)
  await settle()
  assert.equal(f.calls[0].args.at(-1), 'flash')
  assert.ok(f.calls[0].args.includes('COM3'))
  f.child().emit('close', 0)
  await settle()
  assert.equal(f.state().status, 'success')
  assert.equal(f.state().operation, 'flash')
})

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
