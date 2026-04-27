import React from 'react'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return <App />
}

function App() {
  return (
    <div className="p-6 app-root">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Brimble</h1>
        <ThemeToggle />
      </div>
      <div className=" px-10 md:px-20">
        <div className="w-2/5">
          <div className="card">
            <h2 className="text-lg font-semibold mb-3">Create Deployment</h2>
            <CreateForm />
          </div>
        </div>
        <div className="md:col-span-2">
          <ProjectsList />
        </div>
      </div>
    </div>
  )
}

function ThemeToggle() {
  const [theme, setTheme] = React.useState<string>(() =>
    typeof window !== 'undefined'
      ? window.localStorage.getItem('theme') || 'light'
      : 'light',
  )
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    window.localStorage.setItem('theme', theme)
  }, [theme])
  return (
    <div>
      <button
        onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
        className="px-3 py-1 border rounded"
      >
        {theme === 'light' ? '🌙 Dark' : '☀️ Light'}
      </button>
    </div>
  )
}

function CreateForm() {
  const [gitUrl, setGitUrl] = React.useState('')
  const [file, setFile] = React.useState<File | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  async function submit(e: any) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const fd = new FormData()
      if (gitUrl) fd.append('gitUrl', gitUrl)
      if (file) fd.append('project', file)
      const res = await fetch('http://localhost:5100/api/deployments', {
        method: 'POST',
        body: fd,
      })
      if (res.ok) {
        setGitUrl('')
        setFile(null)
      } else {
        // optionally handle error
        console.error('create deployment failed', res.status)
      }
    } catch (err) {
      console.error('create deployment error', err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="mb-6 space-y-3">
      <div>
        <label className="block text-sm font-medium">Git URL</label>
        <input
          value={gitUrl}
          onChange={(e) => setGitUrl(e.target.value)}
          className="mt-1 block w-full border rounded p-2"
          placeholder="https://github.com/owner/repo.git"
        />
      </div>
      <div>
        <label className="block text-sm font-medium">
          Or upload project (zip)
        </label>
        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <div>
        <button
          className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-60"
          disabled={submitting}
        >
          {submitting ? 'Creating…' : 'Create Deployment'}
        </button>
      </div>
    </form>
  )
}

function ProjectsList() {
  const [list, setList] = React.useState<any[]>([])

  React.useEffect(() => {
    let mounted = true
    const first = { current: true }
    async function load() {
      const qs = first.current ? '?limit=50&includeTotal=1' : '?limit=50'
      const res = await fetch(`http://localhost:5100/api/deployments${qs}`)
      if (!res.ok) return
      const data = await res.json()
      const rows = Array.isArray(data) ? data : (data?.rows ?? [])
      if (mounted) setList(rows)
      first.current = false
    }
    load()
    const t = setInterval(load, 7000)
    return () => {
      mounted = false
      clearInterval(t)
    }
  }, [])

  const projects = React.useMemo(() => {
    const m: Record<string, any[]> = {}
    for (const d of list) {
      let name = 'uploaded'
      if (d.git_url) {
        try {
          const parts = d.git_url.replace(/\.git$/, '').split('/')
          name = parts[parts.length - 1] || d.git_url
        } catch {
          name = d.git_url
        }
      }
      if (!m[name]) m[name] = []
      m[name].push(d)
    }
    for (const k of Object.keys(m)) {
      m[k].sort((a, b) => Number(b.created_at) - Number(a.created_at))
    }
    return m
  }, [list])

  return (
    <div>
      <h2 className="text-xl font-semibold mb-2">Projects</h2>
      <div className="space-y-4">
        {Object.keys(projects).length === 0 && (
          <div className="text-sm text-slate-500">No deployments yet</div>
        )}
        {Object.entries(projects).map(([proj, deployments]) => (
          <div key={proj} className="border rounded p-3">
            <div className="font-semibold">{proj}</div>
            <div className="mt-2 space-y-2">
              {deployments.map((d) => (
                <DeploymentItem key={d.id} d={d} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DeploymentItem({ d }: { d: any }) {
  const [logs, setLogs] = React.useState<string[]>([])
  const [isStopping, setIsStopping] = React.useState(false)

  React.useEffect(() => {
    const es = new EventSource(
      `http://localhost:5100/api/deployments/${d.id}/logs`,
    )
    es.onmessage = (ev) => {
      try {
        const obj = JSON.parse(ev.data)
        setLogs((s) => [
          ...s,
          `${new Date(obj.ts).toLocaleTimeString()}: ${obj.message}`,
        ])
      } catch {}
    }
    return () => es.close()
  }, [d.id])

  function renderLine(line: string, idx: number) {
    const l = line.toLowerCase()
    const cls =
      l.includes('error') || l.includes('failed')
        ? 'log-error'
        : l.includes('warn')
          ? 'log-warn'
          : l.includes('running') ||
              l.includes('finished') ||
              l.includes('complete')
            ? 'log-ok'
            : 'log-info'
    return (
      <span key={idx} className={`log-line ${cls}`}>
        {line}
      </span>
    )
  }

  return (
    <div className="card">
      <div className="flex justify-between items-start">
        <div>
          <div className="font-medium">{d.id}</div>
          <div className="text-sm muted">{d.git_url || 'uploaded'}</div>
        </div>
        <div className="text-right">
          <div className="text-sm">
            {(() => {
              const s = String(d.status || 'unknown').toLowerCase();
              const cls = s === 'running'
                ? 'bg-green-500 text-white'
                : s === 'building' || s === 'deploying' || s === 'pending'
                ? 'bg-yellow-400 text-black'
                : s === 'failed' || s === 'stopped'
                ? 'bg-red-500 text-white'
                : 'bg-gray-400 text-white';
              return (
                <span
                  className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}
                >
                  {d.status}
                </span>
              )
            })()}
          </div>
          <div className="text-sm text-accent">
            {d.url ? <a href={d.url}>{d.url}</a> : null}
          </div>
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        {(d.status === 'building' ||
          d.status === 'deploying' ||
          d.status === 'running') && (
          <button
            className="px-2 py-1 bg-red-600 text-white rounded text-sm"
            onClick={async () => {
              setIsStopping(true)
              await fetch(
                `http://localhost:5100/api/deployments/${d.id}/stop`,
                { method: 'POST' },
              )
              setIsStopping(false)
            }}
            disabled={isStopping}
          >
            {isStopping ? 'Stopping…' : 'Stop'}
          </button>
        )}
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer">Logs ({logs.length})</summary>
        <div className="max-h-64 overflow-auto p-2 mt-2 bg-black/5 dark:bg-black/40 rounded">
          <div className="text-xs">
            {logs.map((ln, i) => renderLine(ln, i))}
          </div>
        </div>
      </details>
    </div>
  )
}
