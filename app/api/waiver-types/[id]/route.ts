import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import {
  badRequestResponse,
  notFoundResponse,
} from "@/lib/auth";
import {
  adminOrUnauthorized,
  buildSignedWaiverQrUrl,
} from "@/lib/access";
import {
  DOCX_MIME,
  MAX_DOCX_BYTES,
  isSizeError,
  randomBlobId,
  uploadFile,
} from "@/lib/blob";
import { convertDocxToHtml, makeCacheKey, setCachedHtml } from "@/lib/docx";

export const runtime = "nodejs";
export const maxDuration = 30;

function serialize(row: typeof schema.waiverType.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    currentVersion: row.currentVersion,
    docxUrl: row.docxUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    qrUrl: `/waiver/${row.slug}`,
    signedQrRelativeUrl: buildSignedWaiverQrUrl(row.slug, row.id, {
      absolute: false,
    }),
    signedQrFullUrl: buildSignedWaiverQrUrl(row.slug, row.id, {
      absolute: true,
    }),
  };
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authFail = adminOrUnauthorized(req);
  if (authFail) return authFail;

  const { id } = await params;
  if (!id) return notFoundResponse("Waiver type id required");

  const existing = await db
    .select()
    .from(schema.waiverType)
    .where(eq(schema.waiverType.id, id))
    .limit(1);
  if (existing.length === 0) return notFoundResponse("Waiver type not found");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequestResponse("Expected multipart/form-data body");
  }
  const fileField = form.get("docx");
  if (!(fileField instanceof File)) {
    return badRequestResponse("Missing required file field: docx");
  }
  const file = fileField as File;

  const normalizedType =
    file.type ||
    (file.name.toLowerCase().endsWith(".docx") ? DOCX_MIME : "");
  if (normalizedType !== DOCX_MIME) {
    return badRequestResponse("File must be a DOCX document (.docx)");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  const newVersion = existing[0].currentVersion + 1;
  const key = `waiver-types/${existing[0].slug}/${stamp}-v${newVersion}-${randomBlobId(8)}.docx`;

  let docxUrl: string;
  try {
    docxUrl = await uploadFile(key, buffer, DOCX_MIME, MAX_DOCX_BYTES);
  } catch (e) {
    if (isSizeError(e)) {
      return badRequestResponse(
        `DOCX exceeds size limit of ${MAX_DOCX_BYTES} bytes`
      );
    }
    return NextResponse.json(
      { error: "Failed to store uploaded DOCX" },
      { status: 500 }
    );
  }

  let convertedHtml: string;
  try {
    const r = await convertDocxToHtml(buffer);
    convertedHtml = r.html;
  } catch (e) {
    return NextResponse.json(
      { error: "Unable to parse DOCX file" },
      { status: 400 }
    );
  }

  const [updated] = await db
    .update(schema.waiverType)
    .set({
      docxUrl,
      currentVersion: newVersion,
      updatedAt: now,
    })
    .where(eq(schema.waiverType.id, existing[0].id))
    .returning();

  setCachedHtml(makeCacheKey(updated.id, updated.currentVersion), convertedHtml);

  return NextResponse.json(serialize(updated));
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authFail = adminOrUnauthorized(_req);
  if (authFail) return authFail;
  const id = (await params).id;
  const rows = await db
    .select()
    .from(schema.waiverType)
    .where(eq(schema.waiverType.id, id))
    .limit(1);
  if (rows.length === 0) return notFoundResponse("Waiver type not found");
  return NextResponse.json(serialize(rows[0]));
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authFail = adminOrUnauthorized(_req);
  if (authFail) return authFail;
  const id = (await params).id;
  if (!id) return notFoundResponse("Waiver type id required");
  const existing = await db
    .select()
    .from(schema.waiverType)
    .where(eq(schema.waiverType.id, id))
    .limit(1);
  if (existing.length === 0) return notFoundResponse("Waiver type not found");
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.signedWaiver)
      .where(eq(schema.signedWaiver.waiverTypeId, id));
    await tx.delete(schema.waiverType).where(eq(schema.waiverType.id, id));
  });
  setCachedHtml(makeCacheKey(existing[0].id, existing[0].currentVersion), "");
  return NextResponse.json({
    ok: true,
    deleted: {
      id: existing[0].id,
      name: existing[0].name,
      slug: existing[0].slug,
    },
  });
}
