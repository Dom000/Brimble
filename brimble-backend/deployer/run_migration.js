const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function main() {
  const migPath = path.join(
    __dirname,
    'migrations',
    '0001_add_deployments_created_at_index.sql',
  );
  if (!fs.existsSync(migPath)) {
    console.error('migration file not found:', migPath);
    process.exit(2);
  }
  const sql = fs.readFileSync(migPath, 'utf8');

  const connectionString =
    process.env.DATABASE_URL ||
    (() => {
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
    return false;
  })();

  const client = new Client(
    sslOption ? { connectionString, ssl: sslOption } : { connectionString },
  );

  try {
    await client.connect();
    console.log('Connected to database, applying migration...');
    await client.query(sql);
    console.log('Migration applied successfully.');
    await client.end();
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    try {
      await client.end();
    } catch (e) {}
    process.exit(1);
  }
}

main();
