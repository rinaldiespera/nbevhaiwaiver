import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./db/schema";

const globalForDb = globalThis as unknown as {
  _waiverDbPool?: Pool;
};

const pool =
  globalForDb._waiverDbPool ??
  new Pool({
    connectionString: process.env.POSTGRES_URL,
    max: process.env.NODE_ENV === "production" ? 12 : 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8000,
  });

if (process.env.NODE_ENV !== "production") globalForDb._waiverDbPool = pool;

export const db = drizzle(pool, { schema });
export { schema };
