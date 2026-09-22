import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const waiverType = pgTable(
  "waiver_type",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    currentVersion: integer("current_version").notNull().default(1),
    docxUrl: text("docx_url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    waiverTypeNameUnq: uniqueIndex("waiver_type_name_unq").on(t.name),
    waiverTypeSlugUnq: uniqueIndex("waiver_type_slug_unq").on(t.slug),
  })
);

export const signedWaiver = pgTable(
  "signed_waiver",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    waiverTypeId: uuid("waiver_type_id")
      .notNull()
      .references(() => waiverType.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    waiverTypeName: text("waiver_type_name").notNull(),
    versionSigned: integer("version_signed").notNull(),
    signerName: text("signer_name").notNull(),
    signatureImageUrl: text("signature_image_url").notNull(),
    signedAt: timestamp("signed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    downloaded: boolean("downloaded").notNull().default(false),
    downloadedAt: timestamp("downloaded_at", { withTimezone: true }),
  },
  (t) => ({
    signedWaiverDuplicateIdx: index("signed_waiver_duplicate_idx").on(
      t.waiverTypeId,
      t.versionSigned,
      sql`lower(${t.signerName})`
    ),
    signedWaiverRetentionIdx: index("signed_waiver_retention_idx").on(
      t.downloaded,
      t.downloadedAt
    ),
    signedWaiverSignedAtIdx: index("signed_waiver_signed_at_idx").on(
      t.signedAt
    ),
  })
);

export const waiverHousekeepingLog = pgTable(
  "waiver_housekeeping_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobName: text("job_name").notNull(),
    triggerType: text("trigger_type").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    retentionDays: integer("retention_days"),
    cutoffIso: timestamp("cutoff_iso", { withTimezone: true }),
    rowsSelected: integer("rows_selected").notNull().default(0),
    rowsDeleted: integer("rows_deleted").notNull().default(0),
    rowsFailed: integer("rows_failed").notNull().default(0),
    blobsDeleted: integer("blobs_deleted").notNull().default(0),
    blobsFailed: integer("blobs_failed").notNull().default(0),
    errorMessages: text("error_messages").$type<string[]>().notNull().default([]),
    details: text("details"),
  },
  (t) => ({
    housekeepingLogStartedAtIdx: index("waiver_housekeeping_log_started_at_idx").on(
      t.startedAt.desc()
    ),
    housekeepingLogStatusStartedIdx: index("waiver_housekeeping_log_status_started_idx").on(
      t.status,
      t.startedAt
    ),
  })
);

export type WaiverType = typeof waiverType.$inferSelect;
export type NewWaiverType = typeof waiverType.$inferInsert;
export type SignedWaiver = typeof signedWaiver.$inferSelect;
export type NewSignedWaiver = typeof signedWaiver.$inferInsert;
export type WaiverHousekeepingLog = typeof waiverHousekeepingLog.$inferSelect;
export type NewWaiverHousekeepingLog = typeof waiverHousekeepingLog.$inferInsert;
