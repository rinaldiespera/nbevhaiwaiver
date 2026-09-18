import { NextRequest, NextResponse } from "next/server";
import { and, eq, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { badRequestResponse } from "@/lib/auth";
import { adminOrUnauthorized } from "@/lib/access";

export const runtime = "nodejs";
export const maxDuration = 30;

type Body = { retentionDays?: unknown };

export async function POST(req: NextRequest) {
  const authFail = adminOrUnauthorized(req);
  if (authFail) return authFail;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return badRequestResponse("Invalid JSON body");
  }

  if (body.retentionDays === undefined || body.retentionDays === null) {
    return badRequestResponse("Field retentionDays is required");
  }
  const days = Number(body.retentionDays);
  if (!Number.isFinite(days) || !Number.isInteger(days)) {
    return badRequestResponse("Field retentionDays must be an integer");
  }
  if (days < 0 || days > 36500) {
    return badRequestResponse(
      "Field retentionDays must be between 0 and 36500"
    );
  }

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  cutoff.setUTCHours(0, 0, 0, 0);

  const deleted = await db
    .delete(schema.signedWaiver)
    .where(
      and(
        eq(schema.signedWaiver.downloaded, true),
        // downloaded_at IS NOT NULL is implicit via lt comparison
        lt(schema.signedWaiver.downloadedAt, cutoff)
      )
    );

  return NextResponse.json({ deletedCount: deleted.rowCount ?? 0 });
}
