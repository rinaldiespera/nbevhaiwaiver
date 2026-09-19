import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { parse } from "pg-connection-string";
import * as schema from "./db/schema";

const globalForDb = globalThis as unknown as {
  _waiverDbPool?: Pool;
};

const { resolvedConnString, resolvedSsl } = (() => {
  const url = process.env.POSTGRES_URL;
  if (!url) return { resolvedConnString: undefined, resolvedSsl: undefined };
  const parsed = parse(url);
  const host =
    typeof parsed.host === "string"
      ? parsed.host
      : Array.isArray(parsed.host)
        ? parsed.host[0] || ""
        : "";
  const sslmode =
    (parsed as unknown as { ssl?: boolean | string; sslmode?: string }).sslmode ||
    (parsed as unknown as { ssl?: boolean | string; sslmode?: string }).ssl ||
    "prefer";
  const needsSslHint =
    !!sslmode && String(sslmode) !== "prefer" && String(sslmode) !== "disable";
  if (!needsSslHint) {
    return { resolvedConnString: url, resolvedSsl: undefined };
  }
  const sslHint = {
    rejectUnauthorized: !host.includes("aivencloud.com"),
  } as Record<string, unknown>;
  const stripped = new URL(url);
  stripped.searchParams.delete("sslmode");
  stripped.searchParams.delete("ssl");
  return { resolvedConnString: stripped.toString(), resolvedSsl: sslHint };
})();

const poolConfig: ConstructorParameters<typeof Pool>[0] = {
  connectionString: resolvedConnString,
  max: process.env.NODE_ENV === "production" ? 12 : 4,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 8_000,
};
if (resolvedSsl) poolConfig.ssl = resolvedSsl;

const pool = globalForDb._waiverDbPool ?? new Pool(poolConfig);

if (process.env.NODE_ENV !== "production") globalForDb._waiverDbPool = pool;

export const db = drizzle(pool, { schema });
export { schema };
