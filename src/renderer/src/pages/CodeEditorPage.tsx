import {
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'

import Editor, {
  loader
} from '@monaco-editor/react'

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

    if (
      label === 'css' ||
      label === 'scss' ||
      label === 'less'
    ) {
      return new cssWorker()
    }

    if (
      label === 'html' ||
      label === 'handlebars' ||
      label === 'razor'
    ) {
      return new htmlWorker()
    }

    if (
      label === 'typescript' ||
      label === 'javascript'
    ) {
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

interface OpenFile {
  name: string
  relativePath: string
  content: string
  savedContent: string
}

interface CodeEditorPageProps {
  projectName?: string
  projectPath?: string
  isActive?: boolean
}

interface TreeNodeProps {
  node: ProjectTreeNode
  activeFilePath?: string
  onOpenFile:
    (node: ProjectTreeNode) => void
}

function getLanguage(
  fileName: string
): string {
  const lower =
    fileName.toLowerCase()

  if (
    lower.endsWith('.c') ||
    lower.endsWith('.h') ||
    lower.endsWith('.cpp') ||
    lower.endsWith('.hpp')
  ) {
    return 'cpp'
  }

  if (
    lower.endsWith('.json')
  ) {
    return 'json'
  }

  if (
    lower.endsWith('.ts') ||
    lower.endsWith('.tsx')
  ) {
    return 'typescript'
  }

  if (
    lower.endsWith('.js') ||
    lower.endsWith('.jsx')
  ) {
    return 'javascript'
  }

  if (
    lower.endsWith('.css')
  ) {
    return 'css'
  }

  if (
    lower.endsWith('.html')
  ) {
    return 'html'
  }

  if (
    lower.endsWith('.md')
  ) {
    return 'markdown'
  }

  return 'plaintext'
}

function TreeNode({
  node,
  activeFilePath,
  onOpenFile
}: TreeNodeProps): React.JSX.Element {
  if (
    node.type === 'directory'
  ) {
    return (
      <details
        className="tree-directory"
        open
      >
        <summary>
          <span className="tree-icon">
            ▾
          </span>

          {node.name}
        </summary>

        <div className="tree-children">
          {node.children?.map(
            (child) => (
              <TreeNode
                key={
                  child.relativePath
                }
                node={child}
                activeFilePath={
                  activeFilePath
                }
                onOpenFile={
                  onOpenFile
                }
              />
            )
          )}
        </div>
      </details>
    )
  }

  return (
    <button
      type="button"
      className={`tree-file ${
        activeFilePath ===
        node.relativePath
          ? 'active'
          : ''
      }`}
      onClick={() =>
        onOpenFile(node)
      }
    >
      <span className="tree-file-icon">
        ◦
      </span>

      {node.name}
    </button>
  )
}

function CodeEditorPage({
  projectName,
  projectPath,
  isActive = true
}: CodeEditorPageProps): React.JSX.Element {

  const editorRef =
    useRef<monaco.editor.IStandaloneCodeEditor | null>(
      null
    )

  const [tree, setTree] =
    useState<ProjectTreeNode[]>([])

  const [treeLoading, setTreeLoading] =
    useState(false)

  const [treeError, setTreeError] =
    useState('')

  const [openFiles, setOpenFiles] =
    useState<OpenFile[]>([])

  const [
    activeFilePath,
    setActiveFilePath
  ] = useState<string | null>(null)

  const [fileLoading, setFileLoading] =
    useState(false)

  const [saving, setSaving] =
    useState(false)

  const [
  pendingClosePath,
  setPendingClosePath
] = useState<string | null>(null)

  const activeFile =
    openFiles.find(
      (file) =>
        file.relativePath ===
        activeFilePath
    ) ?? null

  const dirty =
    activeFile
      ? activeFile.content !==
        activeFile.savedContent
      : false
  useEffect(() => {
    if (
      !isActive ||
      !activeFilePath
    ) {
      return
    }

    const timer =
      window.setTimeout(() => {
        editorRef.current?.layout()
        editorRef.current?.focus()
      }, 50)

    return () => {
      window.clearTimeout(timer)
    }
  }, [
    isActive,
    activeFilePath
  ])

  useEffect(() => {
    let cancelled = false

    const loadTree =
      async (): Promise<void> => {
        setTree([])
        setTreeError('')
        setOpenFiles([])
        setActiveFilePath(null)

        if (!projectPath) {
          return
        }

        setTreeLoading(true)

        try {
          const result =
            await window.api.getProjectTree(
              projectPath
            )

          if (cancelled) {
            return
          }

          if (!result.success) {
            setTreeError(
              result.error ??
              'Unable to load project.'
            )

            return
          }

          setTree(result.tree)
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
  }, [projectPath])

  const handleOpenFile =
    async (
      node: ProjectTreeNode
    ): Promise<void> => {
      if (
        !projectPath ||
        node.type !== 'file'
      ) {
        return
      }

      const existingFile =
        openFiles.find(
          (file) =>
            file.relativePath ===
            node.relativePath
        )

      if (existingFile) {
        setActiveFilePath(
          existingFile.relativePath
        )

        return
      }

      setFileLoading(true)

      try {
        const result =
          await window.api.readProjectFile(
            projectPath,
            node.relativePath
          )

        if (!result.success) {
          window.alert(
            `Не удалось открыть файл.\n\n${result.error ?? 'Unknown error'}`
          )

          return
        }

        const fileContent =
          result.content ?? ''

        const newFile: OpenFile = {
          name: node.name,
          relativePath:
            node.relativePath,
          content: fileContent,
          savedContent: fileContent
        }

        setOpenFiles(
          (currentFiles) => [
            ...currentFiles,
            newFile
          ]
        )

        setActiveFilePath(
          node.relativePath
        )
      } finally {
        setFileLoading(false)
      }
    }

  const handleEditorChange = (
    value: string | undefined
  ): void => {
    if (!activeFilePath) {
      return
    }

    const newValue =
      value ?? ''

    setOpenFiles(
      (currentFiles) =>
        currentFiles.map(
          (file) =>
            file.relativePath ===
            activeFilePath
              ? {
                  ...file,
                  content:
                    newValue
                }
              : file
        )
    )
  }

  const handleSave =
    useCallback(
      async (): Promise<void> => {
        if (
          !projectPath ||
          !activeFile ||
          saving
        ) {
          return
        }

        if (
          activeFile.content ===
          activeFile.savedContent
        ) {
          return
        }

        setSaving(true)

        try {
          const result =
            await window.api.saveProjectFile(
              projectPath,
              activeFile.relativePath,
              activeFile.content
            )

          if (!result.success) {
            window.alert(
              `Не удалось сохранить файл.\n\n${result.error ?? 'Unknown error'}`
            )

            return
          }

          setOpenFiles(
            (currentFiles) =>
              currentFiles.map(
                (file) =>
                  file.relativePath ===
                  activeFile.relativePath
                    ? {
                        ...file,
                        savedContent:
                          file.content
                      }
                    : file
              )
          )
        } finally {
          setSaving(false)
        }
      },
      [
        projectPath,
        activeFile,
        saving
      ]
    )

  const closeFileImmediately = (
  relativePath: string
): void => {
  const closingIndex =
    openFiles.findIndex(
      (file) =>
        file.relativePath ===
        relativePath
    )

  const nextFiles =
    openFiles.filter(
      (file) =>
        file.relativePath !==
        relativePath
    )

  setOpenFiles(nextFiles)

  if (
    activeFilePath ===
    relativePath
  ) {
    if (nextFiles.length === 0) {
      setActiveFilePath(null)

      return
    }

    const newIndex =
      Math.min(
        closingIndex,
        nextFiles.length - 1
      )

    setActiveFilePath(
      nextFiles[newIndex]
        .relativePath
    )
  }

  window.setTimeout(() => {
    editorRef.current?.layout()
    editorRef.current?.focus()
  }, 50)
}

const handleCloseFile = (
  relativePath: string
): void => {
  const fileToClose =
    openFiles.find(
      (file) =>
        file.relativePath ===
        relativePath
    )

  if (!fileToClose) {
    return
  }

  const isDirty =
    fileToClose.content !==
    fileToClose.savedContent

  if (isDirty) {
    setPendingClosePath(
      relativePath
    )

    return
  }

  closeFileImmediately(
    relativePath
  )
}

  useEffect(() => {
    const handleKeyDown = (
      event: KeyboardEvent
    ): void => {
      if (
        event.ctrlKey &&
        event.key.toLowerCase() === 's'
      ) {
        event.preventDefault()

        void handleSave()
      }
    }

    window.addEventListener(
      'keydown',
      handleKeyDown
    )

    return () => {
      window.removeEventListener(
        'keydown',
        handleKeyDown
      )
    }
  }, [handleSave])

  return (
    <div className="code-editor-page">
      <div className="code-editor-toolbar">
        <div>
          <strong>
            Code Editor
          </strong>

          <span>
            {projectName
              ? `Project: ${projectName}`
              : 'No project opened'}
          </span>

          {activeFile && (
            <span
              className={
                dirty
                  ? 'editor-save-state dirty'
                  : 'editor-save-state'
              }
            >
              {saving
                ? 'Saving...'
                : dirty
                  ? 'Unsaved changes'
                  : 'Saved'}
            </span>
          )}
        </div>
      </div>

      <div className="code-editor-layout">
        <aside className="project-tree">
          <div className="project-tree-title">
            PROJECT
          </div>

          <div className="project-tree-content">
            {!projectPath && (
              <div className="project-tree-empty">
                Open a project first
              </div>
            )}

            {projectPath &&
              treeLoading && (
                <div className="project-tree-empty">
                  Loading project...
                </div>
              )}

            {treeError && (
              <div className="project-tree-error">
                {treeError}
              </div>
            )}

            {!treeLoading &&
              !treeError &&
              tree.map(
                (node) => (
                  <TreeNode
                    key={
                      node.relativePath
                    }
                    node={node}
                    activeFilePath={
                      activeFilePath ??
                      undefined
                    }
                    onOpenFile={
                      handleOpenFile
                    }
                  />
                )
              )}
          </div>
        </aside>

        <div className="editor-area">
          <div className="editor-tabs">
            {openFiles.length === 0 && (
              <div className="editor-tab-placeholder">
                No file open
              </div>
            )}

            {openFiles.map(
              (file) => {
                const isActive =
                  file.relativePath ===
                  activeFilePath

                const isDirty =
                  file.content !==
                  file.savedContent

                return (
                  <div
                    key={
                      file.relativePath
                    }
                    className={`editor-tab ${
                      isActive
                        ? 'active'
                        : ''
                    }`}
                    onClick={() =>
                      setActiveFilePath(
                        file.relativePath
                      )
                    }
                  >
                    <span>
                      {file.name}
                    </span>

                    {isDirty && (
                      <span className="dirty-dot">
                        ●
                      </span>
                    )}

                    <button
                      type="button"
                      className="editor-tab-close"
                      onClick={(event) => {
                        event.stopPropagation()

                        handleCloseFile(
                          file.relativePath
                        )
                      }}
                    >
                      ×
                    </button>
                  </div>
                )
              }
            )}
          </div>

          <div className="monaco-container">
            {fileLoading && (
              <div className="editor-empty-state">
                Loading file...
              </div>
            )}

            {!fileLoading &&
              !activeFile && (
                <div className="editor-empty-state">
                  <strong>
                    No file opened
                  </strong>

                  <span>
                    Выбери файл в дереве проекта слева.
                  </span>
                </div>
              )}

            {!fileLoading &&
              activeFile && (
                <Editor
                  path={
                    activeFile.relativePath
                  }
                  height="100%"
		  onMount={(editor) => {
		    editorRef.current = editor
		    
		    if (isActive) {
			window.setTimeout(() => {
				editor.layout()
				editor.focus()
			}, 0)
		    }
		  }}
                  language={getLanguage(
                    activeFile.name
                  )}
                  value={
                    activeFile.content
                  }
                  theme="vs-dark"
                  onChange={
                    handleEditorChange
                  }
                  options={{
                    automaticLayout: true,
                    minimap: {
                      enabled: true
                    },
                    fontSize: 14,
                    tabSize: 4,
                    insertSpaces: true,
                    wordWrap: 'off',
                    scrollBeyondLastLine:
                      false
                  }}
                />
              )}
          </div>
        </div>
      </div>

     <div className="editor-bottom-panel">
  <button type="button">
    Problems
  </button>

  <button type="button">
    Output
  </button>

  <button type="button">
    Terminal
  </button>

  <button type="button">
    Monitor
  </button>
</div>

{pendingClosePath && (
  <div className="editor-confirm-overlay">
    <div className="editor-confirm-dialog">
      <h3>
        Несохранённые изменения
      </h3>

      <p>
        Файл{' '}
        <strong>
          {
            openFiles.find(
              (file) =>
                file.relativePath ===
                pendingClosePath
            )?.name
          }
        </strong>{' '}
        содержит несохранённые изменения.
      </p>

      <p>
        Закрыть вкладку и потерять изменения?
      </p>

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
            const path =
              pendingClosePath

            setPendingClosePath(null)

            closeFileImmediately(
              path
            )
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