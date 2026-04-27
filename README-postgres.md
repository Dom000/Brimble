Postgres setup for Brimble monorepo

1. Install Postgres (Homebrew):

```bash
brew install postgresql
```

2. Start Postgres (Homebrew service):

```bash
brew services start postgresql
```

3. Create database and user (local dev). You can either set `DATABASE_URL`
   or use the individual env vars below.

```bash
createdb brimble
# optional: create a user and password
# psql -c "CREATE USER brimble WITH PASSWORD 'password';"
# psql -c "GRANT ALL PRIVILEGES ON DATABASE brimble TO brimble;"
```

4. Set environment variables (choose one approach):

Option A - single `DATABASE_URL`:

```bash
export DATABASE_URL=postgres://postgres@localhost:5432/brimble
```

Option B - individual vars (useful to change DB name without rewriting URL):

```bash
export DATABASE_HOST=localhost
export DATABASE_PORT=5432
export DATABASE_USER=postgres
export DATABASE_PASSWORD=        # optional
export DATABASE_NAME=brimble
```

SSL / Aiven notes:

- If you connect to a managed DB (Aiven, RDS) the client should use SSL. The deployer will enable SSL automatically when the DB host is not `localhost`, but you can control behavior via these env vars:

```bash
# enable SSL explicitly (true/false). If omitted, SSL is enabled for non-local hosts
export PG_SSL=true
# allow self-signed certs (dev only). Default is 'true' (reject unauthorized). Set to 'false' to accept.
export PG_SSL_REJECT_UNAUTHORIZED=false
# if you have a CA pem, set it here (newline-escaped or path-dereferenced). Optional.
export PG_SSL_CA="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
```

Be careful: setting `PG_SSL_REJECT_UNAUTHORIZED=false` disables certificate validation and is only appropriate for development or testing.

5. Then install deps and run the services:

```bash
yarn install
yarn workspace brimble-backend run deployer:dev
yarn workspace brimble-client dev
```

If you prefer not to install Postgres, tell me and I'll convert the project to an in-process JS SQLite (sql.js) instead.
