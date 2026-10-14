import { useEffect, useCallback, useLayoutEffect, useRef, useState } from 'react'
import CodeEditorPage from './pages/CodeEditorPage'
import ProjectUnavailableDialog from './components/ProjectUnavailableDialog'
import RecentProjectMenu from './components/RecentProjectMenu'
import EnvironmentPage from './pages/EnvironmentPage'
import BuildPanel from './components/BuildPanel'
import { buildLabels, type BuildState } from '../../shared/build'
import {
  emptyEditorSession,
  hasUnsavedChanges,
  parseEditorSessions,
  relocateEditorSession,
  type EditorSessions
} from '../../shared/editorSession'

interface ProjectInfo {
  name: string
  path: string
  board: string
  idfVersion: string
  gitMode: 'local' | 'github' | 'none'
}

function App(): React.JSX.Element {
  const [showNewProject, setShowNewProject] = useState(false)

  const [projectName, setProjectName] = useState('')
  const projectNameInputRef = useRef<HTMLInputElement>(null)
  const [projectLocation, setProjectLocation] = useState('')
  const [board, setBoard] = useState('')
  const [idfVersion, setIdfVersion] = useState('recommended')

  const [gitMode, setGitMode] = useState<'local' | 'github' | 'none'>('local')

  const [isCreating, setIsCreating] = useState(false)

  const [projectFormError, setProjectFormError] = useState('')

  const [currentProject, setCurrentProject] = useState<ProjectInfo | null>(null)

  const [recentProjects, setRecentProjects] = useState<ProjectInfo[]>([])
  const [recentMenu, setRecentMenu] = useState<{
    project: ProjectInfo
    x: number
    y: number
    trigger: HTMLButtonElement
  } | null>(null)

  const [isAppStateLoaded, setIsAppStateLoaded] = useState(false)

  const [activePage, setActivePage] = useState('Home')
  const [editorSessions, setEditorSessions] = useState<EditorSessions>({})
  const [editorSaving, setEditorSaving] = useState(false)
  const [buildState, setBuildState] = useState<BuildState | null>(null)
  const [buildStarting, setBuildStarting] = useState(false)
  const buildStartingRef = useRef(false)
  const buildBusy = buildStarting || buildState?.status === 'running'

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const poll = async (): Promise<void> => {
      try {
        const result = await window.api.getBuildState()
        if (!cancelled) setBuildState(result)
      } catch {
        /* A later poll can recover from a transient IPC failure. */
      }
      if (!cancelled)
        timer = window.setTimeout(() => {
          void poll()
        }, 700)
    }
    void poll()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  const startBuild = async (port?: string): Promise<void> => {
    if (
      !currentProject ||
      buildBusy ||
      buildStartingRef.current ||
      editorSaving ||
      hasUnsavedChanges(editorSessions[currentProject.path] ?? emptyEditorSession)
    )
      return
    buildStartingRef.current = true
    setBuildStarting(true)
    setProjectError('')
    try {
      const result = port
        ? await window.api.startFlash(currentProject.path, currentProject.board, port)
        : await window.api.startBuild(currentProject.path, currentProject.board)
      setBuildState(result.state)
      if (!result.success) setProjectError(result.error ?? 'Не удалось начать сборку.')
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : 'Ошибка запуска сборки.')
    } finally {
      buildStartingRef.current = false
      setBuildStarting(false)
    }
  }
  const [pendingProject, setPendingProject] = useState<ProjectInfo | null>(null)
  const [closeRequested, setCloseRequested] = useState(false)
  const [closing, setClosing] = useState(false)
  const [storageError, setStorageError] = useState('')
  const [projectError, setProjectError] = useState('')
  const [unavailableProject, setUnavailableProject] = useState<{
    project: ProjectInfo
    error: string
  } | null>(null)
  const [projectBusy, setProjectBusy] = useState(false)
  const projectBusyRef = useRef(false)
  const [closeProjectRequested, setCloseProjectRequested] = useState(false)
  const snapshotRef = useRef({ currentProject, recentProjects, editorSessions })
  useLayoutEffect(() => {
    snapshotRef.current = { currentProject, recentProjects, editorSessions }
  }, [currentProject, recentProjects, editorSessions])

  useEffect(() => window.api.onCloseRequested(() => setCloseRequested(true)), [])

  const activateProject = (project: ProjectInfo): void => {
    if (
      editorSaving ||
      (project.path !== currentProject?.path &&
        currentProject &&
        hasUnsavedChanges(editorSessions[currentProject.path] ?? emptyEditorSession))
    ) {
      setPendingProject(project)
      return
    }
    setCurrentProject(project)
    setActivePage('Dashboard')
  }

  const finishClose = async (): Promise<void> => {
    if (buildBusy) return
    if (!isAppStateLoaded || editorSaving || closing || projectBusy || isCreating) return
    setClosing(true)
    setStorageError('')
    try {
      // Flush the latest snapshot; a pending file read may complete while saving.
      let snapshot: typeof snapshotRef.current
      do {
        snapshot = snapshotRef.current
        const result = await window.api.saveAppState(snapshot)
        if (!result.success) throw new Error(result.error ?? 'Не удалось сохранить сессии.')
      } while (snapshot !== snapshotRef.current)
      window.api.confirmClose()
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'Не удалось сохранить сессии.')
      setClosing(false)
    }
  }

  const updateSessions = useCallback<typeof setEditorSessions>((update) => {
    setEditorSessions(update)
  }, [])

  useEffect(() => {
    let cancelled = false

    const restoreAppState = async (): Promise<void> => {
      try {
        const state = await window.api.loadAppState()

        if (cancelled) {
          return
        }

        setEditorSessions(parseEditorSessions(state.editorSessions))

        setRecentProjects(state.recentProjects.slice(0, 8))
        if (state.currentProject) {
          const result = await window.api.inspectProject(state.currentProject.path)
          if (cancelled) return
          if (result.success && result.project) {
            setCurrentProject(result.project)
          } else {
            setUnavailableProject({
              project: state.currentProject,
              error: result.error ?? 'Проект недоступен.'
            })
          }
        }
      } catch (error) {
        if (!cancelled)
          setProjectError(
            error instanceof Error ? error.message : 'Не удалось восстановить проект.'
          )
        console.error('Unable to restore app state:', error)
      } finally {
        if (!cancelled) {
          setIsAppStateLoaded(true)
        }
      }
    }

    void restoreAppState()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isAppStateLoaded || closing) {
      return
    }

    const persistAppState = async (): Promise<void> => {
      try {
        const result = await window.api.saveAppState({
          currentProject,
          recentProjects,
          editorSessions
        })

        if (!result.success) {
          setStorageError(result.error ?? 'Не удалось сохранить состояние IDE.')
          console.error('Unable to save app state:', result.error)
        } else {
          setStorageError('')
        }
      } catch (error) {
        setStorageError(
          error instanceof Error ? error.message : 'Не удалось сохранить состояние IDE.'
        )
        console.error('Unable to save app state:', error)
      }
    }

    const timer = window.setTimeout(() => {
      void persistAppState()
    }, 300)
    return () => window.clearTimeout(timer)
  }, [currentProject, recentProjects, editorSessions, isAppStateLoaded, closing])

  const navigation = [
    'Home',
    ...(currentProject ? ['Dashboard'] : []),
    'AI',
    'Code Editor',
    'AI + Code',
    'Pin Manager',
    'Monitor',
    'Terminal',
    'Git',
    'Activity',
    'User Guide',
    'ESP-IDF Manager',
    'Settings'
  ]

  const handleOpenProject = async (): Promise<void> => {
    if (projectBusyRef.current) return
    projectBusyRef.current = true
    setProjectBusy(true)
    setProjectError('')
    try {
      const result = await window.api.openProject()

      if (result.canceled) {
        return
      }

      if (!result.success || !result.project) {
        setProjectError(`Не удалось открыть проект.\n\n${result.error ?? 'Unknown error'}`)

        return
      }

      const openedProject: ProjectInfo = {
        name: result.project.name,

        path: result.project.path,

        board: result.project.board,

        idfVersion: result.project.idfVersion,

        gitMode: result.project.gitMode
      }

      activateProject(openedProject)

      setRecentProjects((projects) => {
        const filtered = projects.filter((project) => project.path !== openedProject.path)

        return [openedProject, ...filtered].slice(0, 8)
      })
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : 'Не удалось открыть проект.')
    } finally {
      projectBusyRef.current = false
      setProjectBusy(false)
    }
  }

  const handleRecentProject = async (project: ProjectInfo): Promise<void> => {
    if (projectBusyRef.current || editorSaving) return
    projectBusyRef.current = true
    setProjectBusy(true)
    setProjectError('')
    try {
      const result = await window.api.inspectProject(project.path)
      if (!result.success || !result.project) {
        setUnavailableProject({ project, error: result.error ?? 'Проект недоступен.' })
        return
      }
      const opened = result.project
      setRecentProjects((projects) =>
        [opened, ...projects.filter((item) => item.path !== opened.path)].slice(0, 8)
      )
      activateProject(opened)
    } catch (error) {
      setUnavailableProject({
        project,
        error: error instanceof Error ? error.message : 'Не удалось проверить проект.'
      })
    } finally {
      projectBusyRef.current = false
      setProjectBusy(false)
    }
  }

  const relocateProject = async (): Promise<void> => {
    if (!unavailableProject || projectBusyRef.current || editorSaving) return
    projectBusyRef.current = true
    setProjectBusy(true)
    const previous = unavailableProject.project
    try {
      const folder = await window.api.selectFolder()
      if (!folder) return
      const result = await window.api.inspectProject(folder)
      if (!result.success || !result.project)
        throw new Error(result.error ?? 'Выбранная папка не является ESP-IDF проектом.')
      const relocated = result.project
      // The dialog blocks editing while the filesystem is checked.
      const sessions = relocateEditorSession(
        snapshotRef.current.editorSessions,
        previous.path,
        relocated.path
      )
      setEditorSessions(sessions)
      setRecentProjects((projects) =>
        [
          relocated,
          ...projects.filter((item) => item.path !== previous.path && item.path !== relocated.path)
        ].slice(0, 8)
      )
      setUnavailableProject(null)
      if (currentProject?.path === previous.path) {
        setCurrentProject(relocated)
        setActivePage('Dashboard')
      } else {
        activateProject(relocated)
      }
    } catch (error) {
      setUnavailableProject({
        project: previous,
        error: error instanceof Error ? error.message : 'Не удалось изменить расположение проекта.'
      })
    } finally {
      projectBusyRef.current = false
      setProjectBusy(false)
    }
  }

  const closeProject = (): void => {
    setCurrentProject(null)
    setActivePage('Home')
    setCloseProjectRequested(false)
  }

  const requestCloseProject = (): void => {
    if (!currentProject || editorSaving || projectBusy) return
    if (hasUnsavedChanges(editorSessions[currentProject.path] ?? emptyEditorSession)) {
      setCloseProjectRequested(true)
    } else {
      closeProject()
    }
  }

  const handleBrowse = async (): Promise<void> => {
    const folder = await window.api.selectFolder()

    if (folder) {
      setProjectLocation(folder)
    }
  }

  const resetNewProjectForm = (): void => {
    setProjectName('')
    setProjectLocation('')
    setBoard('')
    setIdfVersion('recommended')
    setGitMode('local')
  }

  const handleCreateProject = async (): Promise<void> => {
    if (isCreating) return
    setProjectFormError('')
    const normalizedName = projectName.trim()

    if (!normalizedName) {
      setProjectFormError('Введите имя проекта.')
      projectNameInputRef.current?.focus()

      return
    }

    if (!/^[A-Za-z0-9_-]+$/.test(normalizedName)) {
      setProjectFormError(
        'Используйте только латинские буквы A–Z, a–z, цифры, дефис (-) и подчёркивание (_). Русские буквы и пробелы в имени проекта не поддерживаются.'
      )
      projectNameInputRef.current?.focus()
      return
    }

    if (!projectLocation) {
      setProjectFormError('Выберите папку для проекта.')

      return
    }

    setIsCreating(true)

    try {
      const result = await window.api.createProject({
        projectName: normalizedName,
        location: projectLocation,
        board,
        idfVersion,
        gitMode
      })

      if (!result.success || !result.projectPath) {
        setProjectFormError(`Не удалось создать проект: ${result.error ?? 'Неизвестная ошибка.'}`)
        projectNameInputRef.current?.focus()

        return
      }

      const newProject: ProjectInfo = {
        name: normalizedName,
        path: result.projectPath,
        board,
        idfVersion,
        gitMode
      }

      activateProject(newProject)

      setRecentProjects((projects) => {
        const filteredProjects = projects.filter((project) => project.path !== newProject.path)

        return [newProject, ...filteredProjects].slice(0, 8)
      })

      setShowNewProject(false)
      resetNewProjectForm()
    } catch (error) {
      setProjectFormError(
        `Не удалось создать проект: ${error instanceof Error ? error.message : 'Неизвестная ошибка.'}`
      )
      projectNameInputRef.current?.focus()
    } finally {
      setIsCreating(false)
    }
  }

  const formatBoard = (projectBoard: string): string => {
    if (!projectBoard) {
      return 'Not selected'
    }

    const boardNames: Record<string, string> = {
      esp32: 'ESP32',
      esp32s2: 'ESP32-S2',
      esp32s3: 'ESP32-S3',
      esp32c3: 'ESP32-C3',
      esp32c6: 'ESP32-C6'
    }

    return boardNames[projectBoard] ?? projectBoard
  }

  const formatGitMode = (projectGitMode: 'local' | 'github' | 'none'): string => {
    if (projectGitMode === 'local') {
      return 'Local Git'
    }

    if (projectGitMode === 'github') {
      return 'Git + GitHub'
    }

    return 'No Git'
  }

  const formatIdfVersion = (version: string): string => {
    if (version === 'recommended') {
      return 'Recommended'
    }

    if (version === 'later') {
      return 'Not selected'
    }

    return version
  }

  return (
    <div className="app-shell">
      {storageError && (
        <div className="app-storage-error" role="alert">
          {storageError}
        </div>
      )}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">ESP</div>

          <div>
            <div className="brand-title">ESP AI Studio</div>

            <div className="brand-version">v0.1.0</div>
          </div>
        </div>

        <nav className="navigation">
          {navigation.map((item) => (
            <button
              key={item}
              className={`nav-item ${item === activePage ? 'active' : ''}`}
              type="button"
              onClick={() => setActivePage(item)}
            >
              {item}
            </button>
          ))}
        </nav>
        {currentProject && (
          <button
            type="button"
            className="nav-item"
            disabled={editorSaving || projectBusy || !isAppStateLoaded}
            onClick={requestCloseProject}
          >
            Close Project
          </button>
        )}
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>{currentProject ? currentProject.name : 'ESP AI Studio'}</h1>

            <p>
              {currentProject
                ? currentProject.path
                : 'AI-powered development environment for ESP32 and ESP-IDF'}
            </p>
          </div>

          <div className="environment-status">
            <span className="status-dot" />
            IDE запущена
          </div>
        </header>

        <section
          className={`home-content ${activePage === 'Code Editor' ? 'code-editor-host' : ''}`}
        >
          {projectError && (
            <div className="project-form-error" role="alert">
              {projectError}
            </div>
          )}

          {activePage === 'Home' && (
            <>
              <div className="welcome">
                <h2>Добро пожаловать</h2>

                <p>
                  Создай новый ESP-IDF проект или открой существующий. AI можно подключить на любом
                  этапе работы.
                </p>
              </div>

              <div className="project-actions">
                <button
                  className="primary-action"
                  type="button"
                  disabled={!isAppStateLoaded || editorSaving || projectBusy}
                  onClick={() => setShowNewProject(true)}
                >
                  <span className="action-symbol">+</span>

                  <span>
                    <strong>New Project</strong>
                    <small>Создать новый ESP-IDF проект</small>
                  </span>
                </button>

                <button
                  className="secondary-action"
                  type="button"
                  disabled={!isAppStateLoaded || editorSaving || projectBusy}
                  onClick={() => {
                    void handleOpenProject()
                  }}
                >
                  <span className="action-symbol">↗</span>

                  <span>
                    <strong>Open Project</strong>
                    <small>Открыть существующий проект</small>
                  </span>
                </button>
              </div>

              <section className="recent-section">
                <div className="section-heading">
                  <div>
                    <h3>Recent Projects</h3>

                    <p>Недавно открытые проекты.</p>
                  </div>
                </div>

                {recentProjects.length === 0 ? (
                  <div className="empty-projects">
                    <div className="empty-icon">{'{ }'}</div>

                    <h4>Проектов пока нет</h4>

                    <p>Создай первый проект или открой уже существующий ESP-IDF проект.</p>
                  </div>
                ) : (
                  <div className="recent-project-list">
                    {recentProjects.map((project) => (
                      <button
                        key={project.path}
                        type="button"
                        className="recent-project-card"
                        disabled={editorSaving || projectBusy || !isAppStateLoaded}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          setRecentMenu({
                            project,
                            x: event.clientX,
                            y: event.clientY,
                            trigger: event.currentTarget
                          })
                        }}
                        onClick={() => {
                          void handleRecentProject(project)
                        }}
                      >
                        <div>
                          <strong>{project.name}</strong>

                          <span>{project.path}</span>
                        </div>

                        <small>{formatBoard(project.board)}</small>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          {activePage === 'Dashboard' && currentProject && (
            <section className="project-dashboard">
              <div className="dashboard-heading">
                <div>
                  <h2>{currentProject.name}</h2>

                  <p>Проект открыт и готов к работе.</p>
                </div>
              </div>

              <div className="project-info-grid">
                <div className="info-card">
                  <span>Board</span>

                  <strong>{formatBoard(currentProject.board)}</strong>
                </div>

                <div className="info-card">
                  <span>ESP-IDF</span>

                  <strong>{formatIdfVersion(currentProject.idfVersion)}</strong>
                </div>

                <div className="info-card">
                  <span>Git</span>

                  <strong>{formatGitMode(currentProject.gitMode)}</strong>
                </div>

                <div className="info-card">
                  <span>Build</span>
                  <strong>
                    {
                      buildLabels[
                        buildState?.projectPath === currentProject.path ? buildState.status : 'idle'
                      ]
                    }
                  </strong>
                </div>

                <div className="info-card">
                  <span>Port</span>
                  <strong>Not connected</strong>
                </div>

                <div className="info-card">
                  <span>AI</span>
                  <strong>Not connected</strong>
                </div>
              </div>

              <div className="dashboard-actions">
                <button type="button" onClick={() => setActivePage('Code Editor')}>
                  Code Editor
                </button>

                <button
                  type="button"
                  onClick={() => document.getElementById('project-build')?.scrollIntoView()}
                >
                  Сборка
                </button>

                <button type="button" onClick={() => setActivePage('AI')}>
                  AI
                </button>

                <button type="button" onClick={() => setActivePage('Monitor')}>
                  Monitor
                </button>
              </div>
              <div id="project-build">
                <BuildPanel
                  key={currentProject.path}
                  target={currentProject.board}
                  onFlash={(port) => {
                    void startBuild(port)
                  }}
                  state={buildState?.projectPath === currentProject.path ? buildState : null}
                  onBuild={() => {
                    void startBuild()
                  }}
                  blocked={!!buildBusy || editorSaving || projectBusy || !isAppStateLoaded}
                  dirty={hasUnsavedChanges(
                    editorSessions[currentProject.path] ?? emptyEditorSession
                  )}
                />
              </div>
            </section>
          )}

          {activePage === 'ESP-IDF Manager' && (
            <EnvironmentPage
              key={currentProject?.path ?? 'no-project'}
              projectTarget={currentProject?.board}
            />
          )}
          <div className={`code-editor-keep-alive ${activePage === 'Code Editor' ? 'active' : ''}`}>
            <CodeEditorPage
              blocked={
                (!!buildBusy && buildState?.projectPath === currentProject?.path) ||
                closeRequested ||
                closeProjectRequested ||
                !!pendingProject ||
                !!unavailableProject ||
                projectBusy ||
                showNewProject ||
                !isAppStateLoaded
              }
              sessions={editorSessions}
              setSessions={updateSessions}
              onSavingChange={setEditorSaving}
              projectName={currentProject?.name}
              projectPath={currentProject?.path}
              isActive={activePage === 'Code Editor'}
            />
          </div>
        </section>

        <footer className="statusbar">
          <span>ESP: {currentProject ? formatBoard(currentProject.board) : 'Not selected'}</span>

          <span>Port: Not connected</span>

          <span>
            ESP-IDF:{' '}
            {currentProject ? formatIdfVersion(currentProject.idfVersion) : 'Not configured'}
          </span>

          <span>AI: Not connected</span>
        </footer>
      </main>

      {recentMenu &&
        activePage === 'Home' &&
        !unavailableProject &&
        !closeRequested &&
        !pendingProject &&
        !showNewProject && (
          <RecentProjectMenu
            x={recentMenu.x}
            y={recentMenu.y}
            trigger={recentMenu.trigger}
            onClose={() => setRecentMenu(null)}
            onRemove={() => {
              setRecentProjects((projects) =>
                projects.filter((project) => project.path !== recentMenu.project.path)
              )
              setRecentMenu(null)
            }}
          />
        )}
      {unavailableProject && !closeRequested && (
        <ProjectUnavailableDialog
          name={unavailableProject.project.name}
          path={unavailableProject.project.path}
          error={unavailableProject.error}
          busy={projectBusy}
          onCancel={() => setUnavailableProject(null)}
          onLocate={() => {
            void relocateProject()
          }}
          onRemove={() => {
            const path = unavailableProject.project.path
            setRecentProjects((projects) => projects.filter((project) => project.path !== path))
            if (currentProject?.path === path) closeProject()
            setUnavailableProject(null)
          }}
        />
      )}
      {(pendingProject || closeRequested || closeProjectRequested) && (
        <div className="editor-confirm-overlay">
          <div
            className="editor-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={
              closeRequested
                ? 'Закрытие программы'
                : closeProjectRequested
                  ? 'Закрытие проекта'
                  : 'Переключение проекта'
            }
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !closing) {
                event.preventDefault()
                setPendingProject(null)
                setCloseRequested(false)
                setCloseProjectRequested(false)
              }
              if (event.key === 'Tab') {
                const buttons =
                  event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
                const first = buttons[0],
                  last = buttons[buttons.length - 1]
                if (!first) {
                  event.preventDefault()
                  return
                }
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault()
                  last.focus()
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault()
                  first.focus()
                }
              }
            }}
          >
            <h3>
              {closeRequested
                ? 'Закрыть ESP AI Studio?'
                : closeProjectRequested
                  ? 'Закрыть проект?'
                  : 'Переключить проект?'}
            </h3>
            <p>
              {Object.values(editorSessions).some(hasUnsavedChanges)
                ? 'Есть несохранённые изменения. Они останутся в сессиях редактора; исходные файлы на диске не изменятся.'
                : 'Вкладки и активные файлы будут сохранены для следующего запуска.'}
            </p>
            {editorSaving && <p>Дождитесь завершения сохранения файла.</p>}
            {buildBusy && (
              <p>Дождитесь завершения сборки или прошивки перед закрытием программы.</p>
            )}
            {(projectBusy || isCreating) && <p>Дождитесь завершения операции с проектом.</p>}
            {!isAppStateLoaded && <p>Дождитесь загрузки состояния IDE.</p>}
            {storageError && <p role="alert">{storageError}</p>}
            <div className="editor-confirm-actions">
              <button
                type="button"
                autoFocus
                disabled={closing}
                onClick={() => {
                  setPendingProject(null)
                  setCloseRequested(false)
                  setCloseProjectRequested(false)
                }}
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={
                  closing ||
                  editorSaving ||
                  projectBusy ||
                  isCreating ||
                  !isAppStateLoaded ||
                  (!!buildBusy && closeRequested)
                }
                onClick={() => {
                  if (closeRequested) {
                    void finishClose()
                    return
                  }
                  if (closeProjectRequested) {
                    closeProject()
                    return
                  }
                  if (pendingProject) {
                    setCurrentProject(pendingProject)
                    setActivePage('Dashboard')
                    setPendingProject(null)
                  }
                }}
              >
                {closing
                  ? 'Сохранение сессий…'
                  : closeRequested
                    ? 'Сохранить сессии и выйти'
                    : closeProjectRequested
                      ? 'Закрыть, сохранив сессию'
                      : 'Переключить, сохранив правки'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showNewProject && (
        <div className="modal-overlay">
          <div className="project-modal">
            <div className="modal-header">
              <div>
                <h2>New Project</h2>

                <p>Создание нового ESP-IDF проекта</p>
              </div>

              <button
                className="close-button"
                type="button"
                onClick={() => setShowNewProject(false)}
              >
                ×
              </button>
            </div>

            <div className="modal-content">
              <label className="form-field">
                <span>Project name</span>

                <input
                  ref={projectNameInputRef}
                  type="text"
                  value={projectName}
                  placeholder="MyESPProject"
                  aria-describedby={projectFormError ? 'project-form-error' : undefined}
                  onChange={(event) => {
                    setProjectName(event.target.value)
                    setProjectFormError('')
                  }}
                />

                <small>
                  Используй латинские буквы A–Z, a–z, цифры, дефис (-) или подчёркивание (_).
                </small>
              </label>

              <label className="form-field">
                <span>Location</span>

                <div className="location-row">
                  <input
                    type="text"
                    value={projectLocation}
                    placeholder="Выберите папку проекта"
                    readOnly
                  />

                  <button type="button" className="browse-button" onClick={handleBrowse}>
                    Browse
                  </button>
                </div>
              </label>

              <label className="form-field">
                <span>Board</span>

                <select value={board} onChange={(event) => setBoard(event.target.value)}>
                  <option value="">Not selected</option>

                  <option value="esp32">ESP32</option>

                  <option value="esp32s2">ESP32-S2</option>

                  <option value="esp32s3">ESP32-S3</option>

                  <option value="esp32c3">ESP32-C3</option>

                  <option value="esp32c6">ESP32-C6</option>
                </select>

                <small>Можно выбрать позже.</small>
              </label>

              <label className="form-field">
                <span>ESP-IDF version</span>

                <select value={idfVersion} onChange={(event) => setIdfVersion(event.target.value)}>
                  <option value="recommended">Recommended</option>

                  <option value="later">Select later</option>
                </select>

                <small>Конкретную версию можно изменить позже.</small>
              </label>

              <label className="form-field">
                <span>Git</span>

                <select
                  value={gitMode}
                  onChange={(event) =>
                    setGitMode(event.target.value as 'local' | 'github' | 'none')
                  }
                >
                  <option value="local">Local Git</option>

                  <option value="github" disabled>
                    Git + GitHub (подключим позже)
                  </option>

                  <option value="none">No Git</option>
                </select>
              </label>
            </div>

            {projectFormError && (
              <div className="project-form-error" id="project-form-error" role="alert">
                {projectFormError}
              </div>
            )}

            <div className="modal-actions">
              <button
                className="cancel-button"
                type="button"
                disabled={isCreating}
                onClick={() => setShowNewProject(false)}
              >
                Cancel
              </button>

              <button
                className="create-button"
                type="button"
                disabled={isCreating}
                onClick={handleCreateProject}
              >
                {isCreating ? 'Creating...' : 'Create Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
