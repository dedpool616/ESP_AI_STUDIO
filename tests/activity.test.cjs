/* eslint @typescript-eslint/no-require-imports: "off", @typescript-eslint/explicit-function-return-type: "off" -- Activity tests use a virtual filesystem. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
function fixture(initial) {
  const files = new Map()
  if (initial !== undefined) files.set('C:\\data\\activity.json', initial)
  const control = { fail: false, writes: 0 }
  const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' })
  const module = { exports: {} }
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/main/activity.ts'), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText,
    {
      module,
      exports: module.exports,
      Error,
      require(name) {
        if (name === 'path') return path.win32
        if (name === 'fs/promises')
          return {
            stat: async (value) => {
              if (!files.has(value)) throw missing()
              return { size: files.get(value).length }
            },
            readFile: async (value) => {
              if (!files.has(value)) throw missing()
              return files.get(value)
            },
            mkdir: async () => {},
            writeFile: async (value, text) => {
              control.writes++
              if (control.fail) throw new Error('disk full')
              files.set(value, text)
            },
            rename: async (source, destination) => {
              files.set(destination, files.get(source))
              files.delete(source)
            }
          }
        return require(name)
      }
    }
  )
  return {
    files,
    control,
    api: module.exports,
    store: module.exports.createActivityStore('C:\\data')
  }
}
const entry = (projectPath, action = 'Сохранение файла') => ({
  projectPath,
  action,
  status: 'success'
})
test('activity persists serialized writes and filters by normalized project path', async () => {
  const f = fixture()
  await Promise.all([f.store.record(entry('C:\\Project')), f.store.record(entry('C:\\Other'))])
  assert.equal((await f.store.list()).entries.length, 2)
  assert.equal((await f.store.list('c:/project')).entries.length, 1)
  const restored = f.api.createActivityStore('C:\\data')
  assert.equal((await restored.list()).entries.length, 2)
})
test('activity keeps 500 entries and recovers after persistence failure', async () => {
  const f = fixture()
  f.control.fail = true
  await f.store.record(entry('C:\\p'))
  assert.ok((await f.store.list()).warning)
  f.control.fail = false
  for (let i = 0; i < 505; i++) await f.store.record(entry('C:\\p', String(i)))
  const result = await f.store.list()
  assert.equal(result.entries.length, 500)
  assert.equal(result.entries[0].action, '504')
  assert.equal(result.warning, undefined)
})
test('corrupt history is preserved and new entries stay in memory', async () => {
  const f = fixture('invalid json')
  await f.store.record(entry('C:\\p'))
  assert.equal(f.files.get('C:\\data\\activity.json'), 'invalid json')
  assert.equal(f.control.writes, 0)
  assert.equal((await f.store.list()).entries.length, 1)
  assert.ok((await f.store.list()).warning)
})
test('IPC records metadata without file contents or returned disk versions', async () => {
  const f = fixture()
  const handlers = new Map(),
    recorded = []
  const ipc = f.api.activityIpc(
    { handle: (channel, listener) => handlers.set(channel, listener) },
    async (value) => recorded.push(value)
  )
  ipc.handle('project:save-file', async () => ({
    success: false,
    conflict: true,
    currentContent: 'secret disk text',
    error: 'changed outside'
  }))
  await handlers.get('project:save-file')(
    {},
    'C:\\p',
    'main.c',
    'secret editor text',
    'secret baseline'
  )
  assert.equal(recorded[0].relativePath, 'main.c')
  assert.equal(recorded[0].status, 'error')
  assert.equal(JSON.stringify(recorded).includes('secret'), false)
})
