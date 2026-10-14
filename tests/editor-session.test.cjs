/* eslint @typescript-eslint/no-require-imports: "off", @typescript-eslint/explicit-function-return-type: "off", @typescript-eslint/no-empty-function: "off" -- Plain Node.js tests use CommonJS and intentionally inert platform mocks. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const os = require('node:os')
const ts = require('typescript')

function loadSource(relativePath, requireModule, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX
    }
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, require: requireModule, ...globals })
  return module.exports
}

const sessionsApi = loadSource('src/shared/editorSession.ts', require)
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

// Run the actual component handlers/effects with a tiny hook host. No Electron,
// network, user project files, or additional dependencies are needed.
function editorHost(api = {}) {
  const slots = []
  let index = 0,
    tree,
    sessions = {},
    projectPath = 'A'
  let effects = [],
    layouts = []
  const listeners = new Map()
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i])
  const effect = (callback, deps, queue) => {
    const i = index++
    if (!sameDeps(slots[i]?.deps, deps)) {
      queue.push(() => {
        slots[i]?.cleanup?.()
        slots[i] = { deps, cleanup: callback() }
      })
    }
  }
  const react = {
    useState(initial) {
      const i = index++
      if (!(i in slots)) slots[i] = initial
      return [
        slots[i],
        (value) => {
          slots[i] = typeof value === 'function' ? value(slots[i]) : value
        }
      ]
    },
    useRef(initial) {
      const i = index++
      return (slots[i] ??= { current: initial })
    },
    useCallback: (callback) => callback,
    useEffect: (callback, deps) => effect(callback, deps, effects),
    useLayoutEffect: (callback, deps) => effect(callback, deps, layouts)
  }
  const Editor = () => null
  const Component = loadSource(
    'src/renderer/src/pages/CodeEditorPage.tsx',
    (name) => {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime') return require(name)
      if (name === '@monaco-editor/react') return { default: Editor, loader: { config() {} } }
      if (name === 'monaco-editor') return {}
      if (name.includes('?worker')) return function Worker() {}
      if (name.includes('shared/editorSession')) return sessionsApi
      throw new Error(`Unexpected import: ${name}`)
    },
    {
      self: {},
      window: {
        api: { getProjectTree: async () => ({ success: true, tree: [] }), ...api },
        setTimeout: () => 0,
        clearTimeout() {},
        addEventListener: (name, fn) => listeners.set(name, fn),
        removeEventListener: (name) => listeners.delete(name)
      }
    }
  ).default
  const render = () => {
    index = 0
    effects = []
    layouts = []
    tree = Component({
      projectPath,
      projectName: projectPath,
      isActive: true,
      sessions,
      setSessions: (update) => {
        sessions = update(sessions)
      },
      onSavingChange() {},
      blocked: false
    })
    layouts.forEach((fn) => fn())
    effects.forEach((fn) => fn())
  }
  const find = (predicate, node = tree) => {
    if (!node || typeof node !== 'object') return null
    if (predicate(node)) return node
    for (const child of [node.props?.children].flat(Infinity)) {
      if (child == null) continue
      const found = find(predicate, child)
      if (found) return found
    }
    return null
  }
  render()
  return {
    render,
    get sessions() {
      return sessions
    },
    switchProject(value) {
      projectPath = value
      render()
    },
    async open(relativePath) {
      // Insert a file in the mocked tree and use the real handler supplied to TreeNode.
      const treeState = slots.findIndex((slot) => Array.isArray(slot))
      slots[treeState] = [{ name: relativePath, relativePath, type: 'file' }]
      slots[treeState + 1] = false
      render()
      return find((node) => node.props?.onOpenFile)?.props.onOpenFile({
        name: relativePath,
        relativePath,
        type: 'file'
      })
    },
    edit(value) {
      render()
      find((node) => node.type === Editor).props.onChange(value)
      render()
    },
    save() {
      render()
      listeners.get('keydown')({ ctrlKey: true, key: 's', preventDefault() {} })
    },
    saveAll() {
      render()
      find((node) => node.props?.className === 'save-all-button').props.onClick()
    },
    get saveAllDisabled() {
      render()
      return find((node) => node.props?.className === 'save-all-button').props.disabled
    },
    get error() {
      render()
      return find((node) => node.props?.role === 'alert')?.props.children
    }
  }
}

test('old state and malformed sessions do not erase valid recovery buffers', () => {
  assert.equal(Object.keys(sessionsApi.parseEditorSessions(undefined)).length, 0)
  const parsed = sessionsApi.parseEditorSessions({
    A: {
      openFiles: [
        { name: 'main.c', relativePath: 'main.c', content: 'draft', savedContent: 'disk' }
      ],
      activeFilePath: 'missing'
    },
    B: { openFiles: [null, { relativePath: 123 }] }
  })
  assert.equal(parsed.A.activeFilePath, 'main.c')
  assert.equal(parsed.A.openFiles[0].content, 'draft')
  assert.equal(parsed.B.openFiles.length, 0)
})

test('project A → B → A retains tabs and drafts with identical file names', async () => {
  const host = editorHost({
    readProjectFile: async (project) => ({ success: true, content: project })
  })
  await host.open('main.c')
  host.edit('draft A')
  host.switchProject('B')
  await host.open('main.c')
  host.edit('draft B')
  host.switchProject('A')
  assert.equal(host.sessions.A.openFiles[0].content, 'draft A')
  assert.equal(host.sessions.A.activeFilePath, 'main.c')
  assert.equal(host.sessions.B.openFiles[0].content, 'draft B')
  const restored = sessionsApi.parseEditorSessions(JSON.parse(JSON.stringify(host.sessions)))
  assert.equal(restored.A.openFiles[0].content, 'draft A')
  assert.equal(restored.B.activeFilePath, 'main.c')
})

test('typing during async save remains dirty and duplicate saves are blocked', async () => {
  const save = deferred()
  const writes = []
  const host = editorHost({
    readProjectFile: async () => ({ success: true, content: 'disk' }),
    saveProjectFile: (...args) => {
      writes.push(args)
      return save.promise
    }
  })
  await host.open('main.c')
  host.edit('sent')
  host.save()
  host.save()
  host.edit('new draft')
  save.resolve({ success: true })
  await save.promise
  await new Promise(setImmediate)
  assert.equal(writes.length, 1)
  assert.equal(writes[0][2], 'sent')
  assert.equal(host.sessions.A.openFiles[0].savedContent, 'sent')
  assert.equal(host.sessions.A.openFiles[0].content, 'new draft')
  assert.equal(sessionsApi.hasUnsavedChanges(host.sessions.A), true)
})

test('stale read is discarded even after A → B → A', async () => {
  const read = deferred()
  const host = editorHost({ readProjectFile: () => read.promise })
  const opening = host.open('main.c')
  host.switchProject('B')
  host.switchProject('A')
  read.resolve({ success: true, content: 'stale' })
  await opening
  assert.equal(host.sessions.A, undefined)
  assert.equal(host.sessions.B, undefined)
})

test('duplicate pending reads open only one tab', async () => {
  const read = deferred()
  let calls = 0
  const host = editorHost({
    readProjectFile: () => {
      calls++
      return read.promise
    }
  })
  const first = host.open('main.c'),
    second = host.open('main.c')
  read.resolve({ success: true, content: 'disk' })
  await Promise.all([first, second])
  assert.equal(calls, 1)
  assert.equal(host.sessions.A.openFiles.length, 1)
})

test('failed save keeps original baseline and allows retry', async () => {
  let calls = 0
  const host = editorHost({
    readProjectFile: async () => ({ success: true, content: 'disk' }),
    saveProjectFile: async () => {
      calls++
      throw new Error('write failed')
    }
  })
  await host.open('main.c')
  host.edit('draft')
  host.save()
  await new Promise(setImmediate)
  host.save()
  await new Promise(setImmediate)
  assert.equal(calls, 2)
  assert.equal(host.sessions.A.openFiles[0].savedContent, 'disk')
})

test('save all writes dirty files in this project, skips clean files, and protects new edits', async () => {
  const pending = deferred()
  const writes = []
  const host = editorHost({
    readProjectFile: async () => ({ success: true, content: 'disk' }),
    saveProjectFile: (project, file, content) => {
      writes.push({ project, file, content })
      return writes.length === 1 ? pending.promise : Promise.resolve({ success: true })
    }
  })
  await host.open('clean.c')
  await host.open('main/main.c')
  host.edit('first draft')
  await host.open('components/device.c')
  host.edit('second draft')
  host.switchProject('B')
  await host.open('other.c')
  host.edit('project B draft')
  host.switchProject('A')
  host.saveAll()
  host.saveAll()
  assert.equal(host.saveAllDisabled, true)
  host.edit('second draft edited during save')
  pending.resolve({ success: true })
  await new Promise(setImmediate)
  assert.equal(writes.length, 2)
  assert.equal(
    writes.every((write) => write.project === 'A'),
    true
  )
  assert.equal(
    writes.some((write) => write.file === 'clean.c'),
    false
  )
  assert.equal(writes[1].content, 'second draft')
  const second = host.sessions.A.openFiles.find(
    (file) => file.relativePath === 'components/device.c'
  )
  assert.equal(second.savedContent, 'second draft')
  assert.equal(second.content, 'second draft edited during save')
  assert.equal(host.sessions.B.openFiles[0].savedContent, 'disk')
  host.saveAll()
  await new Promise(setImmediate)
  assert.equal(writes.length, 3)
  assert.equal(host.saveAllDisabled, true)
})

test('save all continues after a failed file and retains failed buffers as dirty', async () => {
  const writes = []
  const host = editorHost({
    readProjectFile: async () => ({ success: true, content: 'disk' }),
    saveProjectFile: async (_project, file) => {
      writes.push(file)
      return file === 'broken.c' ? { success: false, error: 'access denied' } : { success: true }
    }
  })
  await host.open('broken.c')
  host.edit('unsaved first')
  await host.open('good.c')
  host.edit('saved second')
  host.saveAll()
  await new Promise(setImmediate)
  assert.equal(writes.join(','), 'broken.c,good.c')
  assert.equal(host.sessions.A.openFiles[0].savedContent, 'disk')
  assert.equal(host.sessions.A.openFiles[1].savedContent, 'saved second')
  assert.ok(host.error.includes('broken.c: access denied'))
  assert.equal(host.saveAllDisabled, false)
})

function mainHost(fsApi = require('node:fs/promises'), userData = 'unused') {
  const handlers = new Map()
  const ipcMain = new EventEmitter()
  ipcMain.handle = (name, callback) => handlers.set(name, callback)
  const windows = []
  class BrowserWindow extends EventEmitter {
    constructor() {
      super()
      windows.push(this)
      this.webContents = {
        send: (name) => {
          this.lastMessage = name
        },
        setWindowOpenHandler() {}
      }
    }
    loadFile() {}
    show() {}
    close() {
      let blocked = false
      this.emit('close', {
        preventDefault() {
          blocked = true
        }
      })
      if (!blocked) {
        this.closed = true
        this.emit('closed')
      }
    }
  }
  loadSource(
    'src/main/index.ts',
    (name) => {
      if (name === './environmentIpc') return { registerEnvironmentHandlers() {} }
      if (name === 'electron')
        return {
          app: {
            getPath: () => userData,
            whenReady: () => ({ then: (callback) => callback() }),
            on() {}
          },
          BrowserWindow,
          ipcMain,
          shell: {},
          dialog: {}
        }
      if (name === 'fs/promises') return fsApi
      if (name === '@electron-toolkit/utils')
        return {
          electronApp: { setAppUserModelId() {} },
          optimizer: {},
          is: { dev: false }
        }
      if (name.includes('?asset')) return 'icon'
      if (name.includes('shared/editorSession')) return sessionsApi
      return require(name)
    },
    { process, __dirname, console }
  )
  return { window: windows[0], ipcMain, handlers }
}

test('App keeps drafts on switching and refuses to close after failed session persistence', async () => {
  const slots = []
  let index = 0,
    effects = [],
    tree,
    requestClose,
    confirmations = 0,
    failSave = true
  let createCalls = 0
  let recentUnavailable = false
  let unavailablePath = 'B'
  let selectedFolder = 'C:/projects'
  const Editor = () => null
  const react = {
    useState(initial) {
      const i = index++
      if (!(i in slots)) slots[i] = initial
      return [
        slots[i],
        (value) => {
          slots[i] = typeof value === 'function' ? value(slots[i]) : value
        }
      ]
    },
    useRef(initial) {
      const i = index++
      return (slots[i] ??= { current: initial })
    },
    useCallback: (callback) => callback,
    useEffect(callback, deps) {
      const i = index++
      if (!slots[i] || deps.some((value, n) => value !== slots[i].deps[n])) {
        effects.push(() => {
          slots[i]?.cleanup?.()
          slots[i] = { deps, cleanup: callback() }
        })
      }
    }
  }
  react.useLayoutEffect = react.useEffect
  const projects = ['A', 'B'].map((value) => ({
    name: value,
    path: value,
    board: '',
    idfVersion: 'later',
    gitMode: 'none'
  }))
  const Component = loadSource(
    'src/renderer/src/App.tsx',
    (name) => {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime') return require(name)
      if (name.includes('CodeEditorPage')) return { default: Editor }
      if (name.includes('EnvironmentPage')) return { default: function EnvironmentPage() {} }
      if (name.includes('ProjectUnavailableDialog'))
        return { default: function UnavailableDialog() {} }
      if (name.includes('RecentProjectMenu')) return { default: function RecentMenu() {} }
      if (name.includes('shared/editorSession')) return sessionsApi
      throw new Error(`Unexpected import: ${name}`)
    },
    {
      window: {
        api: {
          openProject: async () => ({ success: true, project: projects[0] }),
          selectFolder: async () => selectedFolder,
          inspectProject: async (projectPath) =>
            recentUnavailable && projectPath === unavailablePath
              ? { success: false, error: 'missing folder' }
              : {
                  success: true,
                  project: projects.find((project) => project.path === projectPath) ?? {
                    ...projects[1],
                    path: projectPath
                  }
                },
          createProject: async () => {
            createCalls++
            throw new Error('creation unavailable')
          },
          loadAppState: async () => ({
            currentProject: projects[0],
            recentProjects: projects,
            editorSessions: {
              A: {
                openFiles: [
                  { name: 'main.c', relativePath: 'main.c', content: 'draft', savedContent: 'disk' }
                ],
                activeFilePath: 'main.c'
              }
            }
          }),
          onCloseRequested: (callback) => {
            requestClose = callback
            return () => undefined
          },
          saveAppState: async () => ({
            success: !failSave,
            error: failSave ? 'disk full' : undefined
          }),
          confirmClose: () => {
            confirmations++
          }
        },
        setTimeout: () => 0,
        clearTimeout() {}
      },
      console,
      Error
    }
  ).default
  const render = () => {
    index = 0
    effects = []
    tree = Component()
    effects.forEach((callback) => callback())
  }
  const find = (predicate, node = tree) => {
    if (!node || typeof node !== 'object') return null
    if (predicate(node)) return node
    for (const child of [node.props?.children].flat(Infinity)) {
      if (child == null) continue
      const result = find(predicate, child)
      if (result) return result
    }
    return null
  }
  render()
  await new Promise(setImmediate)
  render()
  // Removing an available, currently open project only removes its recent entry.
  const currentCard = find(
    (node) =>
      node.props?.className === 'recent-project-card' &&
      node.props.children[0].props.children[0].props.children === 'A'
  )
  currentCard.props.onContextMenu({
    preventDefault() {},
    clientX: 40,
    clientY: 50,
    currentTarget: {}
  })
  render()
  find((node) => node.props?.trigger && node.props?.onRemove).props.onRemove()
  render()
  assert.equal(
    find(
      (node) =>
        node.props?.className === 'recent-project-card' &&
        node.props.children[0].props.children[0].props.children === 'A'
    ),
    null
  )
  assert.equal(find((node) => node.type === Editor).props.projectPath, 'A')
  assert.equal(find((node) => node.type === Editor).props.sessions.A.openFiles[0].content, 'draft')
  find((node) => node.props?.className === 'secondary-action').props.onClick()
  await new Promise(setImmediate)
  render()
  find((node) => node.type === 'button' && node.props.children === 'Home').props.onClick()
  render()
  find(
    (node) =>
      node.props?.className === 'recent-project-card' &&
      node.props.children[0].props.children[0].props.children === 'B'
  ).props.onClick()
  await new Promise(setImmediate)
  render()
  assert.equal(find((node) => node.type === Editor).props.projectPath, 'A')
  find(
    (node) => node.type === 'button' && node.props.children === 'Переключить, сохранив правки'
  ).props.onClick()
  render()
  assert.equal(find((node) => node.type === Editor).props.projectPath, 'B')
  assert.equal(find((node) => node.type === Editor).props.sessions.A.openFiles[0].content, 'draft')
  // Invalid names stay in the app form; typing a correction and retrying works
  // without reopening the form or showing any native browser alert.
  find((node) => node.type === 'button' && node.props.children === 'Home').props.onClick()
  render()
  find((node) => node.props?.className === 'primary-action').props.onClick()
  render()
  find((node) => node.type === 'input' && node.props.placeholder === 'MyESPProject').props.onChange(
    { target: { value: 'Проект' } }
  )
  render()
  await find((node) => node.props?.className === 'create-button').props.onClick()
  render()
  assert.equal(createCalls, 0)
  assert.ok(find((node) => node.props?.id === 'project-form-error'))
  find((node) => node.type === 'input' && node.props.placeholder === 'MyESPProject').props.onChange(
    { target: { value: 'Valid_Project-1' } }
  )
  render()
  assert.equal(
    find((node) => node.props?.id === 'project-form-error'),
    null
  )
  await find((node) => node.props?.className === 'browse-button').props.onClick()
  render()
  await find((node) => node.props?.className === 'create-button').props.onClick()
  render()
  assert.equal(createCalls, 1)
  assert.ok(
    find(
      (node) =>
        node.props?.id === 'project-form-error' &&
        node.props.children.includes('creation unavailable')
    )
  )
  assert.equal(find((node) => node.props?.className === 'create-button').props.disabled, false)
  find((node) => node.props?.className === 'cancel-button').props.onClick()
  render()
  // Closing a dirty project keeps its session and permits cancellation.
  find(
    (node) =>
      node.props?.className === 'recent-project-card' &&
      node.props.children[0].props.children[0].props.children === 'A'
  ).props.onClick()
  await new Promise(setImmediate)
  render()
  find((node) => node.type === 'button' && node.props.children === 'Close Project').props.onClick()
  render()
  find((node) => node.type === 'button' && node.props.children === 'Отмена').props.onClick()
  render()
  assert.equal(find((node) => node.type === Editor).props.projectPath, 'A')
  find((node) => node.type === 'button' && node.props.children === 'Close Project').props.onClick()
  render()
  find(
    (node) => node.type === 'button' && node.props.children === 'Закрыть, сохранив сессию'
  ).props.onClick()
  render()
  assert.equal(find((node) => node.type === Editor).props.projectPath, undefined)
  assert.equal(find((node) => node.type === Editor).props.sessions.A.openFiles[0].content, 'draft')
  recentUnavailable = true
  find(
    (node) =>
      node.props?.className === 'recent-project-card' &&
      node.props.children[0].props.children[0].props.children === 'B'
  ).props.onClick()
  await new Promise(setImmediate)
  render()
  let unavailable = find((node) => node.props?.error === 'missing folder')
  assert.ok(unavailable)
  unavailable.props.onCancel()
  render()
  assert.equal(find((node) => node.type === Editor).props.projectPath, undefined)
  // Reopen the unavailable entry and point it at a validated new folder.
  find(
    (node) =>
      node.props?.className === 'recent-project-card' &&
      node.props.children[0].props.children[0].props.children === 'B'
  ).props.onClick()
  await new Promise(setImmediate)
  render()
  selectedFolder = 'C:/moved-B'
  find((node) => node.props?.error === 'missing folder').props.onLocate()
  await new Promise(setImmediate)
  render()
  assert.equal(find((node) => node.type === Editor).props.projectPath, 'C:/moved-B')
  const movedEditor = find((node) => node.type === Editor)
  movedEditor.props.setSessions((sessions) => ({
    ...sessions,
    'C:/moved-B': {
      openFiles: [
        { name: 'main.c', relativePath: 'main.c', content: 'recovery draft', savedContent: 'disk' }
      ],
      activeFilePath: 'main.c'
    }
  }))
  render()
  unavailablePath = 'C:/moved-B'
  find((node) => node.type === 'button' && node.props.children === 'Home').props.onClick()
  render()
  find(
    (node) =>
      node.props?.className === 'recent-project-card' &&
      node.props.children[0].props.children[1].props.children === 'C:/moved-B'
  ).props.onClick()
  await new Promise(setImmediate)
  render()
  find((node) => node.props?.error === 'missing folder').props.onRemove()
  render()
  assert.equal(find((node) => node.type === Editor).props.projectPath, undefined)
  assert.equal(
    find((node) => node.type === Editor).props.sessions['C:/moved-B'].openFiles[0].content,
    'recovery draft'
  )
  assert.equal(
    find(
      (node) =>
        node.props?.className === 'recent-project-card' &&
        node.props.children[0].props.children[1].props.children === 'C:/moved-B'
    ),
    null
  )
  requestClose()
  render()
  find((node) => node.type === 'button' && node.props.children === 'Отмена').props.onClick()
  render()
  assert.equal(confirmations, 0)
  requestClose()
  render()
  find(
    (node) => node.type === 'button' && node.props.children === 'Сохранить сессии и выйти'
  ).props.onClick()
  await new Promise(setImmediate)
  render()
  assert.equal(confirmations, 0)
  assert.ok(find((node) => node.props?.role === 'alert' && node.props.children === 'disk full'))
  failSave = false
  find(
    (node) => node.type === 'button' && node.props.children === 'Сохранить сессии и выйти'
  ).props.onClick()
  await new Promise(setImmediate)
  assert.equal(confirmations, 1)
})

test('close requires renderer acknowledgement and rejects another sender', () => {
  const host = mainHost()
  host.window.close()
  assert.equal(host.window.closed, undefined)
  assert.equal(host.window.lastMessage, 'window:request-close')
  host.ipcMain.emit('window:confirm-close', { sender: {} })
  assert.equal(host.window.closed, undefined)
  host.ipcMain.emit('window:confirm-close', { sender: host.window.webContents })
  assert.equal(host.window.closed, true)
  assert.equal(host.ipcMain.listenerCount('window:confirm-close'), 0)
})

test('relocation preserves dirty buffers and refuses to overwrite another session', () => {
  const session = {
    openFiles: [{ name: 'main.c', relativePath: 'main.c', content: 'draft', savedContent: 'disk' }],
    activeFilePath: 'main.c'
  }
  const original = { old: session }
  const moved = sessionsApi.relocateEditorSession(original, 'old', 'new')
  assert.equal(moved.old, undefined)
  assert.equal(moved.new.openFiles[0].content, 'draft')
  assert.equal(moved.new.activeFilePath, 'main.c')
  assert.equal(original.old, session)
  assert.throws(() =>
    sessionsApi.relocateEditorSession({ old: session, new: session }, 'old', 'new')
  )
})

test('project inspection rejects unavailable folders and non-IDF projects before opening', async () => {
  const root = path.resolve('mock-project')
  let exists = false,
    directory = true,
    cmakeExists = true,
    validCmake = true
  const host = mainHost({
    stat: async (target) => {
      if (target !== root || !exists) throw new Error('missing')
      return { isDirectory: () => directory }
    },
    access: async () => {
      if (!cmakeExists) throw new Error('missing CMake')
    },
    readFile: async (target) => {
      if (target === path.join(root, 'CMakeLists.txt'))
        return validCmake ? 'include(project.cmake)\nproject(example)' : 'project(other)'
      if (target === path.join(root, '.espai', 'project.json'))
        return JSON.stringify({ board: 'esp32s3', idfVersion: 'recommended' })
      throw new Error('missing optional file')
    }
  })
  const inspect = host.handlers.get('project:inspect')
  assert.equal((await inspect({}, 'relative/path')).success, false)
  assert.equal((await inspect({}, root)).success, false)
  exists = true
  directory = false
  assert.equal((await inspect({}, root)).success, false)
  directory = true
  cmakeExists = false
  assert.equal((await inspect({}, root)).success, false)
  cmakeExists = true
  validCmake = false
  assert.equal((await inspect({}, root)).success, false)
  validCmake = true
  const opened = await inspect({}, root)
  assert.equal(opened.success, true)
  assert.equal(opened.project.path, root)
  assert.equal(opened.project.name, 'example')
  assert.equal(opened.project.board, 'esp32s3')
})

test('queued atomic state writes preserve latest snapshot and recover after a failure', async () => {
  const fsApi = require('node:fs/promises')
  const directory = await fsApi.mkdtemp(path.join(os.tmpdir(), 'espai-state-test-'))
  let fail = true
  const host = mainHost(
    {
      ...fsApi,
      writeFile: async (...args) => {
        if (fail) {
          fail = false
          throw new Error('simulated disk failure')
        }
        return fsApi.writeFile(...args)
      }
    },
    directory
  )
  try {
    const save = host.handlers.get('storage:save-app-state')
    const first = save({}, { currentProject: null, recentProjects: [], editorSessions: {} })
    const state = {
      currentProject: null,
      recentProjects: [],
      editorSessions: {
        A: {
          openFiles: [
            { name: 'main.c', relativePath: 'main.c', content: 'draft', savedContent: 'disk' }
          ],
          activeFilePath: 'main.c'
        }
      }
    }
    const second = save({}, state)
    // Mutation after enqueue must not alter the saved snapshot.
    state.editorSessions.A.openFiles[0].content = 'later'
    assert.equal((await first).success, false)
    assert.equal((await second).success, true)
    const restored = await host.handlers.get('storage:load-app-state')()
    assert.equal(restored.editorSessions.A.openFiles[0].content, 'draft')
    assert.equal((await fsApi.readdir(directory)).includes('app-state.json.tmp'), false)
  } finally {
    // Only this test's freshly-created temporary directory is removed.
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
    assert.equal(path.basename(directory).startsWith('espai-state-test-'), true)
    await fsApi.rm(directory, { recursive: true, force: true })
  }
})
