import { Pool } from 'pg';

const connectionString = (() => {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const user = process.env.DATABASE_USER || 'postgres';
  const password = process.env.DATABASE_PASSWORD || '';
  const host = process.env.DATABASE_HOST || 'localhost';
  const port = process.env.DATABASE_PORT || '5432';
  const db = process.env.DATABASE_NAME || 'brimble';
  const auth = password
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}@`
    : `${encodeURIComponent(user)}@`;
  return `postgres://${auth}${host}:${port}/${db}`;
})();

const sslOption = (() => {
  if (process.env.PG_SSL && process.env.PG_SSL !== 'false') {
    const rejectUnauthorized = process.env.PG_SSL_REJECT_UNAUTHORIZED
      ? process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false'
      : true;
    const caEnv = process.env.PG_SSL_CA;
    const ca = caEnv ? caEnv.replace(/\\n/g, '\n') : undefined;
    return { rejectUnauthorized, ca };
  }
  return undefined;
})();

// For development: if the user explicitly disables SSL verification, set the
// Node-wide TLS flag so the underlying driver won't reject self-signed chains.
if (
  process.env.PG_SSL &&
  process.env.PG_SSL !== 'false' &&
  process.env.PG_SSL_REJECT_UNAUTHORIZED === 'false'
) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

// Configure pool with sensible defaults and keep-alive to avoid per-request
// connection handshakes which can be expensive for remote DBs. Increase the
// default connection timeout to be more tolerant of slow or cold DBs and
// allow tuning via environment variables.
const pool = new Pool(
  sslOption
    ? {
        connectionString,
        ssl: sslOption as any,
        max: parseInt(process.env.PG_POOL_MAX || '10', 10),
        idleTimeoutMillis: parseInt(process.env.PG_IDLE_MS || '120000', 10),
        connectionTimeoutMillis: parseInt(
          process.env.PG_CONN_TIMEOUT_MS || '30000',
          10,
        ),
      }
    : {
        connectionString,
        max: parseInt(process.env.PG_POOL_MAX || '10', 10),
        idleTimeoutMillis: parseInt(process.env.PG_IDLE_MS || '120000', 10),
        connectionTimeoutMillis: parseInt(
          process.env.PG_CONN_TIMEOUT_MS || '30000',
          10,
        ),
      },
);

// Log and surface unexpected pool errors instead of letting them crash the
// process silently. These are generally non-fatal and indicate connectivity
// problems with the Postgres server.
pool.on('error', (err: Error) => {
  console.error('pg pool error', err?.message || err);
});

// Helper: run a query with retries/backoff for transient connection issues.
async function queryWithRetry(sql: string, params: any[] = [], maxRetries = 3) {
  let attempt = 0;
  while (true) {
    try {
      return await pool.query(sql, params);
    } catch (e: any) {
      attempt++;
      const msg = e?.message || String(e);
      // If it's a connection timeout or transient network error, retry.
      if (
        attempt < maxRetries &&
        /timeout exceeded when trying to connect|ECONNRESET|ENETUNREACH|connect timed out/i.test(
          msg,
        )
      ) {
        console.warn(`query attempt ${attempt} failed: ${msg}; retrying`);
        await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt)));
        continue;
      }
      // otherwise rethrow
      throw e;
    }
  }
}

// Warm up one connection at startup to reduce first-request latency.
(async function warmPool() {
  try {
    const c = await pool.connect();
    c.release();
    console.log('pg pool warmed');
  } catch (e: any) {
    console.warn('pg pool warm failed', e?.message ?? e);
  }
})();

async function ensureSchema() {
  await queryWithRetry(`
    CREATE TABLE IF NOT EXISTS deployments (
      id TEXT PRIMARY KEY,
      created_at BIGINT,
      git_url TEXT,
      status TEXT,
      image_tag TEXT,
      url TEXT
    );
  `);
  // index to speed up queries ordering by created_at (most recent first)
  await queryWithRetry(
    `CREATE INDEX IF NOT EXISTS idx_deployments_created_at ON deployments (created_at DESC)`,
  );
  await queryWithRetry(`
    CREATE TABLE IF NOT EXISTS logs (
      id BIGSERIAL PRIMARY KEY,
      deployment_id TEXT REFERENCES deployments(id) ON DELETE CASCADE,
      ts BIGINT,
      message TEXT
    );
  `);
}

ensureSchema().catch((err) => {
  console.error('failed to ensure schema', err);
});

export async function insertDeployment(d: {
  id: string;
  created_at: number;
  git_url?: string;
  status: string;
  image_tag?: string;
  url?: string;
}) {
  await queryWithRetry(
    `INSERT INTO deployments (id, created_at, git_url, status, image_tag, url) VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      d.id,
      d.created_at,
      d.git_url || null,
      d.status,
      d.image_tag || null,
      d.url || null,
    ],
  );
}

export async function updateDeployment(
  id: string,
  patch: Partial<{ status: string; image_tag: string; url: string }>,
) {
  const current = await getDeployment(id);
  if (!current) return null;
  const status = patch.status ?? current.status;
  const image_tag = patch.image_tag ?? current.image_tag;
  const url = patch.url ?? current.url;
  await queryWithRetry(
    `UPDATE deployments SET status=$1, image_tag=$2, url=$3 WHERE id=$4`,
    [status, image_tag, url, id],
  );
  return getDeployment(id);
}

export async function getDeployment(id: string) {
  const r = await queryWithRetry('SELECT * FROM deployments WHERE id = $1', [
    id,
  ]);
  return r.rows[0];
}

export async function listDeployments(limit = 50, offset = 0) {
  // return most recent deployments, limited/offset to avoid large result sets
  const r = await queryWithRetry(
    'SELECT * FROM deployments ORDER BY created_at DESC LIMIT $1 OFFSET $2',
    [limit, offset],
  );
  return r.rows;
}

export async function countDeployments() {
  const r = await queryWithRetry(
    'SELECT COUNT(*)::int AS cnt FROM deployments',
  );
  return r.rows[0]?.cnt ?? 0;
}

export async function appendLog(deployment_id: string, message: string) {
  const ts = Date.now();
  const maxRetries = 3;
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      await pool.query(
        'INSERT INTO logs (deployment_id, ts, message) VALUES ($1,$2,$3)',
        [deployment_id, ts, message],
      );
      return;
    } catch (e: any) {
      attempt++;
      const msg = e?.message || String(e);
      console.warn(`appendLog attempt ${attempt} failed: ${msg}`);
      if (attempt >= maxRetries) {
        console.warn('appendLog failed, continuing without persistence', msg);
        return;
      }
      // exponential backoff before retrying
      await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt)));
    }
  }
}

export async function readLogs(deployment_id: string, after = 0) {
  try {
    const r = await queryWithRetry(
      'SELECT ts, message FROM logs WHERE deployment_id = $1 AND ts > $2 ORDER BY ts ASC',
      [deployment_id, after],
    );
    return r.rows;
  } catch (e) {
    console.warn('readLogs failed, returning empty', e?.message || e);
    return [];
  }
}

export default pool;
