// Load local .env automatically so `yarn workspace ... run deployer:dev` works
// without the caller having to `set -a && . ./.env`.
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

  const start = Date.now();
  const rows = await listDeployments(limit, offset);
  const dbTime = Date.now() - start;
  // log timing for diagnosis
  console.log(
    `GET /api/deployments limit=${limit} offset=${offset} db_ms=${dbTime}`,
  );
  res.setHeader('X-DB-Time-Ms', String(dbTime));

  if (includeTotal) {
    let total = null;
    try {
      const tstart = Date.now();
      total = await require('./db').countDeployments();
      const tdb = Date.now() - tstart;
      console.log(`countDeployments db_ms=${tdb}`);
      res.setHeader('X-Count-Time-Ms', String(tdb));
    } catch (e) {
      console.error('count failed', e);
    }
    return res.json({ rows, total });
  }

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
  const send = (msg: string) => {
    appendLog(id, msg);
    res.write(`data: ${JSON.stringify({ ts: Date.now(), message: msg })}\n\n`);
  };

  // replay recent logs
  const past = await readLogs(id, 0);
  for (const p of past) send(p.message);

  const onLog = (m: any) => send(String(m));
  emitter.on('log', onLog);

  req.on('close', () => {
    emitter.off('log', onLog);
  });
});

app.post('/api/deployments/:id/stop', async (req, res) => {
  const id = req.params.id;
  const emitter = emitters.get(id);
  if (!emitter)
    return res.status(404).json({ error: 'not found or not running' });
  try {
    await stopDeployment(id, emitter);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const PORT = parseInt(process.env.PORT || '5100');
app.listen(PORT, () =>
  console.log(`Deployer API running on http://localhost:${PORT}`),
);
