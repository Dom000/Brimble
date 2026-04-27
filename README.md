# Brimble Monorepo

Workspaces: `brimble-backend`, `brimble-client`.

Commands (run from repository root):

- Install dependencies and bootstrap workspaces:

```bash
yarn install
```

- Start both projects for development (runs in parallel using Turbo):

```bash
yarn dev
```

- Run build across workspaces:

```bash
yarn build
```

You can still navigate into each workspace and run its scripts individually, for example:

```bash
# In backend
cd brimble-backend && yarn start:dev
# In client
cd brimble-client && yarn dev
```

## Local Postgres for development

To run a fast, local Postgres (recommended for development so logs persist reliably):

- Start Postgres via Docker Compose:

```bash
yarn dev:db
```

- Create a `.env` file at the repository root (example):

```
DATABASE_URL=postgres://brimble:brimble@localhost:5432/brimble_dev
```

- Wait for the DB to be ready, then run migrations:

```bash
yarn wait:db
yarn migrate
```

- Stop the local DB when finished:

```bash
docker compose down
```

When using the local DB you don't need Aiven TLS overrides; remove any `PG_SSL_REJECT_UNAUTHORIZED` overrides from your shell.

## Bring up the whole system with Docker Compose (recommended)

This repository includes a `docker-compose.yml` that will start a local Postgres, a development container that runs the frontend and backend dev servers, and a Caddy reverse proxy. On a clean machine with Docker and Docker Compose installed you can bring everything up with one command.

Prerequisites:

- Docker Engine and Docker Compose (or Docker Desktop) installed.
- Optional: increase Docker resources if you plan to build images with `railpack`.

Quick start (single command):

```bash
# start containers in background
docker compose up -d

# wait until Postgres is ready, then run migrations from the dev container
docker compose exec dev yarn wait:db || true
docker compose exec dev yarn migrate
```

The `dev` container uses the repository source (bind-mounted) and runs `yarn dev` which starts both the backend and frontend dev servers. `Caddy` will listen on port 80 and proxy to the right dev ports so you can open http://localhost in your browser.

Environment variables and sensible defaults:

- `DATABASE_URL` — defaults to `postgres://brimble:brimble@db:5432/brimble_dev` when running under Docker Compose.
- `RAILPACK_BIN` — defaults to `/workspace/tools/railpack` (a lightweight stub is provided in `tools/railpack`).
- `CADDY_SNIPPETS_DIR` — defaults to `Caddyfile.d` in the repository root.

If you want to stop everything:

```bash
docker compose down
```
