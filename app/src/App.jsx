import { useState, useEffect, useRef, useCallback } from 'react'
import { GoGitBranch } from 'react-icons/go'
import { FiFileText, FiMonitor } from 'react-icons/fi'
import './App.css'

function LoginPage({ onLogin }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [shake, setShake] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const attempt = (pw) => {
    onLogin(pw, () => {
      setError(true)
      setShake(true)
      setTimeout(() => setShake(false), 500)
      setPassword('')
      inputRef.current?.focus()
    })
  }

  const onKeyDown = e => { if (e.key === 'Enter') attempt(password) }

  return (
    <div className="login-page">
      <div className={`login-card${shake ? ' login-card--shake' : ''}`}>
        <div className="login-card__header">
          <img src="/images/intern1_logo_dark.png" alt="intern1" className="login-card__logo" />
          <div className="login-card__subtitle">
            Enter password to continue
          </div>
        </div>

        <div className="login-card__fields">
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(false) }}
            onKeyDown={onKeyDown}
            placeholder="Password"
            className={`login-card__input${error ? ' login-card__input--error' : ''}`}
          />
          {error && (
            <div className="login-card__error">
              Incorrect password
            </div>
          )}
          <button
            onClick={() => attempt(password)}
            className="login-card__submit"
          >
            Unlock
          </button>
        </div>
      </div>
    </div>
  )
}

function TunnelBanner({ url, onDismiss }) {
  const [copied, setCopied] = useState(false)
  const isUrl = url.startsWith('http')

  const copy = () => {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="tunnel-banner">
      {isUrl ? (
        <>
          <span>🌐 Tunnel:</span>
          <a href={url} target="_blank" rel="noreferrer" className="tunnel-banner__link">{url}</a>
        </>
      ) : (
        <span>🌐 Tunnel active — ID: {url}</span>
      )}
      <button onClick={copy} className="tunnel-banner__copy-btn">
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <button onClick={onDismiss} className="tunnel-banner__dismiss-btn">✕</button>
    </div>
  )
}

// Desktop: draggable divider with snap buttons
function DesktopDivider({ splitPct, onSnap, onDragStart, logsMode, onLogsToggle, shellMode, onShellToggle, onShowApp, appActive }) {
  const btn = (onClick, label, title, active) => (
    <button
      key={title}
      title={title}
      onClick={onClick}
      onMouseDown={e => e.stopPropagation()}
      className={`divider__btn${active ? ' divider__btn--active' : ''}`}
    >
      {label}
    </button>
  )

  return (
    <div
      onMouseDown={onDragStart}
      className="divider"
    >
      {[
        <img key="logo" src="/images/intern1_logo_dark.png" alt="intern1" className="divider__logo" />,
        btn(() => onSnap(100), '◀', 'Maximize left',  splitPct === 100),
        btn(() => onSnap(50),  '[|]', 'Split 50/50',    splitPct === 50 ),
        btn(() => onSnap(0),   '▶', 'Maximize right', splitPct === 0  ),
        <div key="sep" className="divider__sep" />,
        btn(onShowApp,     <FiMonitor />,   'App',   appActive ),
        btn(onLogsToggle,  <FiFileText />,  'Logs',  logsMode  ),
        btn(onShellToggle, '>_',            'Shell', shellMode ),
      ]}
    </div>
  )
}

// Mobile: tab bar at top to avoid iOS home bar / iframe overflow issues
function MobileTabBar({ active, onChange }) {
  const btn = (key, label) => (
    <button
      key={key}
      onClick={() => onChange(key)}
      className={`tab-bar__btn${active === key ? ' tab-bar__btn--active' : ''}`}
    >
      {label}
    </button>
  )

  return (
    <div className="tab-bar">
      <img src="/images/intern1_logo_dark.png" alt="intern1" className="tab-bar__logo" />
      {btn('left',  'Intern1')}
      {btn('right', 'App'   )}
      {btn('logs',  'Logs'  )}
      {btn('shell', 'Shell' )}
    </div>
  )
}

function ProjectBar({ rightUrl, projects, onSwitch }) {
  if (!rightUrl || !projects?.length) return null
  const name = rightUrl.replace(/^\/code\//, '').replace(/\/$/, '')
  const project = projects.find(p => p.name === name)
  const iframeProjects = projects.filter(p => p.iframe)

  return (
    <div className="project-bar">
      {iframeProjects.length > 1
        ? iframeProjects.map(p => (
            <button
              key={p.name}
              onClick={() => onSwitch(`/code/${p.name}/`)}
              className={`project-bar__tab${p.name === name ? ' project-bar__tab--active' : ''}`}
            >
              {p.name}
            </button>
          ))
        : <>
            <span className="project-bar__name">{project?.name}</span>
            {project?.branch && <><span>·</span><span className="project-bar__branch"><GoGitBranch />{project.branch}</span></>}
          </>
      }
    </div>
  )
}

function OnboardingPage({ onComplete }) {
  const emptyProject = () => ({ name: '', repo: '', port: '3001', start: 'npm run dev', git_token: '', ai_branch_name: '', env_content: '', iframe: true })
  const [apiKey, setApiKey] = useState('')
  const [apiKeySet, setApiKeySet] = useState(null) // null=checking, true=already set, false=needs input
  const [apiKeyStatus, setApiKeyStatus] = useState(null) // { status: 'checking'|'ok'|'fail', message }
  const apiKeyTimer = useRef(null)
  const [projects, setProjects] = useState([emptyProject()])
  const [tunnelMode, setTunnelMode] = useState('none')
  const [tunnelToken, setTunnelToken] = useState('')
  const [tunnelStatus, setTunnelStatus] = useState(null) // { status: 'checking'|'ok'|'fail', message: string }
  const tunnelTimer = useRef(null)
  const [gitStatus, setGitStatus] = useState({}) // { [index]: { status: 'checking'|'ok'|'fail', message: string } }
  const gitTimers = useRef({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/api/auth/api-key-check', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setApiKeySet(d.set))
      .catch(() => setApiKeySet(false))
  }, [])

  const checkApiKey = useCallback((key) => {
    if (apiKeyTimer.current) clearTimeout(apiKeyTimer.current)
    if (!key.trim()) {
      setApiKeyStatus(null)
      return
    }
    if (!key.trim().startsWith('sk-ant-')) {
      setApiKeyStatus({ status: 'fail', message: 'Key should start with sk-ant-' })
      return
    }
    setApiKeyStatus({ status: 'checking', message: 'Validating API key...' })
    apiKeyTimer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/auth/api-key-validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ apiKey: key.trim() }),
        })
        const data = await res.json()
        setApiKeyStatus({ status: data.ok ? 'ok' : 'fail', message: data.message })
      } catch {
        setApiKeyStatus({ status: 'fail', message: 'Connection error' })
      }
    }, 800)
  }, [])

  const checkTunnel = useCallback((token) => {
    if (tunnelTimer.current) clearTimeout(tunnelTimer.current)
    if (!token.trim()) {
      setTunnelStatus(null)
      return
    }
    setTunnelStatus({ status: 'checking', message: 'Connecting tunnel...' })
    tunnelTimer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/auth/tunnel-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ token: token.trim() }),
        })
        const data = await res.json()
        setTunnelStatus({ status: data.ok ? 'ok' : 'fail', message: data.message })
      } catch {
        setTunnelStatus({ status: 'fail', message: 'Failed to reach server' })
      }
    }, 800)
  }, [])

  const checkGit = useCallback((i, repo, token) => {
    if (gitTimers.current[i]) clearTimeout(gitTimers.current[i])
    if (!repo.trim()) {
      setGitStatus(s => { const n = { ...s }; delete n[i]; return n })
      return
    }
    setGitStatus(s => ({ ...s, [i]: { status: 'checking', message: 'Checking repository...' } }))
    gitTimers.current[i] = setTimeout(async () => {
      try {
        const res = await fetch('/api/auth/git-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ repo: repo.trim(), git_token: token.trim() || undefined }),
        })
        const data = await res.json()
        setGitStatus(s => ({ ...s, [i]: { status: data.ok ? 'ok' : 'fail', message: data.message } }))
      } catch {
        setGitStatus(s => ({ ...s, [i]: { status: 'fail', message: 'Connection error' } }))
      }
    }, 800)
  }, [])

  const update = (i, field, value) => {
    const updated = projects.map((p, j) => {
      if (j !== i) return p
      const next = { ...p, [field]: value }
      // Auto-populate name from repo URL if name hasn't been manually edited
      if (field === 'repo' && !p._nameEdited) {
        const match = value.trim().match(/\/([^\/]+?)(?:\.git)?$/)
        next.name = match ? match[1] : p.name
      }
      if (field === 'name') next._nameEdited = true
      return next
    })
    setProjects(updated)
    if (field === 'repo' || field === 'git_token') {
      const p = updated[i]
      checkGit(i, p.repo, p.git_token)
    }
  }

  const submit = async () => {
    setError(null)
    if (apiKeySet === false && !apiKey.trim()) {
      setError('Anthropic API key is required.')
      return
    }
    for (const p of projects) {
      if (!p.name.trim() || !p.repo.trim() || !p.port) {
        setError('Name, repository URL and port are required for each project.')
        return
      }
    }
    if (tunnelMode === 'named' && !tunnelToken.trim()) {
      setError('Tunnel token is required for named tunnels.')
      return
    }
    setSubmitting(true)
    try {
      const payload = projects.map(p => ({
        name: p.name.trim(),
        repo: p.repo.trim(),
        port: parseInt(p.port),
        ...(p.start.trim()          ? { start: p.start.trim() }               : {}),
        ...(p.git_token.trim()      ? { git_token: p.git_token.trim() }           : {}),
        ...(p.ai_branch_name.trim() ? { ai_branch_name: p.ai_branch_name.trim() } : {}),
        ...(p.env_content.trim()    ? { env_content: p.env_content }              : {}),
        ...(p.iframe                ? { iframe: true }                            : {}),
      }))
      const tunnel = { mode: tunnelMode }
      if (tunnelMode === 'named') {
        tunnel.token = tunnelToken.trim()
      }
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ projects: payload, tunnel, ...(apiKeySet === false && apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }),
      })
      const data = await res.json()
      if (data.success) {
        onComplete()
      } else {
        setError(data.error || 'Setup failed')
        setSubmitting(false)
      }
    } catch (e) {
      setError(e.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="onboarding-page">
      <div className="onboarding-page__inner">
        <div className="onboarding-page__header">
          <img src="/images/intern1_logo_dark.png" alt="intern1" className="onboarding-page__logo" />
          <h1 className="onboarding-page__title">Welcome to Intern1</h1>
          <p className="onboarding-page__subtitle">Configure your first project to get started.</p>
        </div>

        {apiKeySet === false && (
          <div className="tunnel-card">
            <span className="project-card__label">ANTHROPIC API KEY</span>
            <div className="tunnel-card__fields" style={{ marginTop: 14 }}>
              <div className="project-card__field project-card__field--full">
                <input className="form-input" type="password" placeholder="sk-ant-..."
                  value={apiKey} onChange={e => { setApiKey(e.target.value); checkApiKey(e.target.value) }} />
              </div>
              {apiKeyStatus && (
                <div className={`git-check-msg git-check-msg--${apiKeyStatus.status}`}>
                  {apiKeyStatus.status === 'checking' && <span className="git-check-msg__icon">&#8987;</span>}
                  {apiKeyStatus.status === 'ok' && <span className="git-check-msg__icon">&#10003;</span>}
                  {apiKeyStatus.status === 'fail' && <span className="git-check-msg__icon">&#10007;</span>}
                  <span>{apiKeyStatus.message}</span>
                </div>
              )}
            </div>
          </div>
        )}
        {apiKeySet === true && (
          <div className="git-check-msg git-check-msg--ok" style={{ marginBottom: 16 }}>
            <span className="git-check-msg__icon">&#10003;</span>
            <span>Anthropic API key is configured</span>
          </div>
        )}

        <div className="tunnel-card">
          <span className="project-card__label">TUNNEL</span>
          <div className="tunnel-card__options">
            {[
              { value: 'none', label: 'No Tunnel', desc: 'Local access only (localhost:3500)',
                hint: 'Your container will only be accessible from this machine. Best for local development where you don\'t need external access.' },
              { value: 'quick', label: 'Quick Tunnel', desc: 'Temporary trycloudflare.com URL',
                hint: 'Generates a random public URL (e.g. random-words.trycloudflare.com) with no account needed. The URL changes every time the container restarts, and availability depends on Cloudflare\'s free tunnel service.' },
              { value: 'named', label: 'Named Tunnel', desc: 'Persistent Cloudflare subdomain',
                hint: 'Uses your own Cloudflare tunnel with a stable URL that persists across restarts. Requires a Cloudflare account and a pre-configured tunnel. Run "cloudflared tunnel token <NAME>" to get your token.' },
            ].map(opt => (
              <div key={opt.value} className="tunnel-card__option-wrap">
                <button
                  className={`tunnel-card__option${tunnelMode === opt.value ? ' tunnel-card__option--active' : ''}`}
                  onClick={() => { setTunnelMode(opt.value); if (opt.value !== 'named') setTunnelStatus(null) }}
                  type="button"
                >
                  <span className="tunnel-card__option-label">{opt.label}</span>
                  <span className="tunnel-card__option-desc">{opt.desc}</span>
                </button>
                <div className="tunnel-card__tooltip">{opt.hint}</div>
              </div>
            ))}
          </div>
          {tunnelMode === 'named' && (
            <div className="tunnel-card__fields">
              <div className="project-card__field project-card__field--full">
                <label className="form-label">CLOUDFLARE TUNNEL TOKEN *</label>
                <input className="form-input" type="password" placeholder="eyJh…"
                  value={tunnelToken} onChange={e => { setTunnelToken(e.target.value); checkTunnel(e.target.value) }} />
              </div>
              {tunnelStatus && (
                <div className={`git-check-msg git-check-msg--${tunnelStatus.status}`}>
                  {tunnelStatus.status === 'checking' && <span className="git-check-msg__icon">&#8987;</span>}
                  {tunnelStatus.status === 'ok' && <span className="git-check-msg__icon">&#10003;</span>}
                  {tunnelStatus.status === 'fail' && <span className="git-check-msg__icon">&#10007;</span>}
                  <span>{tunnelStatus.message}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {projects.map((p, i) => (
          <div key={i} className="project-card">
            <div className="project-card__top">
              <span className="project-card__label">PROJECT {i + 1}</span>
              {projects.length > 1 && (
                <button onClick={() => setProjects(projects.filter((_, j) => j !== i))}
                  className="project-card__remove-btn">×</button>
              )}
            </div>

            <div className="project-card__grid">
              <div className="project-card__field project-card__field--full">
                <label className="form-label">REPOSITORY URL *</label>
                <input className="form-input" placeholder="https://github.com/org/repo.git"
                  value={p.repo} onChange={e => update(i, 'repo', e.target.value)} />
              </div>
              <div className="project-card__field project-card__field--full">
                <label className="form-label">GIT ACCESS TOKEN</label>
                <input className="form-input" type="password" placeholder="ghp_… (for private repos)"
                  value={p.git_token} onChange={e => update(i, 'git_token', e.target.value)} />
              </div>
              {gitStatus[i] && (
                <div className={`git-check-msg git-check-msg--${gitStatus[i].status}`}>
                  {gitStatus[i].status === 'checking' && <span className="git-check-msg__icon">&#8987;</span>}
                  {gitStatus[i].status === 'ok' && <span className="git-check-msg__icon">&#10003;</span>}
                  {gitStatus[i].status === 'fail' && <span className="git-check-msg__icon">&#10007;</span>}
                  <span>{gitStatus[i].message}</span>
                </div>
              )}
              <div className="project-card__field">
                <label className="form-label">PROJECT NAME *</label>
                <input className="form-input" placeholder="my-app"
                  value={p.name} onChange={e => update(i, 'name', e.target.value)} />
              </div>
              <div className="project-card__field">
                <label className="form-label">PORT *</label>
                <input className="form-input" type="number" placeholder="3001"
                  value={p.port} onChange={e => update(i, 'port', e.target.value)} />
              </div>
              <div className="project-card__field">
                <label className="form-label">START COMMAND</label>
                <input className="form-input" placeholder="npm run dev"
                  value={p.start} onChange={e => update(i, 'start', e.target.value)} />
              </div>
              <div className="project-card__field">
                <label className="form-label">AI BRANCH</label>
                <input className="form-input" placeholder="main"
                  value={p.ai_branch_name} onChange={e => update(i, 'ai_branch_name', e.target.value)} />
              </div>
              <div className="project-card__field project-card__field--full">
                <label className="form-label">.ENV FILE CONTENTS</label>
                <textarea
                  className="form-input form-input--textarea"
                  placeholder={'API_KEY=abc123\nDATABASE_URL=postgres://...'}
                  value={p.env_content}
                  onChange={e => update(i, 'env_content', e.target.value)}
                />
              </div>
              <div className="project-card__field project-card__field--checkbox">
                <input type="checkbox" id={`iframe-${i}`} checked={p.iframe}
                  onChange={e => update(i, 'iframe', e.target.checked)}
                  className="form-checkbox" />
                <label htmlFor={`iframe-${i}`} className="form-label form-label--checkbox">
                  SHOW APP PREVIEW IN RIGHT PANEL
                </label>
              </div>
            </div>
          </div>
        ))}

        <button
          onClick={() => setProjects([...projects, { ...emptyProject(), port: String(3000 + projects.length + 1), iframe: false }])}
          className="onboarding-page__add-btn"
        >
          + Add another project
        </button>

        {error && <div className="onboarding-page__error">{error}</div>}

        <button
          onClick={submit}
          disabled={submitting || !projects.every((p, i) => gitStatus[i]?.status === 'ok')}
          className={`onboarding-page__submit${submitting || !projects.every((p, i) => gitStatus[i]?.status === 'ok') ? ' onboarding-page__submit--submitting' : ''}`}
        >
          {submitting ? 'Starting projects…' : 'Launch intern1'}
        </button>
      </div>
    </div>
  )
}

let iframeAutoSelected = false

function AppPlaceholder() {
  return (
    <div className="app-placeholder">
      waiting for app to come online…
    </div>
  )
}

function ProjectsPanel({ style, onSelectProject, rightUrl }) {
  const [projects, setProjects] = useState([])
  const [logs, setLogs] = useState({})
  const [logOffsets, setLogOffsets] = useState({})
  const logContainerRefs = useRef({})

  const logColor = line => {
    const l = line.toLowerCase()
    if (l.includes('error') || l.includes('err!') || l.includes('failed')) return '#e05555'
    if (l.includes('warn')) return '#f0a050'
    if (l.includes('ready') || l.includes('started') || l.includes('listening') || l.includes('running')) return '#50c050'
    return '#bbb'
  }

  // Poll project status
  useEffect(() => {
    const load = () =>
      fetch('/api/auth/status', { credentials: 'include' })
        .then(r => r.json())
        .then(d => { if (Array.isArray(d)) setProjects(d) })
        .catch(() => {})
    load()
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [])

  // Poll logs for all projects
  useEffect(() => {
    if (!projects.length) return
    const load = () =>
      Promise.all(projects.map(p =>
        fetch(`/api/auth/logs?name=${encodeURIComponent(p.name)}&lines=100`, { credentials: 'include' })
          .then(r => r.json())
          .then(d => [p.name, d.lines || []])
          .catch(() => [p.name, []])
      )).then(results => setLogs(Object.fromEntries(results)))
    load()
    const id = setInterval(load, 2000)
    return () => clearInterval(id)
  }, [projects])

  // Auto-select first iframe project when it comes online (only if no project is already showing)
  useEffect(() => {
    if (iframeAutoSelected || rightUrl || !onSelectProject) return
    const first = projects.find(p => p.iframe && p.online)
    if (first) {
      iframeAutoSelected = true
      onSelectProject(`/code/${first.name}/`)
    }
  }, [projects, onSelectProject, rightUrl])

  // Scroll to bottom only if already near the bottom
  useEffect(() => {
    Object.entries(logContainerRefs.current).forEach(([, el]) => {
      if (!el) return
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
      if (nearBottom) el.scrollTop = el.scrollHeight
    })
  }, [logs])

  const allOnline = projects.length > 0 && projects.every(p => p.online)

  const clearLogs = (name) =>
    setLogOffsets(prev => ({ ...prev, [name]: (logs[name] || []).length }))

  return (
    <div className="projects-panel" style={style}>
      <div className="projects-panel__header">
        <span className="projects-panel__title">PROJECTS</span>
        {projects.length > 0 && (allOnline
          ? <span className="projects-panel__status--online">● all online</span>
          : <span className="projects-panel__status--starting">● starting…</span>
        )}
      </div>

      {projects.length === 0 && (
        <div className="projects-panel__empty">No projects configured.</div>
      )}

      <div className="projects-panel__list">
      {projects.map((p, i) => {
        const clickable = p.iframe && p.online && onSelectProject
        const projectLogs = (logs[p.name] || []).slice(logOffsets[p.name] || 0)
        return (
          <div
            key={p.name}
            className={`project-row${i < projects.length - 1 ? ' project-row--bordered' : ''}`}
          >
            {/* Status row */}
            <div className="project-row__status-row">
              <span
                onClick={clickable ? () => onSelectProject(`/code/${p.name}/`) : undefined}
                className={`project-row__status-main${clickable ? ' project-row__status-main--clickable' : ''}`}
              >
                <span className={`project-row__dot${p.online ? ' project-row__dot--online' : ' project-row__dot--offline'}`}>●</span>
                <div className="project-row__info">
                  <div className="project-row__meta">
                    <span className="project-row__name">{p.name}</span>
                    {p.online
                      ? <span className="project-row__online-label">online</span>
                      : <span className="project-row__starting-label">starting…</span>
                    }
                    {p.branch && <span className="project-row__branch"><GoGitBranch />{p.branch}</span>}
                    {p.port && <span className="project-row__port">:{p.port}</span>}
                    {clickable && <span className="project-row__click-hint">→ click to view</span>}
                  </div>
                </div>
              </span>
              <button
                onClick={() => clearLogs(p.name)}
                className="project-row__clear-btn"
                title="Clear logs"
              >clear</button>
            </div>
            {/* Log output */}
            <div className="project-row__logs" ref={el => { logContainerRefs.current[p.name] = el }}>
              {projectLogs.length === 0
                ? <span className="project-row__log-empty">no output yet…</span>
                : projectLogs.map((line, j) => (
                    <div key={j} className="project-row__log-line" style={{ color: logColor(line) }}>{line}</div>
                  ))
              }
            </div>
          </div>
        )
      })}
      </div>
    </div>
  )
}


function AppLoadingPanel({ style }) {
  const [dots, setDots] = useState('.')
  useEffect(() => {
    const t = setInterval(() => setDots(d => d.length >= 3 ? '.' : d + '.'), 600)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="app-loading" style={style}>
      <div className="app-loading__icon">⏳</div>
      <div className="app-loading__title">Waiting for your app to start{dots}</div>
      <div className="app-loading__subtitle">This happens automatically in the background</div>
    </div>
  )
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const handler = e => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isMobile
}

export default function App() {
  const params = new URLSearchParams(window.location.search)

  const [config, setConfig] = useState(null)
  const [rightUrl, setRightUrl] = useState(params.get('url') || null)
  const [showBanner, setShowBanner] = useState(true)
  const [defaultPassword, setDefaultPassword] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [isPro, setIsPro] = useState(false)
  const [onboarding, setOnboarding] = useState(null) // null=unknown, true=show, false=skip
  const [yepKey, setYepKey] = useState(0)

  // Desktop: split percentage for left panel (0–100)
  const [splitPct, setSplitPct] = useState(50)
  const [dragging, setDragging] = useState(false)
  const containerRef = useRef(null)

  // Right panel mode
  const [logsMode, setLogsMode] = useState(true)
  const [shellMode, setShellMode] = useState(false)
  const shellIframeRef = useRef(null)

  const focusShell = useCallback(() => {
    const iframe = shellIframeRef.current
    if (!iframe) return
    try {
      // xterm.js captures input via a hidden textarea — focus it directly
      const textarea = iframe.contentDocument?.querySelector('.xterm-helper-textarea')
      if (textarea) textarea.focus()
      else iframe.contentWindow?.focus()
    } catch (e) {}
  }, [])

  useEffect(() => {
    if (shellMode) setTimeout(focusShell, 100)
  }, [shellMode, focusShell])

  // Mobile: which panel is visible
  const [mobileActive, setMobileActive] = useState('left')

  const isMobile = useIsMobile()

  // Check authentication status and tier on mount
  useEffect(() => {
    fetch('/api/auth/verify', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        setAuthed(data.authenticated === true)
        if (data.defaultPassword) setDefaultPassword(true)
        setAuthChecked(true)
      })
      .catch(() => {
        setAuthed(false)
        setAuthChecked(true)
      })
    fetch('/api/auth/tier', { credentials: 'include' })
      .then(r => r.json())
      .then(data => setIsPro(data.tier === 'pro'))
      .catch(() => {})
    fetch('/api/auth/config-check', { credentials: 'include' })
      .then(r => r.json())
      .then(data => setOnboarding(!data.hasProjects))
      .catch(() => setOnboarding(false))
  }, [])

  const urlOverride = params.get('url')

  const prevProjectCount = useRef(0)
  const fetchConfig = useCallback(() =>
    fetch('/config.json', { cache: 'no-store' })
      .then(r => r.json())
      .then(c => {
        setConfig(c)
        if (c.rightUrl) setRightUrl(prev => prev || c.rightUrl)
        // Refresh YepAnywhere iframe when projects first appear in config
        const count = (c.projects || []).length
        if (count > 0 && prevProjectCount.current === 0) {
          setYepKey(k => k + 1)
        }
        prevProjectCount.current = count
        return c
      })
      .catch(() => {
        const fallback = { yepUrl: '/yep/', rightUrl: '', tunnelUrl: '' }
        setConfig(fallback)
        return fallback
      })
  , [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  // Poll config until projects appear (covers post-onboarding async setup)
  useEffect(() => {
    if (!config || (config.projects && config.projects.length > 0)) return
    const id = setInterval(fetchConfig, 3000)
    return () => clearInterval(id)
  }, [config, fetchConfig])

  const onDragStart = useCallback(e => {
    e.preventDefault()
    setDragging(true)
  }, [])

  const onMouseMove = useCallback(e => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const pct = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100))
    setSplitPct(Math.round(pct))
  }, [])

  const onMouseUp = useCallback(() => {
    setDragging(false)
  }, [])

  const handleLogin = (pw, onFail) => {
    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ password: pw })
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setAuthed(true)
          if (data.defaultPassword) setDefaultPassword(true)
        } else {
          onFail()
        }
      })
      .catch(() => onFail())
  }

  const selectProject = useCallback((url) => {
    setRightUrl(url)
    setLogsMode(false)
    setShellMode(false)
    setMobileActive('right')
  }, [])

  if (!config || !authChecked || onboarding === null) return null

  // Show login only if APP_PASSWORD is set (checked server-side) and user not authenticated
  if (!authed) {
    return <LoginPage onLogin={handleLogin} />
  }

  if (onboarding) {
    return <OnboardingPage onComplete={() => { setOnboarding(false); setYepKey(k => k + 1) }} />
  }

  if (isMobile) {
    return (
      <div className="app-root app-root--mobile">
        {config.tunnelUrl && showBanner && window.location.hostname === 'localhost' && (
          <TunnelBanner url={config.tunnelUrl} onDismiss={() => setShowBanner(false)} />
        )}
        {defaultPassword && (
          <div className="weak-password-banner">
            You are using the default password. Update APP_PASSWORD and restart the container.
          </div>
        )}
        <MobileTabBar active={mobileActive} onChange={setMobileActive} />
        <div className="mobile-panel-container">
          <iframe
            key={yepKey}
            src={config.yepUrl}
            className="app-iframe"
            style={{ position: 'absolute', inset: 0, width: '100%', display: mobileActive === 'left' ? 'block' : 'none' }}
            title="YepAnywhere"
          />
          {rightUrl ? (
            <div className="mobile-right-pane" style={{ display: mobileActive === 'right' ? 'flex' : 'none' }}>
              <ProjectBar rightUrl={rightUrl} projects={config.projects} onSwitch={selectProject} />
              <iframe src={rightUrl} style={{ flex: 1, border: 'none' }} title="Right Panel" />
            </div>
          ) : mobileActive === 'right' && (
            <AppPlaceholder style={{ position: 'absolute', inset: 0 }} />
          )}
          {mobileActive === 'logs'  && <ProjectsPanel style={{ position: 'absolute', inset: 0 }} onSelectProject={selectProject} rightUrl={rightUrl} />}
          {mobileActive === 'shell' && <iframe ref={shellIframeRef} src="/shell/" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }} title="Shell" onLoad={focusShell} />}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="app-root"
    >
      {config.tunnelUrl && showBanner && window.location.hostname === 'localhost' && (
        <TunnelBanner url={config.tunnelUrl} onDismiss={() => setShowBanner(false)} />
      )}
      {defaultPassword && (
        <div className="weak-password-banner">
          You are using the default password. Update APP_PASSWORD and restart the container.
        </div>
      )}
      <div className="app-body">
        {splitPct > 0 && (
          <iframe
            key={yepKey}
            src={config.yepUrl}
            style={{ width: `${splitPct}%`, height: '100%', border: 'none' }}
            title="YepAnywhere"
          />
        )}
        <DesktopDivider splitPct={splitPct} onSnap={setSplitPct} onDragStart={onDragStart} logsMode={logsMode} onLogsToggle={() => { setLogsMode(l => !l); setShellMode(false) }} shellMode={shellMode} onShellToggle={() => { setShellMode(s => !s); setLogsMode(false) }} onShowApp={() => { setLogsMode(false); setShellMode(false) }} appActive={!logsMode && !shellMode} />
        {splitPct < 100 && (
          <div className="app-right-pane" style={{ width: `${100 - splitPct}%` }}>
            {logsMode
              ? <ProjectsPanel onSelectProject={selectProject} rightUrl={rightUrl} />
              : shellMode
              ? <iframe ref={shellIframeRef} src="/shell/" className="app-right-iframe" title="Shell" onLoad={focusShell} />
              : rightUrl
                ? <>
                    <ProjectBar rightUrl={rightUrl} projects={config.projects} onSwitch={selectProject} />
                    <iframe src={rightUrl} className="app-right-iframe" title="Right Panel" />
                  </>
                : <AppPlaceholder />
            }
          </div>
        )}
        {dragging && (
          <div
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            className="app-drag-overlay"
          />
        )}
      </div>
    </div>
  )
}
