export interface OpenFile {
  name: string
  relativePath: string
  content: string
  savedContent: string
}

export interface ProjectEditorSession {
  openFiles: OpenFile[]
  activeFilePath: string | null
}

export type EditorSessions = Record<string, ProjectEditorSession>

export const emptyEditorSession: ProjectEditorSession = {
  openFiles: [],
  activeFilePath: null
}

export function hasUnsavedChanges(session: ProjectEditorSession): boolean {
  return session.openFiles.some((file) => file.content !== file.savedContent)
}

// Old app-state files have no sessions. Reject malformed data without losing
// valid buffers from other projects.
export function parseEditorSessions(value: unknown): EditorSessions {
  const sessions: EditorSessions = Object.create(null)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return sessions
  for (const [path, candidate] of Object.entries(value)) {
    if (!candidate || typeof candidate !== 'object') continue
    const session = candidate as Partial<ProjectEditorSession>
    if (!Array.isArray(session.openFiles)) continue
    const paths = new Set<string>()
    const openFiles = session.openFiles.filter((file): file is OpenFile => {
      if (
        !file ||
        typeof file.name !== 'string' ||
        typeof file.relativePath !== 'string' ||
        !file.relativePath ||
        typeof file.content !== 'string' ||
        typeof file.savedContent !== 'string' ||
        paths.has(file.relativePath)
      )
        return false
      paths.add(file.relativePath)
      return true
    })
    sessions[path] = {
      openFiles,
      activeFilePath:
        typeof session.activeFilePath === 'string' && paths.has(session.activeFilePath)
          ? session.activeFilePath
          : (openFiles[0]?.relativePath ?? null)
    }
  }
  return sessions
}

export function markFileSaved(
  session: ProjectEditorSession,
  relativePath: string,
  sentContent: string
): ProjectEditorSession {
  return {
    ...session,
    openFiles: session.openFiles.map((file) =>
      file.relativePath === relativePath ? { ...file, savedContent: sentContent } : file
    )
  }
}

export function relocateEditorSession(
  sessions: EditorSessions,
  oldPath: string,
  newPath: string
): EditorSessions {
  const source = sessions[oldPath]
  if (oldPath === newPath || !source || source.openFiles.length === 0) return sessions
  if (sessions[newPath]?.openFiles.length) {
    throw new Error(
      'У выбранной папки уже есть сессия редактора. Перенос отменён, чтобы сохранить обе сессии.'
    )
  }
  const next = { ...sessions }
  delete next[oldPath]
  next[newPath] = source
  return next
}
