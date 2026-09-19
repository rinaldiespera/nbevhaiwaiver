import { defineConfig } from "drizzle-kit";
import { parse } from "pg-connection-string";

const postgresUrl =
  process.env.POSTGRES_URL ||
  "postgresql://user:pass@localhost:5432/waiver?sslmode=prefer";

const { resolvedUrl, resolvedSsl } = (() => {
  try {
    const parsed = parse(postgresUrl);
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
    if (!sslmode || String(sslmode) === "prefer" || String(sslmode) === "disable") {
      return { resolvedUrl: postgresUrl, resolvedSsl: undefined as Record<string, unknown> | undefined };
    }
    const sslHint = {
      rejectUnauthorized: !host.includes("aivencloud.com"),
    } as Record<string, unknown>;
    const stripped = new URL(postgresUrl);
    stripped.searchParams.delete("sslmode");
    stripped.searchParams.delete("ssl");
    return { resolvedUrl: stripped.toString(), resolvedSsl: sslHint };
  } catch {
    return { resolvedUrl: postgresUrl, resolvedSsl: undefined as Record<string, unknown> | undefined };
  }
})();

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: resolvedUrl,
    ...(resolvedSsl ? ({ ssl: resolvedSsl } as { ssl: Record<string, unknown> }) : {}),
  },
  verbose: true,
  strict: true,
});
