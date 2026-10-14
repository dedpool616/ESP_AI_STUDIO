/* eslint @typescript-eslint/no-require-imports: "off", @typescript-eslint/explicit-function-return-type: "off" -- Execute pure TypeScript parser using Node test runner. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const moduleSource = { exports: {} }
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '../src/shared/buildDiagnostics.ts'), 'utf8'),
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }
  ).outputText,
  { module: moduleSource, exports: moduleSource.exports }
)
const { parseBuildDiagnostics, diagnosticProjectPath } = moduleSource.exports

test('GCC Windows paths, columns, fatal errors and ANSI output are parsed without duplicates', () => {
  const message = 'C:/esp_projects/test1/main/main.c:8:5: error: expected semicolon'
  const result = parseBuildDiagnostics(
    `\x1b[31m${message}\x1b[0m\n${message}\nC:\\esp_projects\\test1\\main\\main.c:2: warning: unused variable\nmain/header.h:4:1: fatal error: missing.h: No such file`,
    'C:\\esp_projects\\test1'
  )
  assert.equal(result.length, 3)
  assert.equal(result[0].relativePath, 'main/main.c')
  assert.equal(result[0].line, 8)
  assert.equal(result[0].column, 5)
  assert.equal(result[1].column, 1)
  assert.equal(result[1].severity, 'warning')
  assert.equal(result[2].severity, 'error')
})

test('external SDK files, traversal and similarly named directories cannot be opened as project files', () => {
  for (const file of [
    'C:/sdk/main.c',
    'C:/project-other/main.c',
    '../main.c',
    'main/../../main.c',
    'file://main.c'
  ])
    assert.equal(diagnosticProjectPath(file, 'C:/project'), undefined)
  assert.equal(diagnosticProjectPath('C:/PROJECT/main/main.c', 'C:/project'), 'main/main.c')
  const result = parseBuildDiagnostics('C:/sdk/main.c:9:2: warning: deprecated', 'C:/project')
  assert.equal(result.length, 1)
  assert.equal(result[0].relativePath, undefined)
})

test('ordinary output and invalid locations are ignored; list is bounded', () => {
  assert.equal(
    parseBuildDiagnostics(
      'ninja: build stopped\nmain.c:0: error: invalid\nmain.c:1:0: error: invalid',
      'C:/project'
    ).length,
    0
  )
  const output = Array.from({ length: 600 }, (_, i) => `main.c:${i + 1}:1: error: failure`).join(
    '\n'
  )
  assert.equal(parseBuildDiagnostics(output, 'C:/project').length, 500)
})
