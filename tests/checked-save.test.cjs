/* eslint @typescript-eslint/no-require-imports: "off", @typescript-eslint/explicit-function-return-type: "off" -- Checked saves use an in-memory filesystem. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
function fixture(content = 'disk') {
  const disk = { content, calls: [] }
  const module = { exports: {} }
  const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' })
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(path.join(__dirname, '../src/main/checkedSave.ts'), 'utf8'),
      {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
      }
    ).outputText,
    {
      module,
      exports: module.exports,
      Error,
      require(name) {
        if (name === 'fs/promises')
          return {
            stat: async () => {
              if (disk.content === null) throw missing()
              return { isFile: () => true, size: disk.content.length }
            },
            readFile: async () => disk.content,
            writeFile: async (file, text, options) => {
              disk.calls.push({ file, text, options })
              disk.content = text
            }
          }
        return require(name)
      }
    }
  )
  return { disk, save: (expected) => module.exports.checkedSave('file', 'editor text', expected) }
}
test('changed disk content is returned as conflict without overwriting', async () => {
  const f = fixture('changed outside')
  const result = await f.save('old baseline')
  assert.equal(result.conflict, true)
  assert.equal(result.currentContent, 'changed outside')
  assert.equal(f.disk.calls.length, 0)
  assert.equal((await f.save('changed outside')).success, true)
})
test('deleted files require explicit recreation and use exclusive creation', async () => {
  const f = fixture(null)
  const result = await f.save('disk')
  assert.equal(result.conflict, true)
  assert.equal(result.currentContent, null)
  assert.equal(f.disk.calls.length, 0)
  assert.equal((await f.save(null)).success, true)
  assert.equal(f.disk.calls[0].options.flag, 'wx')
})
test('old clients without baseline and binary changes cannot overwrite', async () => {
  const f = fixture()
  assert.equal((await f.save(undefined)).success, false)
  f.disk.content = 'binary\u0000data'
  assert.equal((await f.save('disk')).success, false)
  assert.equal(f.disk.calls.length, 0)
})
