/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
// Standalone Node.js script; no TypeScript runtime is required.
// Offline smoke build in a fresh, disposable project. Never flashes a device.
const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')

async function main() {
  const configPath = process.argv[2]
  if (!configPath) throw new Error('Usage: node tools/esp-idf-smoke-build.cjs <eim_idf.json>')
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'))
  const installation = config.idfInstalled?.find((item) => item.id === config.idfSelectedId)
  if (!installation) throw new Error('No selected ESP-IDF installation in EIM configuration')
  const { path: sdk, python, idfToolsPath: toolsRoot } = installation
  for (const value of [sdk, python, toolsRoot, config.gitPath]) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Invalid tool path')
    await fs.access(value)
  }
  const env = { ...process.env }
  const inheritedPath = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] || ''
  for (const key of Object.keys(env)) {
    if (
      [
        'PATH',
        'PYTHONHOME',
        'PYTHONPATH',
        'IDF_PATH',
        'IDF_TOOLS_PATH',
        'IDF_PYTHON_ENV_PATH',
        'IDF_TARGET'
      ].includes(key.toUpperCase())
    )
      delete env[key]
  }
  const metadata = JSON.parse(await fs.readFile(path.join(sdk, 'tools/tools.json'), 'utf8'))
  const paths = [path.dirname(python), path.dirname(config.gitPath), path.join(sdk, 'tools')]
  for (const tool of metadata.tools) {
    if (
      tool.supported_targets &&
      !tool.supported_targets.includes('all') &&
      !tool.supported_targets.includes('esp32s3')
    )
      continue
    const version = tool.versions.find((item) => item.status === 'recommended')?.name
    if (!version) continue
    const base = path.join(toolsRoot, tool.name, version)
    for (const parts of tool.export_paths || []) {
      const directory = path.join(base, ...parts)
      try {
        if ((await fs.stat(directory)).isDirectory()) paths.push(directory)
      } catch {
        /* Optional tool absent. */
      }
    }
    for (const [key, value] of Object.entries(tool.export_vars || {})) {
      env[key] = value.replaceAll('${TOOL_PATH}', base)
    }
  }
  Object.assign(env, {
    PATH: [...paths, inheritedPath].join(path.delimiter),
    IDF_PATH: sdk,
    IDF_TOOLS_PATH: toolsRoot,
    IDF_PYTHON_ENV_PATH: path.dirname(path.dirname(python)),
    IDF_TARGET: 'esp32s3',
    IDF_COMPONENT_MANAGER: '0',
    IDF_CCACHE_ENABLE: '0',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1',
    PYTHONIOENCODING: 'utf-8',
    GIT_OPTIONAL_LOCKS: '0'
  })
  const root = process.argv[3] || 'C:\\esp_projects'
  if (!path.isAbsolute(root)) throw new Error('Test project root must be an absolute path')
  await fs.mkdir(root, { recursive: true })
  const project = await fs.mkdtemp(path.join(root, 's3-'))
  await fs.mkdir(path.join(project, 'main'))
  await fs.writeFile(
    path.join(project, 'CMakeLists.txt'),
    'cmake_minimum_required(VERSION 3.22)\ninclude($ENV{IDF_PATH}/tools/cmake/project.cmake)\nproject(espai_smoke)\n'
  )
  await fs.writeFile(
    path.join(project, 'main/CMakeLists.txt'),
    'idf_component_register(SRCS "main.c" INCLUDE_DIRS ".")\n'
  )
  await fs.writeFile(
    path.join(project, 'main/main.c'),
    '#include <stdio.h>\nvoid app_main(void) { printf("Hello from ESP AI Studio!\\n"); }\n'
  )
  console.log(`Test project: ${project}`)
  const log = await fs.open(path.join(project, 'build.log'), 'w')
  try {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(
        python,
        ['-B', path.join(sdk, 'tools/idf.py'), '-C', project, '-D', 'IDF_TARGET=esp32s3', 'build'],
        {
          env,
          cwd: project,
          windowsHide: true,
          shell: false,
          stdio: ['ignore', log.fd, log.fd],
          timeout: 600000
        }
      )
      child.on('error', reject)
      child.on('close', resolve)
    })
    if (code !== 0)
      throw new Error(`Build failed (${code}); see ${path.join(project, 'build.log')}`)
    for (const file of [
      'espai_smoke.bin',
      'espai_smoke.elf',
      'bootloader/bootloader.bin',
      'partition_table/partition-table.bin'
    ]) {
      const artifact = path.join(project, 'build', file)
      console.log(`${artifact} (${(await fs.stat(artifact)).size} bytes)`)
    }
    console.log('ESP32-S3 smoke build passed. No device was flashed.')
  } finally {
    await log.close()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
