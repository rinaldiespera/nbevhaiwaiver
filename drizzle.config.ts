import { defineConfig } from "drizzle-kit";

const postgresUrl =
  process.env.POSTGRES_URL ||
  "postgresql://user:pass@localhost:5432/waiver?sslmode=prefer";

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: postgresUrl,
  },
  verbose: true,
  strict: true,
});
