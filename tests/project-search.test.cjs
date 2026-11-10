/* eslint @typescript-eslint/no-require-imports: "off", @typescript-eslint/explicit-function-return-type: "off" -- Search tests use disposable temporary projects. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const ts = require('typescript')
async function load() {
  const module = { exports: {} }
  vm.runInNewContext(
    ts.transpileModule(
      await fs.readFile(path.join(__dirname, '../src/main/projectSearch.ts'), 'utf8'),
      {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
      }
    ).outputText,
    { module, exports: module.exports, require, Date }
  )
  return module.exports.searchProject
}
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'espai-search-'))
  t.after(async () => {
    const resolved = path.resolve(directory)
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep + 'espai-search-'))
    await fs.rm(resolved, { recursive: true, force: true })
  })
  await fs.writeFile(path.join(directory, 'CMakeLists.txt'), 'include(project.cmake)')
  return {
    directory,
    search: await load(),
    write: async (name, content) => {
      const full = path.join(directory, name)
      await fs.mkdir(path.dirname(full), { recursive: true })
      await fs.writeFile(full, content)
    }
  }
}
test('search finds UTF-8 text with correct positions and optional case sensitivity', async (t) => {
  const f = await fixture(t)
  await f.write('main/main.c', 'Hello hello\r\nПривет мир\n')
  const result = await f.search({ projectPath: f.directory, query: 'hello', caseSensitive: false })
  assert.equal(result.success, true)
  assert.equal(result.matches.length, 2)
  assert.equal(result.matches[0].relativePath, 'main/main.c')
  assert.equal(result.matches[1].column, 7)
  const exact = await f.search({ projectPath: f.directory, query: 'Hello', caseSensitive: true })
  assert.equal(exact.matches.length, 1)
  const russian = await f.search({ projectPath: f.directory, query: 'мир', caseSensitive: true })
  assert.equal(russian.matches[0].line, 2)
  assert.equal(russian.matches[0].column, 8)
})
test('search skips generated directories, binary, invalid UTF-8 and large files; query is literal', async (t) => {
  const f = await fixture(t)
  for (const name of [
    'build/generated.c',
    '.git/config',
    '.espai/backups/config',
    'node_modules/file',
    'dist/file'
  ])
    await f.write(name, 'needle')
  await f.write('binary.bin', Buffer.from([110, 101, 101, 100, 108, 101, 0]))
  await f.write('invalid.txt', Buffer.from([255, 110, 101, 101, 100, 108, 101]))
  await f.write('large.txt', 'needle'.repeat(400000))
  await f.write('source.txt', 'a.*[b] needle')
  const result = await f.search({ projectPath: f.directory, query: 'needle', caseSensitive: true })
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].relativePath, 'source.txt')
  assert.ok(result.skipped >= 3)
  const literal = await f.search({
    projectPath: f.directory,
    query: 'a.*[b]',
    caseSensitive: false
  })
  assert.equal(literal.matches.length, 1)
})
test('invalid requests are rejected and results are capped', async (t) => {
  const f = await fixture(t)
  await f.write('matches.txt', 'hit '.repeat(600))
  const result = await f.search({ projectPath: f.directory, query: 'hit', caseSensitive: true })
  assert.equal(result.matches.length, 500)
  assert.equal(result.truncated, true)
  for (const query of ['', ' ', 'a'.repeat(257)])
    assert.equal(
      (await f.search({ projectPath: f.directory, query, caseSensitive: true })).success,
      false
    )
  assert.equal(
    (await f.search({ projectPath: 'relative', query: 'hit', caseSensitive: true })).success,
    false
  )
})
