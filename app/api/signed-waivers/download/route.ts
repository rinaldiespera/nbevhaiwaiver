import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, gte, lt, SQL } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { badRequestResponse } from "@/lib/auth";
import { adminOrUnauthorized } from "@/lib/access";
import { downloadFiltersFromBody, isValidDateString } from "@/lib/filters";
import { getFileAsBase64 } from "@/lib/blob";

export const runtime = "nodejs";
export const maxDuration = 30;

type DownloadBody = {
  date?: unknown;
  from?: unknown;
  to?: unknown;
  waiverType?: unknown;
  ids?: unknown;
  includeDownloaded?: unknown;
};

type Row = typeof schema.signedWaiver.$inferSelect;

function validateIds(ids: unknown): string[] | { error: string } {
  if (ids === undefined || ids === null) return [];
  if (!Array.isArray(ids)) return { error: "Field ids must be an array of UUID strings" };
  if (ids.length > 5000) return { error: "Field ids exceeds maximum length (5000)" };
  for (const id of ids) {
    if (typeof id !== "string" || id.length === 0) {
      return { error: "Every element in ids must be a non-empty string id" };
    }
  }
  return ids as string[];
}

export async function POST(req: NextRequest) {
  const authFail = adminOrUnauthorized(req);
  if (authFail) return authFail;

  let body: DownloadBody;
  try {
    const ct = req.headers.get("content-type");
    if (ct && ct.includes("application/json")) {
      body = (await req.json()) as DownloadBody;
    } else {
      body = {};
    }
  } catch {
    return badRequestResponse("Invalid JSON body");
  }

  const idsOrErr = validateIds(body.ids);
  if ("error" in idsOrErr) return badRequestResponse(idsOrErr.error);
  const explicitIds = idsOrErr.length ? idsOrErr : null;

  const dateParsed = downloadFiltersFromBody(body);
  if ("error" in dateParsed) return badRequestResponse(dateParsed.error);

  const waiverTypeName =
    typeof body.waiverType === "string" && body.waiverType.trim().length > 0
      ? body.waiverType.trim()
      : null;

  const includeDownloaded = body.includeDownloaded === true;

  try {
    const result = await db.transaction(async (tx) => {
      const wh: SQL[] = [];

      if (explicitIds) {
        wh.push(inArray(schema.signedWaiver.id, explicitIds));
      } else {
        if (dateParsed.start) wh.push(gte(schema.signedWaiver.signedAt, dateParsed.start));
        if (dateParsed.endExclusive) wh.push(lt(schema.signedWaiver.signedAt, dateParsed.endExclusive));
        if (waiverTypeName) wh.push(eq(schema.signedWaiver.waiverTypeName, waiverTypeName));
        if (!includeDownloaded) wh.push(eq(schema.signedWaiver.downloaded, false));
      }

      const rows: Row[] = await tx
        .select()
        .from(schema.signedWaiver)
        .where(wh.length ? and(...wh) : undefined)
        .for("update")
        .orderBy(schema.signedWaiver.signedAt);

      if (rows.length === 0) return [];

      const ids = rows.map((r) => r.id);
      const now = new Date();

      await tx
        .update(schema.signedWaiver)
        .set({ downloaded: true, downloadedAt: now })
        .where(inArray(schema.signedWaiver.id, ids));

      const out = await Promise.all(
        rows.map(async (r) => {
          let signatureImageBase64 = "";
          try {
            signatureImageBase64 = await getFileAsBase64(r.signatureImageUrl);
          } catch {
            signatureImageBase64 = "";
          }
          return {
            id: r.id,
            waiverType: r.waiverTypeName,
            signerName: r.signerName,
            version: r.versionSigned,
            signedAt: r.signedAt.toISOString(),
            signatureImageBase64,
          };
        })
      );

      return out;
    });

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: "Internal error downloading records" },
      { status: 500 }
    );
  }
}
