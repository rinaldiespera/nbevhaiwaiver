import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import {
  badRequestResponse,
  unauthorizedResponse,
} from "@/lib/auth";
import {
  adminOrUnauthorized,
  buildSignedWaiverQrUrl,
} from "@/lib/access";
import { slugCollision, slugify } from "@/lib/slug";
import {
  DOCX_MIME,
  MAX_DOCX_BYTES,
  randomBlobId,
  uploadFile,
} from "@/lib/blob";
import { convertDocxToHtml, makeCacheKey, setCachedHtml } from "@/lib/docx";
import { isSizeError } from "@/lib/blob";

export const runtime = "nodejs";
export const maxDuration = 30;

const NAME_MAX_LEN = 200;

async function generateUniqueSlug(base: string): Promise<string> {
  for (let attempt = 1; attempt <= 200; attempt++) {
    const candidate = slugCollision(base, attempt);
    const rows = await db
      .select({ slug: schema.waiverType.slug })
      .from(schema.waiverType)
      .where(eq(schema.waiverType.slug, candidate))
      .limit(1);
    if (rows.length === 0) return candidate;
  }
  throw new Error("Unable to generate unique slug after many attempts");
}

function pickQrUrl(slug: string): string {
  return `/waiver/${slug}`;
}

function serialize(row: typeof schema.waiverType.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    currentVersion: row.currentVersion,
    docxUrl: row.docxUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    qrUrl: pickQrUrl(row.slug),
    signedQrRelativeUrl: buildSignedWaiverQrUrl(row.slug, row.id, {
      absolute: false,
    }),
    signedQrFullUrl: buildSignedWaiverQrUrl(row.slug, row.id, {
      absolute: true,
    }),
  };
}

export async function POST(req: NextRequest) {
  const authFail = adminOrUnauthorized(req);
  if (authFail) return authFail;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequestResponse("Expected multipart/form-data body");
  }

  const nameField = form.get("name");
  const fileField = form.get("docx");
  if (typeof nameField !== "string") {
    return badRequestResponse("Missing required field: name");
  }
  const name = nameField.trim();
  if (name.length === 0 || name.length > NAME_MAX_LEN) {
    return badRequestResponse(
      `Field name must be 1-${NAME_MAX_LEN} characters`
    );
  }
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

  const baseSlug = slugify(name);
  let slug: string;
  try {
    slug = await generateUniqueSlug(baseSlug);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "Slug generation failed" },
      { status: 500 }
    );
  }

  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  const key = `waiver-types/${slug}/${stamp}-v1-${randomBlobId(8)}.docx`;

  let docxUrl: string;
  try {
    docxUrl = await uploadFile(key, buffer, DOCX_MIME, MAX_DOCX_BYTES);
  } catch (e) {
    if (isSizeError(e)) {
      return badRequestResponse(
        `DOCX exceeds size limit of ${MAX_DOCX_BYTES} bytes`
      );
    }
    const cause = (e as Error).message ?? String(e);
    const stack = (e as Error).stack ?? "";
    return NextResponse.json(
      { error: "Failed to store uploaded DOCX", cause, stack },
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

  const [inserted] = await db
    .insert(schema.waiverType)
    .values({
      name,
      slug,
      currentVersion: 1,
      docxUrl,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  setCachedHtml(makeCacheKey(inserted.id, inserted.currentVersion), convertedHtml);

  return NextResponse.json(serialize(inserted), { status: 201 });
}

export async function GET(req: NextRequest) {
  const authFail = adminOrUnauthorized(req);
  if (authFail) return authFail;
  const rows = await db
    .select()
    .from(schema.waiverType)
    .orderBy(schema.waiverType.name);
  return NextResponse.json(rows.map(serialize));
}
