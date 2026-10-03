import { useState } from 'react'

function App(): React.JSX.Element {
  const [showNewProject, setShowNewProject] = useState(false)
  const [projectLocation, setProjectLocation] = useState('')

  const handleBrowse = async (): Promise<void> => {
    const folder = await window.api.selectFolder()

    if (folder) {
      setProjectLocation(folder)
    }
  }

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

  return (
    <div className="app-shell">
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
              className={`nav-item ${item === 'Home' ? 'active' : ''}`}
              type="button"
            >
              {item}
            </button>
          ))}
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>ESP AI Studio</h1>
            <p>AI-powered development environment for ESP32 and ESP-IDF</p>
          </div>

          <div className="environment-status">
            <span className="status-dot"></span>
            Ready
          </div>
        </header>

        <section className="home-content">
          <div className="welcome">
            <h2>Добро пожаловать</h2>

            <p>
              Создай новый ESP-IDF проект или открой существующий. AI можно
              подключить на любом этапе работы.
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

            <button className="secondary-action" type="button">
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
                <p>Недавно открытые проекты появятся здесь.</p>
              </div>
            </div>

            <div className="empty-projects">
              <div className="empty-icon">{'{ }'}</div>

              <h4>Проектов пока нет</h4>

              <p>
                Создай первый проект или открой уже существующий ESP-IDF
                проект.
              </p>
            </div>
          </section>
        </section>

        <footer className="statusbar">
          <span>ESP: Not selected</span>
          <span>Port: Not connected</span>
          <span>ESP-IDF: Not configured</span>
          <span>AI: Not connected</span>
        </footer>
      </main>

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
                  type="text"
                  placeholder="MyESPProject"
                />
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

                <select defaultValue="">
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

                <select defaultValue="recommended">
                  <option value="recommended">Recommended</option>
                  <option value="later">Select later</option>
                </select>

                <small>Конкретную версию можно изменить позже.</small>
              </label>

              <label className="form-field">
                <span>Git</span>

                <select defaultValue="local">
                  <option value="local">Local Git</option>
                  <option value="github">Git + GitHub</option>
                  <option value="none">No Git</option>
                </select>
              </label>
            </div>

            <div className="modal-actions">
              <button
                className="cancel-button"
                type="button"
                onClick={() => setShowNewProject(false)}
              >
                Cancel
              </button>

              <button
                className="create-button"
                type="button"
              >
                Create Project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App