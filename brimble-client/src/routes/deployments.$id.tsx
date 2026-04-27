import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

export const Route = createFileRoute('/deployments/$id')({
  component: DeploymentDetailsPage,
})

function DeploymentDetailsPage() {
  const { id } = Route.useParams()

  const { data: deployment, isLoading: loadingDeployment } = useQuery({
    queryKey: ['deployment', id],
    queryFn: async () => {
      const res = await fetch(`http://localhost:5100/api/deployments/${id}`)
      if (!res.ok) throw new Error(`Failed to fetch deployment: ${res.status}`)
      return res.json()
    },
    refetchInterval: 7000,
  })

  const { data: logs = [], isLoading: loadingLogs } = useQuery({
    queryKey: ['deployment-logs', id],
    queryFn: async () => {
      const res = await fetch(
        `http://localhost:5100/api/deployments/${id}/logs.txt`,
      )
      if (!res.ok) throw new Error(`Failed to fetch logs: ${res.status}`)
      const text = await res.text()
      return text
        .split('\n')
        .map((line) => line.trimEnd())
        .filter(Boolean)
    },
    refetchInterval: 5000,
  })

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
    <div className="p-6 app-root">
      <div className="px-10 md:px-20">
        <div className="mb-4">
          <Link to="/" className="text-blue-600 underline">
            ← Back to deployments
          </Link>
        </div>

        <div className="card mb-4">
          <h2 className="text-xl font-semibold mb-2">Deployment Details</h2>
          {loadingDeployment ? (
            <div className="text-sm text-slate-500">Loading deployment…</div>
          ) : deployment ? (
            <div className="space-y-1 text-sm">
              <div>
                <strong>ID:</strong> {deployment.id}
              </div>
              <div>
                <strong>Status:</strong> {deployment.status}
              </div>
              <div>
                <strong>Source:</strong> {deployment.git_url || 'uploaded'}
              </div>
              <div>
                <strong>URL:</strong>{' '}
                {deployment.url ? (
                  <a href={deployment.url}>{deployment.url}</a>
                ) : (
                  '—'
                )}
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-500">Deployment not found</div>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold">Logs</h3>
            <span className="text-sm muted">Count: {logs.length}</span>
          </div>
          {loadingLogs ? (
            <div className="text-sm text-slate-500">Loading logs…</div>
          ) : (
            <div className="max-h-[60vh] overflow-auto p-2 mt-2 bg-black/5 dark:bg-black/40 rounded">
              <div className="text-xs">
                {logs.map((ln, i) => renderLine(ln, i))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
