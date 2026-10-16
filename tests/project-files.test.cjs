/* eslint @typescript-eslint/no-require-imports: "off", @typescript-eslint/explicit-function-return-type: "off" -- Filesystem mutation tests use controlled mocks. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function fixture() {
  const entries = new Map([
    ['C:\\project', 'directory'],
    ['C:\\project\\CMakeLists.txt', 'file'],
    ['C:\\project\\main', 'directory'],
    ['C:\\project\\main\\main.c', 'file']
  ])
  const calls = []
  let handler
  const module = { exports: {} }
  const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' })
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(path.join(__dirname, '../src/main/projectFiles.ts'), 'utf8'),
      {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
      }
    ).outputText,
    {
      module,
      exports: module.exports,
      require(name) {
        if (name === 'path') return path.win32
        if (name === 'fs/promises')
          return {
            realpath: async (value) => value,
            lstat: async (value) => {
              if (!entries.has(value)) throw missing()
              const type = entries.get(value)
              return {
                isFile: () => type === 'file',
                isDirectory: () => type === 'directory',
                isSymbolicLink: () => type === 'link'
              }
            },
            writeFile: async (...args) => calls.push(['write', ...args]),
            mkdir: async (...args) => calls.push(['mkdir', ...args]),
            rename: async (...args) => calls.push(['rename', ...args])
          }
        return require(name)
      }
    }
  )
  module.exports.registerProjectFileHandlers(
    {
      handle: (_, callback) => {
        handler = callback
      }
    },
    async (value) => calls.push(['trash', value]),
    () => false
  )
  return {
    entries,
    calls,
    api: module.exports,
    mutate: (action, relativePath, name) =>
      handler({}, { action, projectPath: 'C:\\project', relativePath, name })
  }
}

test('creation is exclusive, rename stays in parent, deletion uses trash', async () => {
  const f = fixture()
  assert.equal((await f.mutate('create-file', 'main', 'new.c')).relativePath, 'main/new.c')
  assert.equal(f.calls[0][3].flag, 'wx')
  assert.equal((await f.mutate('create-directory', '', 'include')).success, true)
  assert.equal((await f.mutate('rename', 'main/main.c', 'app.c')).relativePath, 'main/app.c')
  assert.equal((await f.mutate('delete', 'main/main.c')).success, true)
  assert.equal(f.calls.at(-1)[0], 'trash')
})

test('invalid names, traversal, protected paths, links and overwrite are rejected', async () => {
  const f = fixture()
  for (const name of ['CON', 'nul.txt', '../escape', 'bad:name', 'name.', '.git', 'build'])
    assert.equal((await f.mutate('create-file', '', name)).success, false)
  for (const relative of ['', '../outside', '.git/config', 'build/file', 'C:\\outside'])
    assert.equal((await f.mutate('delete', relative)).success, false)
  assert.equal((await f.mutate('create-file', 'main', 'main.c')).success, false)
  f.entries.set('C:\\project\\linked', 'link')
  assert.equal((await f.mutate('delete', 'linked')).success, false)
  assert.equal(f.calls.length, 0)
})
