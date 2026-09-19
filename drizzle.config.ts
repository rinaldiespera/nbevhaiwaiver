import { defineConfig } from "drizzle-kit";
import { parse } from "pg-connection-string";

const postgresUrl =
  process.env.POSTGRES_URL ||
  "postgresql://user:pass@localhost:5432/waiver?sslmode=prefer";

const sslHint = (() => {
  try {
    const parsed = parse(postgresUrl);
    const params = (parsed as unknown as { options?: Record<string, string> }).options || {};
    const sslmode =
      (parsed as unknown as { ssl?: boolean | string; sslmode?: string }).sslmode ||
      (parsed as unknown as { ssl?: boolean | string; sslmode?: string }).ssl ||
      "prefer";
    const host = typeof parsed.host === "string" ? parsed.host : Array.isArray(parsed.host) ? parsed.host[0] || "" : "";
    if (sslmode && String(sslmode) !== "prefer" && String(sslmode) !== "disable") {
      return { rejectUnauthorized: !host.includes("aivencloud.com") && String(sslmode) !== "require" } as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
})();

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: postgresUrl,
    ...(sslHint ? ({ ssl: sslHint } as { ssl: Record<string, unknown> }) : {}),
  },
  verbose: true,
  strict: true,
});
