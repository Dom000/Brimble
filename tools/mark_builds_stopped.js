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
    const r = await client.query(
      "UPDATE deployments SET status='stopped' WHERE status='building'",
    );
    console.log("updated rows", r.rowCount);
    await client.end();
  } catch (e) {
    console.error("err", e);
    try {
      await client.end();
    } catch {}
    process.exit(1);
  }
})();
