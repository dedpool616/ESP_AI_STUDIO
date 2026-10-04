import {
  useCallback,
  useEffect,
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

interface CodeEditorPageProps {
  projectName?: string
  projectPath?: string
}

interface TreeNodeProps {
  node: ProjectTreeNode
  activeFile?: string
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
  activeFile,
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
                activeFile={
                  activeFile
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
        activeFile ===
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
  projectPath
}: CodeEditorPageProps): React.JSX.Element {
  const [tree, setTree] =
    useState<ProjectTreeNode[]>([])

  const [treeLoading, setTreeLoading] =
    useState(false)

  const [treeError, setTreeError] =
    useState('')

  const [activeFile, setActiveFile] =
    useState<ProjectTreeNode | null>(null)

  const [content, setContent] =
    useState('')

  const [savedContent, setSavedContent] =
    useState('')

  const [dirty, setDirty] =
    useState(false)

  const [fileLoading, setFileLoading] =
    useState(false)

  const [saving, setSaving] =
    useState(false)

  useEffect(() => {
    let cancelled = false

    const loadTree =
      async (): Promise<void> => {
        setTree([])
        setTreeError('')
        setActiveFile(null)
        setContent('')
        setSavedContent('')
        setDirty(false)

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

      if (
        activeFile &&
        activeFile.relativePath !==
          node.relativePath &&
        dirty
      ) {
        const shouldContinue =
          window.confirm(
            'В текущем файле есть несохранённые изменения.\n\nОткрыть другой файл и потерять эти изменения?'
          )

        if (!shouldContinue) {
          return
        }
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

        setActiveFile(node)
        setContent(fileContent)
        setSavedContent(fileContent)
        setDirty(false)
      } finally {
        setFileLoading(false)
      }
    }

  const handleSave =
    useCallback(
      async (): Promise<void> => {
        if (
          !projectPath ||
          !activeFile ||
          !dirty ||
          saving
        ) {
          return
        }

        setSaving(true)

        try {
          const result =
            await window.api.saveProjectFile(
              projectPath,
              activeFile.relativePath,
              content
            )

          if (!result.success) {
            window.alert(
              `Не удалось сохранить файл.\n\n${result.error ?? 'Unknown error'}`
            )

            return
          }

          setSavedContent(content)
          setDirty(false)
        } finally {
          setSaving(false)
        }
      },
      [
        projectPath,
        activeFile,
        dirty,
        saving,
        content
      ]
    )

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
              tree.map((node) => (
                <TreeNode
                  key={
                    node.relativePath
                  }
                  node={node}
                  activeFile={
                    activeFile?.relativePath
                  }
                  onOpenFile={
                    handleOpenFile
                  }
                />
              ))}
          </div>
        </aside>

        <div className="editor-area">
          <div className="editor-tabs">
            {activeFile ? (
              <div className="editor-tab active">
                {activeFile.name}

                {dirty && (
                  <span className="dirty-dot">
                    ●
                  </span>
                )}
              </div>
            ) : (
              <div className="editor-tab-placeholder">
                No file open
              </div>
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
                  language={getLanguage(
                    activeFile.name
                  )}
                  value={content}
                  theme="vs-dark"
                  onChange={(value) => {
                    const newValue =
                      value ?? ''

                    setContent(newValue)

                    setDirty(
                      newValue !==
                      savedContent
                    )
                  }}
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
    </div>
  )
}

export default CodeEditorPage