/* eslint @typescript-eslint/no-require-imports: "off", @typescript-eslint/explicit-function-return-type: "off" -- Settings tests use a controlled filesystem. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
function fixture() {
  const files = new Map([
    ['C:\\p\\CMakeLists.txt', 'include(project.cmake)'],
    ['C:\\p\\.espai\\project.json', '{"board":"esp32s3","custom":"keep"}']
  ])
  const handlers = new Map()
  const control = { failWrite: false }
  const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' })
  const module = { exports: {} }
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(path.join(__dirname, '../src/main/projectSettings.ts'), 'utf8'),
      {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
      }
    ).outputText,
    {
      module,
      exports: module.exports,
      require(name) {
        if (name === 'path') return path.win32
        if (name.includes('shared/environment'))
          return { isCheckTarget: (value) => ['esp32s3', 'esp32c3'].includes(value) }
        if (name === './environment')
          return {
            inspectIdf: async (value) =>
              value === 'C:\\sdk' ? { path: value, version: '6.1' } : null
          }
        if (name === 'fs/promises')
          return {
            realpath: async (value) => value,
            readFile: async (value) => {
              if (!files.has(value)) throw missing()
              return files.get(value)
            },
            lstat: async (value) => {
              if (!files.has(value)) throw missing()
              return { isSymbolicLink: () => files.get(value) === 'link' }
            },
            mkdir: async (value) => files.set(value, 'directory'),
            writeFile: async (value, content) => {
              if (control.failWrite) throw new Error('disk full')
              files.set(value, content)
            },
            rename: async (source, destination) => {
              if (!files.has(source)) throw missing()
              files.set(destination, files.get(source))
              files.delete(source)
            }
          }
        return require(name)
      }
    }
  )
  module.exports.registerProjectSettings(
    { handle: (name, callback) => handlers.set(name, callback) },
    () => false
  )
  return {
    files,
    control,
    save: (extra = {}) =>
      handlers.get('project:save-settings')(
        {},
        { projectPath: 'C:\\p', board: 'esp32c3', idfPath: null, backupBuild: false, ...extra }
      )
  }
}
test('project settings preserve unrelated metadata and verify selected SDK', async () => {
  const f = fixture()
  assert.equal((await f.save({ idfPath: 'C:\\missing' })).success, false)
  assert.equal((await f.save({ idfPath: 'C:\\sdk' })).success, true)
  const result = JSON.parse(f.files.get('C:\\p\\.espai\\project.json'))
  assert.equal(result.custom, 'keep')
  assert.equal(result.board, 'esp32c3')
  assert.equal(result.idfPath, 'C:\\sdk')
})
test('target conflict requires explicit backup, preserving configuration and build', async () => {
  const f = fixture()
  f.files.set('C:\\p\\sdkconfig', 'CONFIG_IDF_TARGET="esp32s3"')
  f.files.set('C:\\p\\build', 'directory')
  assert.equal((await f.save()).success, false)
  assert.ok(f.files.has('C:\\p\\sdkconfig'))
  const result = await f.save({ backupBuild: true })
  assert.equal(result.success, true)
  assert.equal(f.files.has('C:\\p\\sdkconfig'), false)
  assert.ok(f.files.has(path.win32.join(result.backupPath, 'sdkconfig')))
  assert.ok(f.files.has(path.win32.join(result.backupPath, 'build')))
})
test('metadata write failure restores moved configuration; service links are rejected', async () => {
  const f = fixture()
  f.files.set('C:\\p\\sdkconfig', 'CONFIG_IDF_TARGET="esp32s3"')
  f.control.failWrite = true
  assert.equal((await f.save({ backupBuild: true })).success, false)
  assert.equal(f.files.get('C:\\p\\sdkconfig'), 'CONFIG_IDF_TARGET="esp32s3"')
  f.files.set('C:\\p\\.espai', 'link')
  assert.equal((await f.save()).success, false)
})
