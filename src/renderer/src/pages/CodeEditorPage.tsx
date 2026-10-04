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

interface CodeEditorPageProps {
  projectName?: string
}

function CodeEditorPage({
  projectName
}: CodeEditorPageProps): React.JSX.Element {
  return (
    <div className="code-editor-page">
      <div className="code-editor-toolbar">
        <div>
          <strong>Code Editor</strong>

          <span>
            {projectName
              ? `Project: ${projectName}`
              : 'No project opened'}
          </span>
        </div>
      </div>

      <div className="code-editor-layout">
        <aside className="project-tree">
          <div className="project-tree-title">
            PROJECT
          </div>

          <div className="project-tree-empty">
            {projectName
              ? 'File tree will appear here'
              : 'Open a project first'}
          </div>
        </aside>

        <div className="editor-area">
          <div className="editor-tabs">
            <div className="editor-tab active">
              main.c
            </div>
          </div>

          <div className="monaco-container">
            <Editor
              height="100%"
              defaultLanguage="c"
              defaultValue={`#include <stdio.h>

void app_main(void)
{
    printf("Hello from ESP AI Studio!\\n");
}
`}
              theme="vs-dark"
              options={{
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