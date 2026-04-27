# Brimble Monorepo

This repository contains two workspaces: `brimble-backend` and `brimble-client`.

This README explains how to run the system for local development and how to run it via Docker Compose.

Quick reference

- Install dependencies: `yarn install`
- Start development (both workspaces): `yarn dev`
- Start local DB: `yarn dev:db`
- Start everything with Docker Compose: `docker compose up -d`

Local development (recommended)

- Install dependencies and bootstrap workspaces (root):

```bash
yarn install
```
Starting the deployer locally (non-Docker)

Run the deployer from the repo root (starts the dev deployer on port 5100):

```bash
# shorthand
yarn start:deployer

# explicit (equivalent)
yarn run start:deployer
```
- Start frontend + backend dev servers in parallel (but foir now the backend src are empty ):

```bash
yarn dev
```

- You can also run workspace-level scripts directly:

```bash
# backend dev
cd brimble-backend && yarn start:dev
# client dev (Vite)
cd brimble-client && yarn dev
```

Postgres for local development

- Start a local Postgres instance with Docker Compose:

```bash
yarn dev:db
```

- Create a `.env` file at the repo root (example):

```
DATABASE_URL=postgres://brimble:brimble@localhost:5432/brimble_dev
```

- Wait for the DB and run migrations:

```bash
yarn wait:db
yarn migrate
```

Running the full system with Docker Compose

The repository includes `docker-compose.yml` to run a dev environment with Postgres, a `dev` container (which runs the workspaces in dev mode), the `deployer` service, and `caddy`.

Prerequisites:

- Docker (Engine / Desktop) and Docker Compose

Bring everything up:

```bash
docker compose up -d
# run migrations (from the dev container)
docker compose exec dev yarn wait:db || true
docker compose exec dev yarn migrate
```

Notes about what runs where

- `dev` container: bind-mounts the repo and runs `yarn dev` — use this for iterative frontend/backend work. File edits are visible immediately in the dev server.
- `deployer` service: runs the deployer API. It also needs access to Docker (the compose uses the Docker socket) so it can build/run deployment images.
- `caddy`: reverse-proxy for dev and deployed apps (listens on port 80).

When code changes take effect

- If a service uses a bind/volume mount (like `dev`), code edits appear immediately and you usually don't need to rebuild images. You may need to restart the process inside the container if the app doesn't hot-reload.
- If a service is backed by a built image (deployer-created app images), you must rebuild the image and recreate the container for changes to appear. Use `docker compose up -d --build` or re-trigger the deployer pipeline.



This will source `./.env` (if present) and run the deployer dev server on `http://localhost:5100`.

Rebuilding containers after code changes

- Rebuild all containers and recreate them:

```bash
docker compose up -d --build
```

- Rebuild and recreate a single service (e.g., `deployer`):

```bash
docker compose up -d --no-deps --build deployer
```

Troubleshooting

- If you see `appendLog failed, continuing without persistence: timeout exceeded when trying to connect`, it means the deployer could not acquire a DB connection within the configured timeout. Possible fixes:
  - Ensure Postgres is healthy: `docker compose logs db --tail=200`
  - Increase timeouts / pool size for the deployer in `docker-compose.yml` by setting `PG_CONN_TIMEOUT_MS`, `PG_IDLE_MS`, `PG_POOL_MAX` and restart deployer.
  - From the deployer container test DB connectivity:

```bash
docker compose exec deployer sh -lc 'node -e "const { Pool } = require(\'pg\'); (async()=>{const p=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:20000}); try{const c=await p.connect(); console.log(\'ok\'); c.release(); }catch(e){console.error(e.message||e);} process.exit();})()"'
```

- If `docker compose up` warns that `version` is obsolete in `docker-compose.yml`, you can safely remove the `version:` line — Compose ignores it.

Security notes

- The `deployer` service mounts the host Docker socket by default so it can build and run containers. This is convenient for local dev but carries security risks — never expose this setup in untrusted environments.

Deployer API quick endpoints

- Trigger a deployment (POST form or git URL): `POST /api/deployments` (to port 5100)
- Stream logs: `GET /api/deployments/:id/logs` (SSE)
- Copyable logs: `GET /api/deployments/:id/logs.txt`
- Stop a deployment: `POST /api/deployments/:id/stop` (returns immediately; stop runs in background)
- Status/badge: `GET /api/deployments/:id/status` and `GET /api/deployments/:id/badge.svg`

If you'd like, I can also add a short `CONTRIBUTING.md` with the most common developer workflows (deploy -> test -> stop) and recommended env settings.

---

Updated: concise local and Docker run instructions.
