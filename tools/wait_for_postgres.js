#!/usr/bin/env node
const { Pool } = require("pg");

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://brimble:brimble@localhost:5432/brimble_dev";
const maxAttempts = 30;
const delayMs = 1000;

let attempt = 0;
const pool = new Pool({ connectionString: DATABASE_URL });

async function wait() {
  while (attempt < maxAttempts) {
    try {
      attempt++;
      await pool.query("SELECT 1");
      console.log("Postgres is available");
      await pool.end();
      process.exit(0);
    } catch (err) {
      console.log(`Postgres not ready (attempt ${attempt}/${maxAttempts})...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  console.error("Postgres did not become ready in time");
  await pool.end().catch(() => {});
  process.exit(1);
}

wait();
