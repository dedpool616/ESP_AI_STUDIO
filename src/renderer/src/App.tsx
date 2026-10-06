import { useState } from 'react'
import CodeEditorPage from './pages/CodeEditorPage'

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
  const [projectLocation, setProjectLocation] = useState('')
  const [board, setBoard] = useState('')
  const [idfVersion, setIdfVersion] = useState('recommended')

  const [gitMode, setGitMode] =
    useState<'local' | 'github' | 'none'>('local')

  const [isCreating, setIsCreating] = useState(false)

  const [currentProject, setCurrentProject] =
    useState<ProjectInfo | null>(null)

  const [recentProjects, setRecentProjects] =
    useState<ProjectInfo[]>([])

  const [activePage, setActivePage] = useState('Home')

  const navigation = [
    'Home',
    'AI',
    'Code Editor',
    'AI + Code',
    'Pin Manager',
    'Monitor',
    'Terminal',
    'Git',
    'Activity',
    'User Guide',
    'Settings'
  ]

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
    if (!projectName.trim()) {
      window.alert('Введите имя проекта.')
      return
    }

    if (!projectLocation) {
      window.alert('Выберите папку для проекта.')
      return
    }

    setIsCreating(true)

    try {
      const result = await window.api.createProject({
        projectName: projectName.trim(),
        location: projectLocation,
        board,
        idfVersion,
        gitMode
      })

      if (!result.success || !result.projectPath) {
        window.alert(
          `Не удалось создать проект.\n\n${result.error ?? 'Unknown error'}`
        )

        return
      }

      const newProject: ProjectInfo = {
        name: projectName.trim(),
        path: result.projectPath,
        board,
        idfVersion,
        gitMode
      }

      setCurrentProject(newProject)

      setRecentProjects((projects) => {
        const filteredProjects = projects.filter(
          (project) => project.path !== newProject.path
        )

        return [newProject, ...filteredProjects].slice(0, 8)
      })

      setShowNewProject(false)
      resetNewProjectForm()
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

  const formatGitMode = (
    projectGitMode: 'local' | 'github' | 'none'
  ): string => {
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
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">ESP</div>

          <div>
            <div className="brand-title">
              ESP AI Studio
            </div>

            <div className="brand-version">
              v0.1.0
            </div>
          </div>
        </div>

        <nav className="navigation">
          {navigation.map((item) => (
            <button
              key={item}
              className={`nav-item ${
                item === activePage ? 'active' : ''
              }`}
              type="button"
	      onClick={() => setActivePage(item)}
            >
              {item}
            </button>
          ))}
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>
              {currentProject
                ? currentProject.name
                : 'ESP AI Studio'}
            </h1>

            <p>
              {currentProject
                ? currentProject.path
                : 'AI-powered development environment for ESP32 and ESP-IDF'}
            </p>
          </div>

          <div className="environment-status">
            <span className="status-dot" />
            Ready
          </div>
        </header>

<section
  className={`home-content ${
    activePage === 'Code Editor'
      ? 'code-editor-host'
      : ''
  }`}
>

  {activePage === 'Home' && (
    <>
      {!currentProject && (
        <>
          <div className="welcome">
            <h2>Добро пожаловать</h2>

            <p>
              Создай новый ESP-IDF проект или открой существующий.
              AI можно подключить на любом этапе работы.
            </p>
          </div>

          <div className="project-actions">
            <button
              className="primary-action"
              type="button"
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
            >
              <span className="action-symbol">↗</span>

              <span>
                <strong>Open Project</strong>
                <small>Открыть существующий проект</small>
              </span>
            </button>
          </div>
        </>
      )}

      {currentProject && (
        <section className="project-dashboard">
          <div className="dashboard-heading">
            <div>
              <h2>{currentProject.name}</h2>

              <p>
                Проект открыт и готов к работе.
              </p>
            </div>
          </div>

          <div className="project-info-grid">
            <div className="info-card">
              <span>Board</span>

              <strong>
                {formatBoard(currentProject.board)}
              </strong>
            </div>

            <div className="info-card">
              <span>ESP-IDF</span>

              <strong>
                {formatIdfVersion(currentProject.idfVersion)}
              </strong>
            </div>

            <div className="info-card">
              <span>Git</span>

              <strong>
                {formatGitMode(currentProject.gitMode)}
              </strong>
            </div>

            <div className="info-card">
              <span>Build</span>
              <strong>Not built</strong>
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
            <button
              type="button"
              onClick={() => setActivePage('Code Editor')}
            >
              Code Editor
            </button>

            <button type="button">
              Build
            </button>

            <button
              type="button"
              onClick={() => setActivePage('AI')}
            >
              AI
            </button>

            <button
              type="button"
              onClick={() => setActivePage('Monitor')}
            >
              Monitor
            </button>
          </div>
        </section>
      )}

      <section className="recent-section">
        <div className="section-heading">
          <div>
            <h3>Recent Projects</h3>

            <p>
              Недавно открытые проекты.
            </p>
          </div>
        </div>

        {recentProjects.length === 0 ? (
          <div className="empty-projects">
            <div className="empty-icon">
              {'{ }'}
            </div>

            <h4>
              Проектов пока нет
            </h4>

            <p>
              Создай первый проект или открой уже существующий
              ESP-IDF проект.
            </p>
          </div>
        ) : (
          <div className="recent-project-list">
            {recentProjects.map((project) => (
              <button
                key={project.path}
                type="button"
                className="recent-project-card"
                onClick={() => {
                  setCurrentProject(project)
                  setActivePage('Home')
                }}
              >
                <div>
                  <strong>
                    {project.name}
                  </strong>

                  <span>
                    {project.path}
                  </span>
                </div>

                <small>
                  {formatBoard(project.board)}
                </small>
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  )}

<div
  className={`code-editor-keep-alive ${
    activePage === 'Code Editor'
      ? 'active'
      : ''
  }`}
>
  <CodeEditorPage
    projectName={currentProject?.name}
    projectPath={currentProject?.path}
    isActive={
      activePage === 'Code Editor'
    }
  />
</div>
</section>

<footer className="statusbar">
          <span>
            ESP:{' '}
            {currentProject
              ? formatBoard(currentProject.board)
              : 'Not selected'}
          </span>

          <span>
            Port: Not connected
          </span>

          <span>
            ESP-IDF:{' '}
            {currentProject
              ? formatIdfVersion(
                  currentProject.idfVersion
                )
              : 'Not configured'}
          </span>

          <span>
            AI: Not connected
          </span>
        </footer>
      </main>

      {showNewProject && (
        <div className="modal-overlay">
          <div className="project-modal">
            <div className="modal-header">
              <div>
                <h2>New Project</h2>

                <p>
                  Создание нового ESP-IDF проекта
                </p>
              </div>

              <button
                className="close-button"
                type="button"
                onClick={() =>
                  setShowNewProject(false)
                }
              >
                ×
              </button>
            </div>

            <div className="modal-content">
              <label className="form-field">
                <span>Project name</span>

                <input
                  type="text"
                  value={projectName}
                  placeholder="MyESPProject"
                  onChange={(event) =>
                    setProjectName(
                      event.target.value
                    )
                  }
                />

                <small>
                  Используй буквы, цифры,
                  "-" или "_".
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

                  <button
                    type="button"
                    className="browse-button"
                    onClick={handleBrowse}
                  >
                    Browse
                  </button>
                </div>
              </label>

              <label className="form-field">
                <span>Board</span>

                <select
                  value={board}
                  onChange={(event) =>
                    setBoard(
                      event.target.value
                    )
                  }
                >
                  <option value="">
                    Not selected
                  </option>

                  <option value="esp32">
                    ESP32
                  </option>

                  <option value="esp32s2">
                    ESP32-S2
                  </option>

                  <option value="esp32s3">
                    ESP32-S3
                  </option>

                  <option value="esp32c3">
                    ESP32-C3
                  </option>

                  <option value="esp32c6">
                    ESP32-C6
                  </option>
                </select>

                <small>
                  Можно выбрать позже.
                </small>
              </label>

              <label className="form-field">
                <span>
                  ESP-IDF version
                </span>

                <select
                  value={idfVersion}
                  onChange={(event) =>
                    setIdfVersion(
                      event.target.value
                    )
                  }
                >
                  <option value="recommended">
                    Recommended
                  </option>

                  <option value="later">
                    Select later
                  </option>
                </select>

                <small>
                  Конкретную версию можно изменить позже.
                </small>
              </label>

              <label className="form-field">
                <span>Git</span>

                <select
                  value={gitMode}
                  onChange={(event) =>
                    setGitMode(
                      event.target.value as
                        | 'local'
                        | 'github'
                        | 'none'
                    )
                  }
                >
                  <option value="local">
                    Local Git
                  </option>

                  <option
                    value="github"
                    disabled
                  >
                    Git + GitHub
                    (подключим позже)
                  </option>

                  <option value="none">
                    No Git
                  </option>
                </select>
              </label>
            </div>

            <div className="modal-actions">
              <button
                className="cancel-button"
                type="button"
                disabled={isCreating}
                onClick={() =>
                  setShowNewProject(false)
                }
              >
                Cancel
              </button>

              <button
                className="create-button"
                type="button"
                disabled={isCreating}
                onClick={handleCreateProject}
              >
                {isCreating
                  ? 'Creating...'
                  : 'Create Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App