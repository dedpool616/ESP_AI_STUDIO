import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { EditorLocation } from '../../../shared/buildDiagnostics'
import FileCompareDialog, { type FileComparison } from '../components/FileCompareDialog'
import { affectsFile, type FileAction } from '../../../shared/projectFiles'
import {
  emptyEditorSession,
  markFileSaved,
  type EditorSessions,
  type OpenFile
} from '../../../shared/editorSession'

import Editor, { loader } from '@monaco-editor/react'

import * as monaco from 'monaco-editor'

import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') {
      return new jsonWorker()
    }

    if (label === 'css' || label === 'scss' || label === 'less') {
      return new cssWorker()
    }

    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new htmlWorker()
    }

    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker()
    }

    return new editorWorker()
  }
}

loader.config({
  monaco
})

interface ProjectTreeNode {
  name: string
  relativePath: string
  type: 'file' | 'directory'
  children?: ProjectTreeNode[]
}

interface CodeEditorPageProps {
  locationRequest?: EditorLocation | null
  projectName?: string
  projectPath?: string
  isActive?: boolean
  sessions: EditorSessions
  setSessions: Dispatch<SetStateAction<EditorSessions>>
  onSavingChange: (saving: boolean) => void
  blocked: boolean
}

interface TreeNodeProps {
  onManage?: (node: ProjectTreeNode, x: number, y: number) => void
  renderEntry?: (node: ProjectTreeNode, position: 'name' | 'children') => React.ReactNode
  node: ProjectTreeNode
  activeFilePath?: string
  onOpenFile: (node: ProjectTreeNode) => void
}

function getLanguage(fileName: string): string {
  const lower = fileName.toLowerCase()

  if (
    lower.endsWith('.c') ||
    lower.endsWith('.h') ||
    lower.endsWith('.cpp') ||
    lower.endsWith('.hpp')
  ) {
    return 'cpp'
  }

  if (lower.endsWith('.json')) {
    return 'json'
  }

  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) {
    return 'typescript'
  }

  if (lower.endsWith('.js') || lower.endsWith('.jsx')) {
    return 'javascript'
  }

  if (lower.endsWith('.css')) {
    return 'css'
  }

  if (lower.endsWith('.html')) {
    return 'html'
  }

  if (lower.endsWith('.md')) {
    return 'markdown'
  }

  return 'plaintext'
}

function TreeNode({
  node,
  activeFilePath,
  onOpenFile,
  onManage,
  renderEntry
}: TreeNodeProps): React.JSX.Element {
  if (node.type === 'directory') {
    return (
      <details className="tree-directory" open>
        <summary
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onManage?.(node, event.clientX, event.clientY)
          }}
        >
          <span className="tree-icon">▾</span>

          {renderEntry?.(node, 'name') ?? node.name}
        </summary>

        <div className="tree-children">
          {renderEntry?.(node, 'children')}
          {node.children?.map((child) => (
            <TreeNode
              key={child.relativePath}
              node={child}
              activeFilePath={activeFilePath}
              onOpenFile={onOpenFile}
              onManage={onManage}
              renderEntry={renderEntry}
            />
          ))}
        </div>
      </details>
    )
  }

  const editing = renderEntry?.(node, 'name')
  if (editing) return <div className="tree-file">{editing}</div>

  return (
    <button
      type="button"
      className={`tree-file ${activeFilePath === node.relativePath ? 'active' : ''}`}
      onClick={() => onOpenFile(node)}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onManage?.(node, event.clientX, event.clientY)
      }}
    >
      <span className="tree-file-icon">◦</span>

      {node.name}
    </button>
  )
}

function CodeEditorPage({
  locationRequest,
  projectName,
  projectPath,
  isActive = true,
  sessions,
  setSessions,
  onSavingChange,
  blocked: parentBlocked
}: CodeEditorPageProps): React.JSX.Element {
  const [fileMenu, setFileMenu] = useState<ProjectTreeNode | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    node: ProjectTreeNode
    x: number
    y: number
  } | null>(null)
  const [fileAction, setFileAction] = useState<FileAction>('create-file')
  const [entryName, setEntryName] = useState('')
  const [mutationBusy, setMutationBusy] = useState(false)
  const [mutationError, setMutationError] = useState('')
  const [comparison, setComparison] = useState<FileComparison | null>(null)
  const [externalChanges, setExternalChanges] = useState<
    Record<string, { content?: string | null; error?: string }>
  >({})
  const [externalConfirm, setExternalConfirm] = useState<{
    path: string
    action: 'reload' | 'overwrite'
  } | null>(null)
  const [treeRevision, setTreeRevision] = useState(0)
  const blocked =
    parentBlocked ||
    !!fileMenu ||
    !!contextMenu ||
    mutationBusy ||
    !!externalConfirm ||
    !!comparison
  const manage = (node: ProjectTreeNode, x: number, y: number): void => {
    if (!projectPath || parentBlocked || savingRef.current || mutationBusy || fileMenu) return
    setContextMenu({ node, x, y })
  }
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const appliedLocation = useRef<number | null>(null)

  const [tree, setTree] = useState<ProjectTreeNode[]>([])

  const [treeLoading, setTreeLoading] = useState(false)

  const [treeError, setTreeError] = useState('')

  const session = projectPath ? (sessions[projectPath] ?? emptyEditorSession) : emptyEditorSession
  const { openFiles, activeFilePath } = session
  const setOpenFiles = (update: SetStateAction<OpenFile[]>): void => {
    if (!projectPath) return
    setSessions((current) => {
      const previous = current[projectPath] ?? emptyEditorSession
      return {
        ...current,
        [projectPath]: {
          ...previous,
          openFiles: typeof update === 'function' ? update(previous.openFiles) : update
        }
      }
    })
  }
  const setActiveFilePath = (path: string | null): void => {
    if (!projectPath) return
    setSessions((current) => ({
      ...current,
      [projectPath]: {
        ...(current[projectPath] ?? emptyEditorSession),
        activeFilePath: path
      }
    }))
  }
  const generation = useRef(0)
  const pendingReads = useRef(new Set<string>())
  const savingRef = useRef(false)
  const [operationError, setOperationError] = useState('')

  useLayoutEffect(() => {
    generation.current += 1
    pendingReads.current.clear()
    return () => {
      generation.current += 1
    }
  }, [projectPath, treeRevision])

  const [fileLoading, setFileLoading] = useState(false)

  const [saving, setSaving] = useState(false)
  const setSavingBusy = useCallback(
    (busy: boolean): void => {
      savingRef.current = busy
      setSaving(busy)
      onSavingChange(busy)
    },
    [onSavingChange]
  )

  const [pendingClosePath, setPendingClosePath] = useState<string | null>(null)

  const activeFile = openFiles.find((file) => file.relativePath === activeFilePath) ?? null
  const diskSnapshot = useRef({ projectPath, openFiles, allowed: false })
  useLayoutEffect(() => {
    diskSnapshot.current = {
      projectPath,
      openFiles,
      allowed:
        !parentBlocked && !fileMenu && !mutationBusy && !externalConfirm && !saving && !comparison
    }
  }, [
    projectPath,
    openFiles,
    parentBlocked,
    fileMenu,
    mutationBusy,
    externalConfirm,
    saving,
    comparison
  ])
  useEffect(() => {
    if (!projectPath || !isActive) return
    let cancelled = false
    let timer: number | undefined
    const poll = async (): Promise<void> => {
      const snapshot = diskSnapshot.current
      const requestGeneration = generation.current
      if (snapshot.projectPath === projectPath && snapshot.allowed) {
        for (const file of snapshot.openFiles) {
          if (
            cancelled ||
            !diskSnapshot.current.allowed ||
            requestGeneration !== generation.current
          )
            break
          try {
            const result = await window.api.readProjectFile(projectPath, file.relativePath)
            if (
              cancelled ||
              !diskSnapshot.current.allowed ||
              requestGeneration !== generation.current ||
              diskSnapshot.current.projectPath !== projectPath
            )
              break
            const latest = diskSnapshot.current.openFiles.find(
              (entry) => entry.relativePath === file.relativePath
            )
            if (!latest || latest.savedContent !== file.savedContent) continue
            const key = `${projectPath}\u0000${file.relativePath}`
            const content = result.success
              ? (result.content ?? '')
              : result.missing
                ? null
                : undefined
            setExternalChanges((changes) => {
              if (result.success && content === latest.savedContent) {
                if (!(key in changes)) return changes
                const next = { ...changes }
                delete next[key]
                return next
              }
              const error =
                result.success || result.missing ? undefined : (result.error ?? 'Файл недоступен.')
              if (
                changes[key]?.content === content &&
                changes[key]?.error === error &&
                key in changes
              )
                return changes
              return { ...changes, [key]: { content, error } }
            })
          } catch {
            /* The next check retries transient IPC failures. */
          }
        }
      }
      if (!cancelled)
        timer = window.setTimeout(() => {
          void poll()
        }, 2500)
    }
    void poll()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [projectPath, isActive])
  const revealLocation = useCallback((): void => {
    const editor = editorRef.current
    if (
      !editor ||
      !locationRequest ||
      !isActive ||
      appliedLocation.current === locationRequest.id ||
      locationRequest.projectPath !== projectPath ||
      locationRequest.relativePath !== activeFilePath
    )
      return
    const position = editor
      .getModel()
      ?.validatePosition({ lineNumber: locationRequest.line, column: locationRequest.column })
    if (!position) return
    editor.setPosition(position)
    editor.revealPositionInCenter(position)
    editor.focus()
    appliedLocation.current = locationRequest.id
  }, [locationRequest, isActive, projectPath, activeFilePath])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      revealLocation()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [revealLocation])

  const dirty = activeFile ? activeFile.content !== activeFile.savedContent : false
  useEffect(() => {
    if (!isActive || !activeFilePath) {
      return
    }

    const timer = window.setTimeout(() => {
      editorRef.current?.layout()
      editorRef.current?.focus()
    }, 50)

    return () => {
      window.clearTimeout(timer)
    }
  }, [isActive, activeFilePath])

  useEffect(() => {
    let cancelled = false

    const loadTree = async (): Promise<void> => {
      setComparison(null)
      setExternalConfirm(null)
      setFileMenu(null)
      setContextMenu(null)
      setFileLoading(false)
      setPendingClosePath(null)
      setOperationError('')
      setTree([])
      setTreeError('')
      setTreeLoading(false)

      if (!projectPath) {
        return
      }

      setTreeLoading(true)

      try {
        const result = await window.api.getProjectTree(projectPath)

        if (cancelled) {
          return
        }

        if (!result.success) {
          setTreeError(result.error ?? 'Unable to load project.')

          return
        }

        setTree(result.tree)
      } catch (error) {
        if (!cancelled)
          setTreeError(error instanceof Error ? error.message : 'Unable to load project.')
      } finally {
        if (!cancelled) {
          setTreeLoading(false)
        }
      }
    }

    void loadTree()

    return () => {
      cancelled = true
    }
  }, [projectPath, treeRevision])

  const handleOpenFile = async (node: ProjectTreeNode): Promise<void> => {
    if (!projectPath || blocked || node.type !== 'file') {
      return
    }

    const existingFile = openFiles.find((file) => file.relativePath === node.relativePath)

    if (existingFile) {
      setActiveFilePath(existingFile.relativePath)

      return
    }

    const requestGeneration = generation.current
    if (pendingReads.current.has(node.relativePath)) return
    pendingReads.current.add(node.relativePath)
    setOperationError('')
    setFileLoading(true)

    try {
      const result = await window.api.readProjectFile(projectPath, node.relativePath)

      if (requestGeneration !== generation.current) return
      if (!result.success) {
        setOperationError(`Не удалось открыть файл.\n\n${result.error ?? 'Unknown error'}`)

        return
      }

      const fileContent = result.content ?? ''

      const newFile: OpenFile = {
        name: node.name,
        relativePath: node.relativePath,
        content: fileContent,
        savedContent: fileContent
      }

      setOpenFiles((currentFiles) =>
        currentFiles.some((file) => file.relativePath === node.relativePath)
          ? currentFiles
          : [...currentFiles, newFile]
      )

      setActiveFilePath(node.relativePath)
    } catch (error) {
      if (requestGeneration === generation.current) {
        setOperationError(error instanceof Error ? error.message : 'Не удалось открыть файл.')
      }
    } finally {
      if (requestGeneration === generation.current) {
        pendingReads.current.delete(node.relativePath)
        setFileLoading(pendingReads.current.size > 0)
      }
    }
  }

  const mutateEntry = async (): Promise<void> => {
    if (!projectPath || !fileMenu || mutationBusy || parentBlocked || savingRef.current) return
    const path = fileMenu.relativePath
    if (
      fileAction === 'delete' &&
      openFiles.some(
        (file) => affectsFile(file.relativePath, path) && file.content !== file.savedContent
      )
    ) {
      setMutationError('Сначала сохраните изменения в удаляемых файлах или закройте их вкладки.')
      return
    }
    setMutationBusy(true)
    onSavingChange(true)
    setMutationError('')
    generation.current++
    pendingReads.current.clear()
    setFileLoading(false)
    try {
      const result = await window.api.mutateProjectFile({
        projectPath,
        relativePath: path,
        action: fileAction,
        name: entryName
      })
      if (!result.success) throw new Error(result.error ?? 'Операция не выполнена.')
      setSessions((sessions) => {
        const session = sessions[projectPath] ?? emptyEditorSession
        const next = session.openFiles.flatMap((file) => {
          if (!affectsFile(file.relativePath, path)) return [file]
          if (fileAction === 'delete') return []
          if (fileAction !== 'rename' || !result.relativePath) return [file]
          const relativePath =
            result.relativePath + file.relativePath.replaceAll('\\', '/').slice(path.length)
          return [{ ...file, relativePath, name: relativePath.split('/').at(-1)! }]
        })
        let active = session.activeFilePath
        if (active && affectsFile(active, path)) {
          if (fileAction === 'delete') active = next[0]?.relativePath ?? null
          if (fileAction === 'rename' && result.relativePath)
            active = result.relativePath + active.replaceAll('\\', '/').slice(path.length)
        }
        return {
          ...sessions,
          [projectPath]: { ...session, openFiles: next, activeFilePath: active }
        }
      })
      setFileMenu(null)
      setTreeRevision((value) => value + 1)
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Ошибка файловой операции.')
    } finally {
      setMutationBusy(false)
      onSavingChange(false)
    }
  }

  const handleEditorChange = (value: string | undefined): void => {
    if (!activeFilePath || blocked) {
      return
    }

    const newValue = value ?? ''

    setOpenFiles((currentFiles) =>
      currentFiles.map((file) =>
        file.relativePath === activeFilePath
          ? {
              ...file,
              content: newValue
            }
          : file
      )
    )
  }

  const saveFiles = useCallback(
    async (
      files: OpenFile[],
      override?: { path: string; expected: string | null }
    ): Promise<void> => {
      if (
        !projectPath ||
        savingRef.current ||
        parentBlocked ||
        fileMenu ||
        mutationBusy ||
        (blocked && !override)
      ) {
        return
      }

      const snapshots = files
        .filter(
          (file) => file.content !== file.savedContent || override?.path === file.relativePath
        )
        .map((file) => ({
          relativePath: file.relativePath,
          content: file.content,
          expected: override?.path === file.relativePath ? override.expected : file.savedContent
        }))
      if (snapshots.length === 0) return
      const savedProject = projectPath
      const requestGeneration = generation.current
      setSavingBusy(true)
      setOperationError('')
      const errors: string[] = []

      try {
        for (const snapshot of snapshots) {
          try {
            const result = await window.api.saveProjectFile(
              savedProject,
              snapshot.relativePath,
              snapshot.content,
              snapshot.expected
            )
            if (!result.success) {
              if (result.conflict)
                setExternalChanges((changes) => ({
                  ...changes,
                  [`${savedProject}\u0000${snapshot.relativePath}`]: {
                    content: result.currentContent
                  }
                }))
              errors.push(
                `${snapshot.relativePath}: ${result.error ?? 'Не удалось сохранить файл.'}`
              )
              continue
            }
            setExternalChanges((changes) => {
              const next = { ...changes }
              delete next[`${savedProject}\u0000${snapshot.relativePath}`]
              return next
            })
            setSessions((current) => ({
              ...current,
              [savedProject]: markFileSaved(
                current[savedProject] ?? emptyEditorSession,
                snapshot.relativePath,
                snapshot.content
              )
            }))
          } catch (error) {
            errors.push(
              `${snapshot.relativePath}: ${error instanceof Error ? error.message : 'Не удалось сохранить файл.'}`
            )
          }
        }
        if (errors.length > 0 && requestGeneration === generation.current) {
          setOperationError(`Не удалось сохранить: ${errors.join('; ')}`)
        }
      } finally {
        setSavingBusy(false)
      }
    },
    [projectPath, setSessions, setSavingBusy, blocked, parentBlocked, fileMenu, mutationBusy]
  )

  const handleSave = useCallback(async (): Promise<void> => {
    if (activeFile) await saveFiles([activeFile])
  }, [activeFile, saveFiles])

  const handleSaveAll = (): void => {
    void saveFiles(openFiles)
  }
  const openComparison = useCallback(
    async (file: OpenFile): Promise<void> => {
      if (!projectPath || blocked || savingRef.current) return
      const requestGeneration = generation.current
      setSavingBusy(true)
      setOperationError('')
      try {
        const result = await window.api.readProjectFile(projectPath, file.relativePath)
        if (generation.current !== requestGeneration) return
        if (!result.success && !result.missing)
          throw new Error(result.error ?? 'Не удалось прочитать файл.')
        setComparison({
          projectPath,
          relativePath: file.relativePath,
          original: result.success ? (result.content ?? '') : null,
          modified: file.content,
          language: getLanguage(file.name)
        })
      } catch (error) {
        setOperationError(error instanceof Error ? error.message : 'Не удалось открыть сравнение.')
      } finally {
        setSavingBusy(false)
      }
    },
    [projectPath, blocked, setSavingBusy]
  )
  const resolveExternal = useCallback(async (): Promise<void> => {
    if (!projectPath || !externalConfirm || parentBlocked || savingRef.current) return
    const file = openFiles.find((entry) => entry.relativePath === externalConfirm.path)
    const change = externalChanges[`${projectPath}\u0000${externalConfirm.path}`]
    if (!file || !change || change.content === undefined) {
      setExternalConfirm(null)
      return
    }
    if (externalConfirm.action === 'overwrite') {
      setExternalConfirm(null)
      await saveFiles([file], { path: file.relativePath, expected: change.content })
      return
    }
    const savedProject = projectPath
    const requestGeneration = generation.current
    setSavingBusy(true)
    try {
      const result = await window.api.readProjectFile(savedProject, file.relativePath)
      if (!result.success) throw new Error(result.error ?? 'Файл недоступен.')
      if (generation.current !== requestGeneration) return
      const content = result.content ?? ''
      setSessions((sessions) => {
        const session = sessions[savedProject] ?? emptyEditorSession
        return {
          ...sessions,
          [savedProject]: {
            ...session,
            openFiles: session.openFiles.map((entry) =>
              entry.relativePath === file.relativePath
                ? { ...entry, content, savedContent: content }
                : entry
            )
          }
        }
      })
      setExternalChanges((changes) => {
        const next = { ...changes }
        delete next[`${savedProject}\u0000${file.relativePath}`]
        return next
      })
      setExternalConfirm(null)
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : 'Не удалось обновить файл.')
      setExternalConfirm(null)
    } finally {
      setSavingBusy(false)
    }
  }, [
    projectPath,
    externalConfirm,
    parentBlocked,
    openFiles,
    externalChanges,
    saveFiles,
    setSessions,
    setSavingBusy
  ])
  const hasDirtyFiles = openFiles.some((file) => file.content !== file.savedContent)

  const closeFileImmediately = (relativePath: string): void => {
    const closingIndex = openFiles.findIndex((file) => file.relativePath === relativePath)

    const nextFiles = openFiles.filter((file) => file.relativePath !== relativePath)

    setOpenFiles(nextFiles)

    if (activeFilePath === relativePath) {
      if (nextFiles.length === 0) {
        setActiveFilePath(null)

        return
      }

      const newIndex = Math.min(closingIndex, nextFiles.length - 1)

      setActiveFilePath(nextFiles[newIndex].relativePath)
    }

    window.setTimeout(() => {
      editorRef.current?.layout()
      editorRef.current?.focus()
    }, 50)
  }

  const handleCloseFile = (relativePath: string): void => {
    if (savingRef.current) return
    const fileToClose = openFiles.find((file) => file.relativePath === relativePath)

    if (!fileToClose) {
      return
    }

    const isDirty = fileToClose.content !== fileToClose.savedContent

    if (isDirty) {
      setPendingClosePath(relativePath)

      return
    }

    closeFileImmediately(relativePath)
  }

  const openFind = useCallback(
    (replace: boolean): void => {
      if (!isActive || blocked || !activeFilePath) return
      const editor = editorRef.current
      const action = editor?.getAction(
        replace ? 'editor.action.startFindReplaceAction' : 'actions.find'
      )
      if (!editor || !action) return
      editor.focus()
      void action.run().catch((error: unknown) => {
        setOperationError(
          error instanceof Error ? error.message : 'Не удалось открыть поиск в файле.'
        )
      })
    },
    [isActive, blocked, activeFilePath]
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      if (isActive && !blocked && event.ctrlKey && !event.altKey && !event.shiftKey) {
        const find = event.code === 'KeyF' || event.key.toLowerCase() === 'f'
        const replace = event.code === 'KeyH' || event.key.toLowerCase() === 'h'
        if (find || replace) {
          event.preventDefault()
          openFind(replace)
          return
        }
      }
      if (
        isActive &&
        !blocked &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 's'
      ) {
        event.preventDefault()

        void handleSave()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleSave, isActive, blocked, openFind])

  const beginAction = (action: FileAction): void => {
    if (!contextMenu) return
    setFileMenu(contextMenu.node)
    setFileAction(action)
    setEntryName(action === 'rename' ? contextMenu.node.name : '')
    setMutationError('')
    setContextMenu(null)
  }

  const inlineEntry =
    fileMenu && fileAction !== 'delete' ? (
      <div
        className="tree-inline-entry"
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        <input
          aria-label={
            fileAction === 'rename'
              ? 'Новое имя'
              : fileAction === 'create-file'
                ? 'Имя нового файла'
                : 'Имя новой папки'
          }
          autoFocus
          value={entryName}
          disabled={mutationBusy || parentBlocked}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            setEntryName(event.target.value)
            setMutationError('')
          }}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter' && entryName) {
              event.preventDefault()
              void mutateEntry()
            }
            if (event.key === 'Escape' && !mutationBusy) {
              event.preventDefault()
              setFileMenu(null)
            }
          }}
        />
        {mutationError && <small role="alert">{mutationError}</small>}
        <small>Enter — сохранить · Esc — отмена</small>
      </div>
    ) : null
  const renderEntry = (node: ProjectTreeNode, position: 'name' | 'children'): React.ReactNode => {
    if (!fileMenu || node.relativePath !== fileMenu.relativePath) return null
    if (position === 'name' && fileAction === 'rename') return inlineEntry
    if (position === 'children' && fileAction.startsWith('create-')) return inlineEntry
    return null
  }

  return (
    <div className="code-editor-page">
      {projectPath &&
        openFiles.map((file) => {
          const change = externalChanges[`${projectPath}\u0000${file.relativePath}`]
          if (!change) return null
          return (
            <div className="external-file-notice" role="status" key={file.relativePath}>
              <strong>{file.relativePath}</strong>:{' '}
              {change.error ??
                (change.content === null
                  ? 'Файл удалён вне приложения. Текст вкладки сохранён.'
                  : 'Файл изменён вне приложения. Текст вкладки сохранён.')}
              {change.content !== undefined && (
                <>
                  <button
                    type="button"
                    disabled={blocked || saving}
                    onClick={() => {
                      void openComparison(file)
                    }}
                  >
                    Сравнить
                  </button>
                  {change.content !== null && (
                    <button
                      type="button"
                      disabled={blocked || saving}
                      onClick={() =>
                        setExternalConfirm({ path: file.relativePath, action: 'reload' })
                      }
                    >
                      Загрузить с диска
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={blocked || saving}
                    onClick={() =>
                      setExternalConfirm({ path: file.relativePath, action: 'overwrite' })
                    }
                  >
                    {change.content === null ? 'Восстановить файл' : 'Сохранить мою версию'}
                  </button>
                </>
              )}
            </div>
          )
        })}
      {operationError && (
        <div className="project-tree-error" role="alert">
          {operationError}
        </div>
      )}
      <div className="code-editor-toolbar">
        <div>
          <strong>Code Editor</strong>

          <span>{projectName ? `Project: ${projectName}` : 'No project opened'}</span>

          {activeFile && (
            <span className={dirty ? 'editor-save-state dirty' : 'editor-save-state'}>
              {saving ? 'Saving...' : dirty ? 'Unsaved changes' : 'Saved'}
            </span>
          )}
        </div>
        <button
          type="button"
          className="save-all-button"
          disabled={!projectPath || !hasDirtyFiles || saving || blocked}
          onClick={handleSaveAll}
          title="Сохранить все открытые файлы с изменениями в текущем проекте"
        >
          {saving ? 'Сохранение…' : 'Сохранить всё'}
        </button>
      </div>

      <div className="code-editor-layout">
        <aside
          className="project-tree"
          onContextMenu={(event) => {
            event.preventDefault()
            manage({ name: '', relativePath: '', type: 'directory' }, event.clientX, event.clientY)
          }}
        >
          <div className="project-tree-title">PROJECT</div>

          <div className="project-tree-content">
            {fileMenu?.relativePath === '' && inlineEntry}
            {!projectPath && <div className="project-tree-empty">Open a project first</div>}

            {projectPath && treeLoading && (
              <div className="project-tree-empty">Loading project...</div>
            )}

            {treeError && <div className="project-tree-error">{treeError}</div>}

            {!treeLoading &&
              !treeError &&
              tree.map((node) => (
                <TreeNode
                  key={node.relativePath}
                  node={node}
                  activeFilePath={activeFilePath ?? undefined}
                  onOpenFile={handleOpenFile}
                  onManage={manage}
                  renderEntry={renderEntry}
                />
              ))}
          </div>
        </aside>

        <div className="editor-area">
          <div className="editor-tabs">
            {openFiles.length === 0 && <div className="editor-tab-placeholder">No file open</div>}

            {openFiles.map((file) => {
              const isActive = file.relativePath === activeFilePath

              const isDirty = file.content !== file.savedContent

              return (
                <div
                  key={file.relativePath}
                  className={`editor-tab ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveFilePath(file.relativePath)}
                >
                  <span>{file.name}</span>

                  {isDirty && <span className="dirty-dot">●</span>}

                  <button
                    type="button"
                    className="editor-tab-close"
                    disabled={saving}
                    onClick={(event) => {
                      event.stopPropagation()

                      handleCloseFile(file.relativePath)
                    }}
                  >
                    ×
                  </button>
                </div>
              )
            })}
          </div>

          <div className="monaco-container">
            {fileLoading && <div className="editor-empty-state">Loading file...</div>}

            {!fileLoading && !activeFile && (
              <div className="editor-empty-state">
                <strong>No file opened</strong>

                <span>Выбери файл в дереве проекта слева.</span>
              </div>
            )}

            {!fileLoading && activeFile && (
              <Editor
                key={projectPath}
                path={
                  projectPath
                    ? `espai://project/${encodeURIComponent(
                        projectPath
                      )}/${activeFile.relativePath.replace(/\\/g, '/')}`
                    : activeFile.relativePath
                }
                height="100%"
                onMount={(editor) => {
                  editorRef.current = editor

                  if (isActive) {
                    window.setTimeout(() => {
                      editor.layout()
                      editor.focus()
                      revealLocation()
                    }, 0)
                  }
                }}
                language={getLanguage(activeFile.name)}
                value={activeFile.content}
                theme="vs-dark"
                onChange={handleEditorChange}
                options={{
                  readOnly: blocked,
                  automaticLayout: true,
                  minimap: {
                    enabled: true
                  },
                  fontSize: 14,
                  tabSize: 4,
                  insertSpaces: true,
                  wordWrap: 'off',
                  scrollBeyondLastLine: false
                }}
              />
            )}
          </div>
        </div>
      </div>

      <div className="editor-bottom-panel">
        <button type="button">Problems</button>

        <button type="button">Output</button>

        <button type="button">Terminal</button>

        <button type="button">Monitor</button>
      </div>

      {comparison && isActive && !parentBlocked && (
        <FileCompareDialog
          comparison={comparison}
          onClose={() => {
            setComparison(null)
            window.setTimeout(() => editorRef.current?.focus(), 0)
          }}
        />
      )}
      {externalConfirm && (
        <div className="editor-confirm-overlay">
          <div
            className="editor-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Внешнее изменение файла"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !saving) setExternalConfirm(null)
              if (event.key === 'Tab') {
                const buttons = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
                )
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
                event.preventDefault()
                buttons[
                  (index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length
                ]?.focus()
              }
            }}
          >
            <h3>
              {externalConfirm.action === 'reload'
                ? 'Загрузить версию с диска?'
                : 'Сохранить текст вкладки на диск?'}
            </h3>
            <p>{externalConfirm.path}</p>
            <p>
              {externalConfirm.action === 'reload'
                ? 'Текущий текст вкладки будет заменён версией с диска. Несохранённые правки в этой вкладке будут потеряны.'
                : 'Текущий текст вкладки заменит содержимое файла на диске. Если файл удалён, он будет создан заново. Перед записью версия будет проверена повторно.'}
            </p>
            <div className="editor-confirm-actions">
              <button
                type="button"
                autoFocus
                disabled={saving}
                onClick={() => setExternalConfirm(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={saving || parentBlocked}
                onClick={() => {
                  void resolveExternal()
                }}
              >
                Подтвердить
              </button>
            </div>
          </div>
        </div>
      )}
      {contextMenu && isActive && !parentBlocked && (
        <div
          className="tree-menu-backdrop"
          onPointerDown={() => setContextMenu(null)}
          onContextMenu={(event) => {
            event.preventDefault()
            setContextMenu(null)
          }}
        >
          <div
            className="recent-project-menu"
            role="menu"
            aria-label="Действия с файлами"
            style={{
              left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 230)),
              top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 190))
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape' || event.key === 'Tab') {
                event.preventDefault()
                setContextMenu(null)
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                const buttons = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>('button')
                )
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
                buttons[
                  (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length
                ]?.focus()
              }
            }}
          >
            {contextMenu.node.type === 'directory' && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  autoFocus
                  onClick={() => beginAction('create-file')}
                >
                  Новый файл
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => beginAction('create-directory')}
                >
                  Новая папка
                </button>
              </>
            )}
            {contextMenu.node.relativePath && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  autoFocus={contextMenu.node.type === 'file'}
                  onClick={() => beginAction('rename')}
                >
                  Переименовать
                </button>
                <button type="button" role="menuitem" onClick={() => beginAction('delete')}>
                  Удалить в корзину
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {fileMenu && fileAction === 'delete' && (
        <div className="editor-confirm-overlay">
          <div
            className="editor-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Действия с файлами"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !mutationBusy) setFileMenu(null)
            }}
          >
            <h3>{fileMenu.relativePath || 'Корень проекта'}</h3>
            <p>
              Переместить «{fileMenu.name}» в корзину Windows? Папка будет перемещена со всем
              содержимым.
            </p>
            {mutationError && <p role="alert">{mutationError}</p>}
            <div className="editor-confirm-actions">
              <button type="button" disabled={mutationBusy} onClick={() => setFileMenu(null)}>
                Отмена
              </button>
              <button
                type="button"
                disabled={mutationBusy || parentBlocked || (fileAction !== 'delete' && !entryName)}
                onClick={() => {
                  void mutateEntry()
                }}
              >
                {mutationBusy ? 'Выполнение…' : 'Подтвердить удаление'}
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingClosePath && (
        <div className="editor-confirm-overlay">
          <div className="editor-confirm-dialog">
            <h3>Несохранённые изменения</h3>

            <p>
              Файл{' '}
              <strong>
                {openFiles.find((file) => file.relativePath === pendingClosePath)?.name}
              </strong>{' '}
              содержит несохранённые изменения.
            </p>

            <p>Закрыть вкладку и потерять изменения?</p>

            <div className="editor-confirm-actions">
              <button
                type="button"
                onClick={() => {
                  setPendingClosePath(null)

                  window.setTimeout(() => {
                    editorRef.current?.layout()
                    editorRef.current?.focus()
                  }, 0)
                }}
              >
                Отмена
              </button>

              <button
                type="button"
                className="danger"
                onClick={() => {
                  const path = pendingClosePath

                  setPendingClosePath(null)

                  closeFileImmediately(path)
                }}
              >
                Закрыть без сохранения
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default CodeEditorPage
