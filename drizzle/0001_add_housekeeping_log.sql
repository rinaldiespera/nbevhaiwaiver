DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS "waiver_housekeeping_log" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "job_name" text NOT NULL,
    "trigger_type" text NOT NULL,
    "status" text NOT NULL,
    "started_at" timestamp with time zone NOT NULL,
    "finished_at" timestamp with time zone,
    "retention_days" integer,
    "cutoff_iso" timestamp with time zone,
    "rows_selected" integer DEFAULT 0 NOT NULL,
    "rows_deleted" integer DEFAULT 0 NOT NULL,
    "rows_failed" integer DEFAULT 0 NOT NULL,
    "blobs_deleted" integer DEFAULT 0 NOT NULL,
    "blobs_failed" integer DEFAULT 0 NOT NULL,
    "error_messages" text[] DEFAULT ARRAY[]::text[] NOT NULL,
    "details" text
  );
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS "waiver_housekeeping_log_started_at_idx" ON "waiver_housekeeping_log" USING btree ("started_at" DESC);
CREATE INDEX IF NOT EXISTS "waiver_housekeeping_log_status_started_idx" ON "waiver_housekeeping_log" USING btree ("status","started_at");
