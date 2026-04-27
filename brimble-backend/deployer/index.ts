try {
  require('dotenv').config();
} catch (e) {}

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { v4: uuid } = require('uuid');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const EventEmitterType = EventEmitter;
type EventEmitterType = InstanceType<typeof EventEmitter>;
const {
  insertDeployment,
  listDeployments,
  countDeployments,
  getDeployment,
  readLogs,
  appendLog,
} = require('./db');
const { runPipeline } = require('./pipeline');
const { stopDeployment } = require('./pipeline');

const app = express();
app.use(cors());
app.use(express.json());

const uploadDir = path.join(process.cwd(), 'deployer', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

const emitters = new Map<string, EventEmitterType>();

app.get('/api/deployments', async (req, res) => {
  const rawLimit = String(req.query.limit || '50');
  const rawOffset = String(req.query.offset || '0');
  const includeTotal = String(req.query.includeTotal || '0') === '1';
  let limit = 50;
  let offset = 0;
  const l = parseInt(rawLimit, 10);
  const o = parseInt(rawOffset, 10);
  if (!Number.isNaN(l) && l > 0 && l <= 1000) limit = l;
  if (!Number.isNaN(o) && o >= 0) offset = o;

  if (includeTotal) {
    const start = Date.now();
    const listStart = Date.now();
    const listPromise = listDeployments(limit, offset).then((rows: any[]) => {
      res.setHeader('X-List-Time-Ms', String(Date.now() - listStart));
      return rows;
    });

    const countStart = Date.now();
    const countPromise = countDeployments()
      .then((total: number) => {
        res.setHeader('X-Count-Time-Ms', String(Date.now() - countStart));
        return total;
      })
      .catch((e: any) => {
        console.error('count failed', e);
        return null;
      });

    const [rows, total] = await Promise.all([listPromise, countPromise]);
    const dbTime = Date.now() - start;
    console.log(
      `GET /api/deployments limit=${limit} offset=${offset} db_ms=${dbTime} includeTotal=1`,
    );
    res.setHeader('X-DB-Time-Ms', String(dbTime));
    return res.json({ rows, total });
  }

  const start = Date.now();
  const rows = await listDeployments(limit, offset);
  const dbTime = Date.now() - start;
  console.log(
    `GET /api/deployments limit=${limit} offset=${offset} db_ms=${dbTime}`,
  );
  res.setHeader('X-DB-Time-Ms', String(dbTime));

  // Backwards-compatible: return array when total not requested.
  return res.json(rows);
});

app.get('/api/deployments/:id', async (req, res) => {
  const d = await getDeployment(req.params.id);
  if (!d) return res.status(404).json({ error: 'not found' });
  res.json(d);
});

app.post(
  '/api/deployments',
  upload.single('project'),
  async (req: any, res) => {
    const gitUrl = req.body.gitUrl || undefined;
    const uploaded = req.file;
    const id = uuid();
    const now = Date.now();
    await insertDeployment({
      id,
      created_at: now,
      git_url: gitUrl,
      status: 'pending',
    });

    const emitter = new EventEmitter();
    emitters.set(id, emitter);

    res.status(201).json({ id });

    const opts: any = {};
    if (gitUrl) opts.gitUrl = gitUrl;
    if (uploaded) opts.uploadPath = uploaded.path;

    // start pipeline but don't await
    //  runPipeline(id, opts, emitter).catch((err) =>
    //   console.error('pipeline error', err.message || err),
    // );
    runPipeline(id, opts, emitter).catch((err) =>
      console.error('pipeline error', err),
    );
  },
);

app.get('/api/deployments/:id/logs', async (req, res) => {
  const id = req.params.id;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const emitter = emitters.get(id) || new EventEmitter();
  const send = (msg: string, persist = true) => {
    if (persist) appendLog(id, msg);
    res.write(`data: ${JSON.stringify({ ts: Date.now(), message: msg })}\n\n`);
  };

  // replay recent logs
  const past = await readLogs(id, 0);
  for (const p of past) send(p.message, false);

  const onLog = (m: any) => send(String(m), true);
  emitter.on('log', onLog);

  req.on('close', () => {
    emitter.off('log', onLog);
  });
});

// Plain-text logs download (copyable)
app.get('/api/deployments/:id/logs.txt', async (req, res) => {
  const id = req.params.id;
  const past = await readLogs(id, 0);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${id}-deployer.log"`,
  );
  for (const p of past) {
    const rawTs = Number(p?.ts);
    const parsedDate = Number.isFinite(rawTs) ? new Date(rawTs) : null;
    const tsIso =
      parsedDate && Number.isFinite(parsedDate.getTime())
        ? parsedDate.toISOString()
        : new Date().toISOString();
    const msg = String(p?.message ?? '').replace(/\n$/, '');
    const line = `[${tsIso}] ${msg}\n`;
    res.write(line);
  }
  res.end();
});

// Status endpoint suitable for Shields.io endpoint badges
// app.get('/api/deployments/:id/status', async (req, res) => {
//   const id = req.params.id;
//   const d = await getDeployment(id);
//   if (!d) return res.status(404).json({ error: 'not found' });
//   // Map deployment status to badge color
//   const status = d.status || 'unknown';
//   let color = 'lightgrey';
//   if (status === 'running') color = 'brightgreen';
//   else if (status === 'building' || status === 'pending') color = 'yellow';
//   else if (status === 'failed' || status === 'stopped') color = 'red';

//   // Shields.io endpoint expects: { schemaVersion, label, message, color }
//   res.json({ schemaVersion: 1, label: 'deploy', message: status, color });
// });

app.post('/api/deployments/:id/stop', async (req, res) => {
  const id = req.params.id;
  let emitter = emitters.get(id);
  let transient = false;
  if (!emitter) {
    // No active SSE emitter (maybe server restarted). Create a transient
    // emitter so we can still attempt to stop any running container.
    emitter = new EventEmitter();
    transient = true;
  }
  try {
    stopDeployment(id, emitter).catch((e: any) =>
      console.error('stopDeployment failed', e),
    );
    res.json({ ok: true, transient });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const PORT = parseInt(process.env.PORT || '5100');
app.listen(PORT, () =>
  console.log(`Deployer API running on http://localhost:${PORT}`),
);
