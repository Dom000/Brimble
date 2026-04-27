import React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

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
        <div className="w-2/5 mb-8">
          <div className="card">
            <h2 className="text-lg font-semibold mb-3">Create Deployment</h2>
            <CreateForm />
          </div>
        </div>
        <div className="md:col-span-2 card">
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
  const { data: list = [], isLoading } = useQuery({
    queryKey: ['deployments', 50],
    queryFn: async () => {
      const res = await fetch('http://localhost:5100/api/deployments?limit=50')
      if (!res.ok) throw new Error(`Failed to fetch deployments: ${res.status}`)
      const data = await res.json()
      return Array.isArray(data) ? data : (data?.rows ?? [])
    },
    refetchInterval: 7000,
  })

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
      {isLoading && (
        <div className="text-sm text-slate-500">Loading deployments…</div>
      )}
      <div className="space-y-4">
        {Object.keys(projects).length === 0 && (
          <div className="text-sm text-slate-500">No deployments yet</div>
        )}
        {Object.entries(projects).map(([proj, deployments]) => (
          <div key={proj} className="border rounded p-3">
            <div className="font-semibold">{proj}</div>
            <div className="mt-2 space-y-2">
              {deployments.map((d) => (
                <DeploymentListItem key={d.id} d={d} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DeploymentListItem({ d }: { d: any }) {
  const [isStopping, setIsStopping] = React.useState(false)

  return (
    <div className="card">
      <div className="flex justify-between items-start">
        <div>
          <Link
            to="/deployments/$id"
            params={{ id: d.id }}
            className="font-medium underline"
          >
            {d.id}
          </Link>
          <div className="text-sm muted">{d.git_url || 'uploaded'}</div>
        </div>
        <div className="text-right">
          <div className="text-sm">
            {(() => {
              const s = String(d.status || 'unknown').toLowerCase()
              const cls =
                s === 'running'
                  ? 'bg-green-500 text-white'
                  : s === 'building' || s === 'deploying' || s === 'pending'
                    ? 'bg-yellow-400 text-black'
                    : s === 'failed' || s === 'stopped'
                      ? 'bg-red-500 text-white'
                      : 'bg-gray-400 text-white'
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
      <div className="mt-2 text-sm">
        <Link
          to="/deployments/$id"
          params={{ id: d.id }}
          className="text-blue-600 underline"
        >
          View deployment details
        </Link>
      </div>
    </div>
  )
}
