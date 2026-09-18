import { NextRequest, NextResponse } from "next/server";
import { and, between, eq, gte, lt, SQL, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { badRequestResponse } from "@/lib/auth";
import { adminOrUnauthorized } from "@/lib/access";
import { parseDateFilters } from "@/lib/filters";

export const runtime = "nodejs";
export const maxDuration = 30;

type SignedWaiverRow = typeof schema.signedWaiver.$inferSelect;

function buildDateWhere(
  col: typeof schema.signedWaiver.signedAt,
  parsed: ReturnType<typeof parseDateFilters>
): SQL | undefined {
  if ("error" in parsed) return undefined;
  if (parsed.start == null && parsed.endExclusive == null) return undefined;
  if (parsed.start && parsed.endExclusive) {
    return and(gte(col, parsed.start), lt(col, parsed.endExclusive));
  }
  if (parsed.start) return gte(col, parsed.start);
  return lt(col, parsed.endExclusive as Date);
}

function mapRow(r: SignedWaiverRow) {
  return {
    id: r.id,
    waiverType: r.waiverTypeName,
    signerName: r.signerName,
    version: r.versionSigned,
    signedAt: r.signedAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const authFail = adminOrUnauthorized(req);
  if (authFail) return authFail;

  const { searchParams } = new URL(req.url);
  const q: Record<string, unknown> = {};
  for (const [k, v] of searchParams.entries()) {
    if (["date", "from", "to"].includes(k)) q[k] = v;
  }

  const parsed = parseDateFilters(q);
  if ("error" in parsed) return badRequestResponse(parsed.error);

  const wh: (SQL | undefined)[] = [];
  const dateClause = buildDateWhere(schema.signedWaiver.signedAt, parsed);
  if (dateClause) wh.push(dateClause);

  const rows = await db
    .select()
    .from(schema.signedWaiver)
    .where(wh.length ? and(...wh.filter((x): x is SQL => !!x)) : undefined)
    .orderBy(schema.signedWaiver.signedAt);

  return NextResponse.json(rows.map(mapRow));
}
