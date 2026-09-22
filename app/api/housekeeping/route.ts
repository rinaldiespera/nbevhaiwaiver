import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, isNotNull, lt, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, schema } from "@/lib/db";
import { badRequestResponse } from "@/lib/auth";
import { adminOrUnauthorized } from "@/lib/access";
import { deleteFile } from "@/lib/blob";
import type { NewWaiverHousekeepingLog } from "@/lib/db/schema";

export const runtime = "nodejs";
export const maxDuration = 300;

type TriggerType = "MANUAL" | "SCHEDULED" | "CRON_VERCEL";
type HousekeepingStatus =
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "SKIPPED_ALREADY_RUNNING";

type Body = {
  retentionDays?: unknown;
  triggerType?: TriggerType | string;
};

const HOUSEKEEPING_JOB_NAME = "waiver-signed-waiver-retention";

const runningLock: { flag: boolean } = { flag: false };

function envInt(name: string, fallback: number, minVal: number, maxVal: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(minVal, Math.min(maxVal, Math.floor(n)));
}

function clampRetentionDays(n: number): number {
  if (!Number.isFinite(n) || !Number.isInteger(n)) return 90;
  return Math.max(0, Math.min(36500, n));
}

function tryAcquireRunLock(): boolean {
  if (runningLock.flag) return false;
  runningLock.flag = true;
  return true;
}
function releaseRunLock() {
  runningLock.flag = false;
}

type LogRecord = {
  id: string;
};

async function insertLog(
  fields: Omit<NewWaiverHousekeepingLog, "id"> & { id?: string }
): Promise<LogRecord> {
  const id = fields.id ?? randomUUID();
  await db.insert(schema.waiverHousekeepingLog).values({ ...fields, id });
  return { id };
}

async function updateLog(
  id: string,
  patch: Partial<NewWaiverHousekeepingLog>
) {
  await db.update(schema.waiverHousekeepingLog).set(patch).where(
    eq(schema.waiverHousekeepingLog.id, id)
  );
}

export type HousekeepingResponse = {
  runId: string;
  status: HousekeepingStatus;
  message?: string;
  retentionDays: number;
  cutoffIso: string;
  rowsSelected: number;
  rowsDeleted: number;
  rowsFailed: number;
  blobsDeleted: number;
  blobsFailed: number;
  errorMessages: string[];
  startedAt: string;
  finishedAt?: string;
  triggerType: TriggerType;
};

async function buildResponse(
  fields: Omit<HousekeepingResponse, "status"> & { status: HousekeepingStatus }
): Promise<HousekeepingResponse> {
  return fields;
}

export async function POST(req: NextRequest) {
  if (process.env.WAIVER_HOUSEKEEPING_DISABLED === "1" || process.env.WAIVER_HOUSEKEEPING_DISABLED === "true") {
    return NextResponse.json(
      {
        error: "Housekeeping is disabled via WAIVER_HOUSEKEEPING_DISABLED.",
      },
      { status: 503 }
    );
  }
  const authFail = adminOrUnauthorized(req);
  // Note: cron invocations from /api/cron/housekeeping skip this function via direct executeHousekeeping()
  // because Vercel scheduler auth is based on crons token header, which is validated in that route.
  if (authFail) return authFail;

  let body: Body = {};
  try {
    const ct = req.headers.get("content-type");
    if (ct && ct.includes("application/json")) {
      body = (await req.json()) as Body;
    }
  } catch {
    return badRequestResponse("Invalid JSON body");
  }

  const rawDays = body.retentionDays === undefined ? null : Number(body.retentionDays);
  const retentionDays =
    rawDays === null
      ? clampRetentionDays(envInt("WAIVER_HOUSEKEEPING_RETENTION_DAYS", 90, 0, 36500))
      : clampRetentionDays(rawDays);

  if (body.retentionDays !== undefined && rawDays !== null) {
    if (!Number.isFinite(rawDays) || !Number.isInteger(rawDays)) {
      return badRequestResponse("Field retentionDays must be an integer");
    }
    if (rawDays < 0 || rawDays > 36500) {
      return badRequestResponse(
        "Field retentionDays must be between 0 and 36500"
      );
    }
  }

  const triggerType: TriggerType =
    body.triggerType === "SCHEDULED" || body.triggerType === "CRON_VERCEL"
      ? body.triggerType
      : "MANUAL";

  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
  const cutoff = new Date(startedAt);
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  cutoff.setUTCHours(0, 0, 0, 0);
  const cutoffIso = cutoff.toISOString();

  if (!tryAcquireRunLock()) {
    const finishedAtIso = new Date().toISOString();
    const log = await insertLog({
      jobName: HOUSEKEEPING_JOB_NAME,
      triggerType,
      status: "SKIPPED_ALREADY_RUNNING",
      startedAt,
      finishedAt: new Date(),
      retentionDays,
      cutoffIso: cutoff,
      details: "Housekeeping already in progress.",
    });
    return NextResponse.json(
      {
        runId: log.id,
        status: "SKIPPED_ALREADY_RUNNING",
        message: "Housekeeping is already running.",
        retentionDays,
        cutoffIso,
        rowsSelected: 0,
        rowsDeleted: 0,
        rowsFailed: 0,
        blobsDeleted: 0,
        blobsFailed: 0,
        errorMessages: [],
        startedAt: startedAtIso,
        finishedAt: finishedAtIso,
        triggerType,
      },
      { status: 409 }
    );
  }

  const batchSize = envInt("WAIVER_HOUSEKEEPING_BATCH_SIZE", 200, 1, 5000);
  const maxDurationSeconds =
    process.env.WAIVER_HOUSEKEEPING_MAX_SECONDS == null
      ? 240
      : envInt("WAIVER_HOUSEKEEPING_MAX_SECONDS", 240, 10, 290);
  const softDeadlineMs = startedAt.getTime() + maxDurationSeconds * 1000;

  const baseLog = await insertLog({
    jobName: HOUSEKEEPING_JOB_NAME,
    triggerType,
    status: "RUNNING",
    startedAt,
    retentionDays,
    cutoffIso: cutoff,
    rowsSelected: 0,
    rowsDeleted: 0,
    rowsFailed: 0,
    blobsDeleted: 0,
    blobsFailed: 0,
    errorMessages: [],
  });
  const runId = baseLog.id;

  let rowsSelected = 0;
  let rowsDeleted = 0;
  let rowsFailed = 0;
  let blobsDeleted = 0;
  let blobsFailed = 0;
  const errorMessages: string[] = [];

  try {
    // Select candidate IDs in loop until none remain, time budget exhausted, or batches complete.
    while (true) {
      if (Date.now() + 10_000 > softDeadlineMs) {
        if (rowsSelected > 0) {
          errorMessages.push(
            `Stopped early: remaining time budget under 10s after processing ${rowsSelected} row(s).`
          );
        }
        break;
      }

      const candidates = await db
        .select({
          id: schema.signedWaiver.id,
          signatureImageUrl: schema.signedWaiver.signatureImageUrl,
          downloadedAt: schema.signedWaiver.downloadedAt,
        })
        .from(schema.signedWaiver)
        .where(
          and(
            eq(schema.signedWaiver.downloaded, true),
            isNotNull(schema.signedWaiver.downloadedAt),
            lt(schema.signedWaiver.downloadedAt, cutoff)
          )
        )
        .orderBy(asc(schema.signedWaiver.downloadedAt), asc(schema.signedWaiver.id))
        .limit(batchSize);

      if (!candidates || candidates.length === 0) {
        break;
      }
      rowsSelected += candidates.length;

      const idsToDelete: string[] = [];
      for (const row of candidates) {
        const url = row.signatureImageUrl;
        if (url) {
          try {
            await deleteFile(url);
            blobsDeleted++;
          } catch (e) {
            blobsFailed++;
            const msg =
              "signedWaiver=" +
              row.id +
              " blob delete failed: " +
              ((e as any)?.message ?? String(e));
            errorMessages.push(msg.slice(0, 500));
            continue; // skip row DB delete per AC-10
          }
        }
        idsToDelete.push(row.id);
      }

      if (idsToDelete.length > 0) {
        try {
          const del = await db
            .delete(schema.signedWaiver)
            .where(inArray(schema.signedWaiver.id, idsToDelete));
          rowsDeleted += del.rowCount ?? idsToDelete.length;
        } catch (e) {
          const failed = idsToDelete.length;
          rowsFailed += failed;
          errorMessages.push(
            "DB delete batch failed for " +
              failed +
              " row(s): " +
              ((e as any)?.message ?? String(e)).slice(0, 400)
          );
          // Revert blob-deleted count? No — blobs are gone anyway; mark the rows as failed-to-delete in DB.
        }
      } else {
        rowsFailed += candidates.length; // every blob failed, so no rows were deletable
      }

      if (candidates.length < batchSize) {
        break;
      }
    }

    const finalStatus: HousekeepingStatus =
      rowsFailed === 0 && errorMessages.length === 0 ? "SUCCESS" : "SUCCESS"; // still SUCCESS; failures are captured in fields + errors
    const finishedAt = new Date();
    await updateLog(runId, {
      status: "SUCCESS",
      finishedAt,
      rowsSelected,
      rowsDeleted,
      rowsFailed,
      blobsDeleted,
      blobsFailed,
      errorMessages,
    });
    return NextResponse.json({
      runId,
      status: finalStatus,
      retentionDays,
      cutoffIso,
      rowsSelected,
      rowsDeleted,
      rowsFailed,
      blobsDeleted,
      blobsFailed,
      errorMessages,
      startedAt: startedAtIso,
      finishedAt: finishedAt.toISOString(),
      triggerType,
    });
  } catch (e) {
    rowsFailed += 1;
    const msg = ((e as any)?.message ?? e).toString().slice(0, 800);
    errorMessages.unshift("Fatal housekeeping error: " + msg);
    const finishedAt = new Date();
    try {
      await updateLog(runId, {
        status: "FAILED",
        finishedAt,
        rowsSelected,
        rowsDeleted,
        rowsFailed,
        blobsDeleted,
        blobsFailed,
        errorMessages,
      });
    } catch {
      /* ignore */
    }
    return NextResponse.json(
      {
        runId,
        status: "FAILED",
        message: msg,
        retentionDays,
        cutoffIso,
        rowsSelected,
        rowsDeleted,
        rowsFailed,
        blobsDeleted,
        blobsFailed,
        errorMessages,
        startedAt: startedAtIso,
        finishedAt: finishedAt.toISOString(),
        triggerType,
      },
      { status: 500 }
    );
  } finally {
    releaseRunLock();
  }
}
