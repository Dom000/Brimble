const { Client } = require("pg");

(async function () {
  const connectionString =
    process.env.DATABASE_URL ||
    (() => {
      const user = process.env.DATABASE_USER || "postgres";
      const password = process.env.DATABASE_PASSWORD || "";
      const host = process.env.DATABASE_HOST || "localhost";
      const port = process.env.DATABASE_PORT || "5432";
      const db = process.env.DATABASE_NAME || "brimble";
      const auth = password
        ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}@`
        : `${encodeURIComponent(user)}@`;
      return `postgres://${auth}${host}:${port}/${db}`;
    })();

  const sslOption = (() => {
    if (process.env.PG_SSL && process.env.PG_SSL !== "false") {
      const rejectUnauthorized = process.env.PG_SSL_REJECT_UNAUTHORIZED
        ? process.env.PG_SSL_REJECT_UNAUTHORIZED !== "false"
        : true;
      const caEnv = process.env.PG_SSL_CA;
      const ca = caEnv ? caEnv.replace(/\\n/g, "\n") : undefined;
      return { rejectUnauthorized, ca };
    }
    return false;
  })();

  const client = new Client(
    sslOption ? { connectionString, ssl: sslOption } : { connectionString },
  );

  try {
    await client.connect();
    console.log("Connected to DB");
    const idx = await client.query(
      "SELECT indexname, indexdef FROM pg_indexes WHERE tablename='deployments'",
    );
    console.log("indexes:", idx.rows);

    const q =
      "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT * FROM deployments ORDER BY created_at DESC LIMIT 50 OFFSET 0";
    const r = await client.query(q);
    console.log("EXPLAIN:");
    for (const row of r.rows) console.log(row["QUERY PLAN"]);

    await client.end();
    process.exit(0);
  } catch (e) {
    console.error("err", e);
    try {
      await client.end();
    } catch {}
    process.exit(1);
  }
})();
