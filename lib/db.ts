import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { parse } from "pg-connection-string";
import * as schema from "./db/schema";

const globalForDb = globalThis as unknown as {
  _waiverDbPool?: Pool;
};

const runtimeSslHint = (() => {
  try {
    const url = process.env.POSTGRES_URL;
    if (!url) return undefined;
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
    if (sslmode && String(sslmode) !== "prefer" && String(sslmode) !== "disable") {
      return {
        rejectUnauthorized: !host.includes("aivencloud.com"),
      } as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
})();

const poolConfig: ConstructorParameters<typeof Pool>[0] = {
  connectionString: process.env.POSTGRES_URL,
  max: process.env.NODE_ENV === "production" ? 12 : 4,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 8_000,
};
if (runtimeSslHint) poolConfig.ssl = runtimeSslHint;

const pool = globalForDb._waiverDbPool ?? new Pool(poolConfig);

if (process.env.NODE_ENV !== "production") globalForDb._waiverDbPool = pool;

export const db = drizzle(pool, { schema });
export { schema };
