import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { parse } from "pg-connection-string";

const postgresUrl =
  process.env.POSTGRES_URL ||
  "postgresql://user:pass@localhost:5432/waiver?sslmode=prefer";

const config = parse(postgresUrl);
const host =
  typeof config.host === "string" ? config.host : Array.isArray(config.host) ? config.host[0] || "" : "";

const anyConfig = config;
const sslmode =
  typeof anyConfig.sslmode === "string"
    ? anyConfig.sslmode
    : typeof anyConfig.ssl === "string"
    ? anyConfig.ssl
    : "prefer";

let ssl = undefined;
if (sslmode && String(sslmode) !== "disable" && String(sslmode) !== "prefer") {
  if (host.includes("aivencloud.com") || String(sslmode) === "require") {
    ssl = { rejectUnauthorized: false };
  } else {
    ssl = true;
  }
}

const pool = new Pool({
  connectionString: postgresUrl,
  ...(ssl !== undefined ? { ssl } : {}),
  max: 1,
});

try {
  const sql = readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8");
  await pool.query(sql);
  console.log("[migrate-apply] migrations/0001_init.sql applied (idempotent).");
} finally {
  await pool.end();
}
