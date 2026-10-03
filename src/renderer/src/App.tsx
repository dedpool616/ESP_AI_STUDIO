function App(): React.JSX.Element {
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
            <button className="primary-action" type="button">
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
    </div>
  )
}

export default App