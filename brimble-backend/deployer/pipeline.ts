const { EventEmitter } = require('events');
import { EventEmitter as EventEmitterType } from 'events';
import { ChildProcess } from 'child_process';
const { updateDeployment, appendLog } = require('./db');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Track running child processes and container names per deployment so we can
// stop them on demand.
const activeMap = new Map();

export async function runPipeline(
  id: string,
  opts: { gitUrl?: string; uploadPath?: string },
  emitter: EventEmitterType,
) {
  try {
    emitter.emit('log', `Starting pipeline for ${id}`);
    await updateDeployment(id, { status: 'building' });
    await appendLog(id, 'building started');

    const imageTag = `brimble/${id}:latest`;
    const containerName = `brimble_${id}`;

    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), `brimble-${id}-`));
    activeMap.set(id, { procs: new Set<ChildProcess>() } as {
      procs: Set<ChildProcess>;
      container?: string;
      stopped?: boolean;
    });

    if (opts.gitUrl) {
      emitter.emit('log', `Cloning ${opts.gitUrl}...`);
      await appendLog(id, `Cloning ${opts.gitUrl}`);
      await runCmd(
        'git',
        ['clone', '--depth', '1', opts.gitUrl, workdir],
        emitter,
        id,
      );
    } else if (opts.uploadPath) {
      emitter.emit('log', `Using uploaded project at ${opts.uploadPath}`);
      await appendLog(id, `Using uploaded project at ${opts.uploadPath}`);
      try {
        fs.copyFileSync(
          opts.uploadPath,
          path.join(workdir, path.basename(opts.uploadPath)),
        );
      } catch (e) {
        // ignore copy errors for now
      }
    } else {
      throw new Error('no source provided');
    }

    const railpackCmd = process.env.RAILPACK_BIN || 'railpack';
    emitter.emit('log', `Running railpack build in ${workdir}`);
    await appendLog(id, `railpack build start`);
    await runCmd(railpackCmd, ['build', '-t', imageTag], emitter, id, {
      cwd: workdir,
    });
    await appendLog(id, `railpack build finished`);

    updateDeployment(id, { status: 'deploying', image_tag: imageTag });
    emitter.emit('log', `Running docker image ${imageTag}`);
    await appendLog(id, `running image ${imageTag}`);

    const hostPort = 30000 + (hash(id) % 10000);
    // attempt to remove any existing container; redirect stderr so "No such
    // container" messages don't spam logs when none exists
    await runCmd(
      'sh',
      ['-c', `docker rm -f ${containerName} 2>/dev/null || true`],
      emitter,
      id,
    ).catch(() => {});
    // run container and capture the container id output so stop can remove
    // it reliably by id (docker run -d prints the container id on success)
    const containerRunOut = await runCmdOutput(
      'docker',
      [
        'run',
        '-d',
        '--name',
        containerName,
        '-p',
        `${hostPort}:8080`,
        imageTag,
      ],
      emitter,
      id,
    );
    const containerId = (containerRunOut || '').trim();
    // record the container id if available, otherwise fall back to name
    const info = activeMap.get(id) || { procs: new Set() };
    info.container = containerId || containerName;
    activeMap.set(id, info);

    const url = `http://localhost:${hostPort}`;
    await updateDeployment(id, { status: 'running', url });
    await appendLog(id, `running at ${url}`);
    emitter.emit('log', `Deployment ${id} running at ${url}`);

    // write caddy snippet and reload
    try {
      const repoRoot = path.resolve(__dirname, '../../');
      const caddyDir = path.join(repoRoot, 'Caddyfile.d');
      if (!fs.existsSync(caddyDir)) fs.mkdirSync(caddyDir, { recursive: true });
      const snippet = `route /apps/${id}/* {\n  uri strip_prefix /apps/${id}\n  reverse_proxy 127.0.0.1:${hostPort}\n}\n`;
      fs.writeFileSync(path.join(caddyDir, `${id}.caddy`), snippet);
      await runCmd('caddy', ['reload'], emitter, id).catch(async (e) => {
        emitter.emit(
          'log',
          `caddy reload failed: ${String(e)}; attempting docker exec fallback`,
        );
        // Try to reload Caddy inside the caddy container by finding a container
        // whose name contains 'caddy' and running `caddy reload` there. This
        // uses the docker CLI which should be available in the dev/deployer
        // container when using the docker-socket approach.
        await runCmd(
          'sh',
          [
            '-c',
            "docker exec $(docker ps -q -f name=caddy) caddy reload || echo 'docker exec caddy reload failed'",
          ],
          emitter,
          id,
        ).catch((e2) =>
          emitter.emit('log', `docker exec caddy reload failed: ${String(e2)}`),
        );
      });
      await appendLog(id, `caddy updated -> /apps/${id}`);
    } catch (e: any) {
      emitter.emit('log', `Failed to update Caddy: ${String(e)}`);
    }

    return { imageTag, url };
  } catch (err: any) {
    await updateDeployment(id, { status: 'failed' });
    await appendLog(id, `error: ${String(err)}`);
    emitter.emit('log', `pipeline failed: ${String(err)}`);
    throw err;
  }
}

function runCmd(
  cmd: string,
  args: string[],
  emitter: EventEmitterType,
  id: string,
  opts: any = {},
) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    const info = activeMap.get(id);
    if (info) info.procs.add(p);
    p.stdout.on('data', (d) => {
      const s = d.toString();
      emitter.emit('log', s);
      appendLog(id, s).catch(() => {});
    });
    p.stderr.on('data', (d) => {
      const s = d.toString();
      emitter.emit('log', s);
      appendLog(id, s).catch(() => {});
    });
    p.on('error', (err) => reject(err));
    p.on('close', (code) => {
      const info = activeMap.get(id);
      if (info) info.procs.delete(p);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}`));
    });
  });
}

// Run a command and capture stdout (returns trimmed stdout). Useful for
// commands where we need the output (e.g., container id from `docker ps`).
function runCmdOutput(
  cmd: string,
  args: string[],
  emitter: EventEmitterType,
  id: string,
  opts: any = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    const info = activeMap.get(id);
    if (info) info.procs.add(p);
    let out = '';
    p.stdout.on('data', (d) => {
      const s = d.toString();
      out += s;
      emitter.emit('log', s);
      appendLog(id, s).catch(() => {});
    });
    p.stderr.on('data', (d) => {
      const s = d.toString();
      emitter.emit('log', s);
      appendLog(id, s).catch(() => {});
    });
    p.on('error', (err) => reject(err));
    p.on('close', (code) => {
      const info = activeMap.get(id);
      if (info) info.procs.delete(p);
      if (code === 0) resolve(out.trim());
      else reject(new Error(`${cmd} exited ${code}`));
    });
  });
}

async function stopDeployment(id: string, emitter: EventEmitterType) {
  const info = activeMap.get(id) as
    | { procs: Set<ChildProcess>; container?: string; stopped?: boolean }
    | undefined;
  emitter.emit('log', 'Stopping deployment...');

  // If we have an in-memory active entry, mark stopped and kill child procs
  if (info) {
    info.stopped = true;
    // kill child procs
    for (const p of Array.from(info.procs)) {
      try {
        p.kill('SIGTERM');
      } catch (e) {}
    }
  }

  // Helper: attempt to remove a container id or name
  async function tryRemoveContainer(ident: string | undefined) {
    if (!ident) return false;
    try {
      await runCmd(
        'sh',
        ['-c', `docker rm -f ${ident} 2>/dev/null || true`],
        emitter,
        id,
      ).catch(() => {});
      return true;
    } catch (e) {
      return false;
    }
  }

  // First try removal using stored container id/name (if present)
  let removed = false;
  if (info && info.container) {
    removed = await tryRemoveContainer(info.container).catch(() => false);
  }

  // If not removed, try to discover the container via docker ps filters
  if (!removed) {
    try {
      // look for containers with name matching brimble_<id>
      const byName = await runCmdOutput(
        'sh',
        ['-c', `docker ps -q -f name=brimble_${id}`],
        emitter,
        id,
      ).catch(() => '');
      const candidate = (byName || '')
        .split('\n')
        .map((s) => s.trim())
        .find(Boolean);
      if (candidate) {
        removed = await tryRemoveContainer(candidate).catch(() => false);
      }
      // if still not found, try matching by image (brimble/<id>:latest)
      if (!removed) {
        const byImage = await runCmdOutput(
          'sh',
          ['-c', `docker ps -q -f ancestor=brimble/${id}:latest`],
          emitter,
          id,
        ).catch(() => '');
        const cand2 = (byImage || '')
          .split('\n')
          .map((s) => s.trim())
          .find(Boolean);
        if (cand2) removed = await tryRemoveContainer(cand2).catch(() => false);
      }
    } catch (e) {
      // ignore discovery errors
    }
  }

  await updateDeployment(id, { status: 'stopped' }).catch(() => {});
  appendLog(id, 'stopped by user').catch(() => {});
  emitter.emit(
    'log',
    removed
      ? 'stopped by user'
      : 'stop requested (container may not have been running)',
  );
  if (info) activeMap.delete(id);
}

module.exports.stopDeployment = stopDeployment;

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return Math.abs(h);
}
