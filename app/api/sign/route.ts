import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { badRequestResponse, notFoundResponse } from "@/lib/auth";
import { validateWaiverAccess } from "@/lib/access";
import {
  MAX_SIGNATURE_BYTES,
  PNG_MIME,
  randomBlobId,
  uploadFile,
} from "@/lib/blob";
import { isSizeError } from "@/lib/blob";

export const runtime = "nodejs";
export const maxDuration = 30;

const DATA_URL_PREFIX = "data:image/png;base64,";
const NAME_MAX_LEN = 200;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// Threshold for "truly blank" heuristic: a 1x1 transparent ~67-byte PNG is
// well under 120 bytes; any real drawing produces noticeably more bytes.
const MIN_NONBLANK_PNG_BYTES = 120;

function looksLikeRealPng(buf: Buffer): boolean {
  if (buf.length < 24) return false; // magic(8) + len(4) + IHDR(4) + w(4)+h(4) = 24
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (buf[i] !== PNG_MAGIC[i]) return false;
  }
  if (buf.length < MIN_NONBLANK_PNG_BYTES) return false;
  // Find IDAT chunk(s) to ensure the file actually contains pixel data.
  let offset = 8;
  let foundIdat = false;
  while (offset + 8 <= buf.length) {
    const chunkLen = buf.readUInt32BE(offset);
    const chunkType = buf.toString("ascii", offset + 4, offset + 8);
    if (chunkType === "IDAT" && chunkLen > 0) {
      foundIdat = true;
      break;
    }
    offset += 12 + chunkLen;
    if (offset > buf.length) break;
  }
  return foundIdat;
}

export async function POST(req: NextRequest) {
  let body: {
    waiverTypeId?: unknown;
    signerName?: unknown;
    signatureDataUrl?: unknown;
    accessHash?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return badRequestResponse("Invalid JSON body");
  }

  if (typeof body.waiverTypeId !== "string" || !body.waiverTypeId) {
    return badRequestResponse("Field waiverTypeId is required");
  }
  if (typeof body.signerName !== "string") {
    return badRequestResponse("Field signerName is required");
  }
  const signerName = body.signerName.trim();
  if (signerName.length === 0 || signerName.length > NAME_MAX_LEN) {
    return badRequestResponse(
      `Field signerName must be 1-${NAME_MAX_LEN} characters`
    );
  }
  if (typeof body.signatureDataUrl !== "string") {
    return badRequestResponse("Field signatureDataUrl is required");
  }
  const dataUrl = body.signatureDataUrl;
  if (!dataUrl.startsWith(DATA_URL_PREFIX)) {
    return badRequestResponse(
      "Field signatureDataUrl must be a PNG data URL (data:image/png;base64,...)"
    );
  }
  const b64 = dataUrl.slice(DATA_URL_PREFIX.length);
  let bytes: Buffer;
  try {
    bytes = Buffer.from(b64, "base64");
  } catch {
    return badRequestResponse("Invalid base64 payload in signatureDataUrl");
  }
  if (bytes.length > MAX_SIGNATURE_BYTES) {
    return badRequestResponse(
      `Signature exceeds size limit of ${MAX_SIGNATURE_BYTES} bytes`
    );
  }

  const wtRows = await db
    .select()
    .from(schema.waiverType)
    .where(eq(schema.waiverType.id, body.waiverTypeId))
    .limit(1);
  if (wtRows.length === 0) return notFoundResponse("Waiver type not found");
  const wt = wtRows[0];

  const hField =
    typeof body.accessHash === "string" ? body.accessHash : null;
  const access = validateWaiverAccess(wt.slug, wt.id, hField);
  if (!access.valid) {
    const msgMap: Record<string, string> = {
      missing:
        "Signature submission is missing the required QR security code. Use the printed QR to open and submit the waiver before signing.",
      mismatch:
        "Signature submission security code does not match this waiver type. Re-scan the printed QR and try again.",
      "bad-format":
        "Signature submission security code has the wrong format. Re-scan the printed QR.",
    };
    return NextResponse.json(
      { error: msgMap[access.reason], status: "forbidden" },
      { status: 403 }
    );
  }

  if (!looksLikeRealPng(bytes)) {
    return badRequestResponse(
      "Signature appears to be blank — please draw inside the signature box."
    );
  }

  const versionAtSign = wt.currentVersion;

  const dups = await db
    .select({ id: schema.signedWaiver.id })
    .from(schema.signedWaiver)
    .where(
      and(
        eq(schema.signedWaiver.waiverTypeId, wt.id),
        eq(schema.signedWaiver.versionSigned, versionAtSign),
        eq(
          sql`lower(${schema.signedWaiver.signerName})`,
          sql`lower(${signerName})`
        )
      )
    )
    .limit(1);
  if (dups.length > 0) {
    return NextResponse.json({
      status: "duplicate",
      message:
        "User has already signed the same waiver before. No need to sign new one.",
    });
  }

  const stamp = new Date();
  const stampStr = `${stamp.getUTCFullYear()}${String(stamp.getUTCMonth() + 1).padStart(2, "0")}${String(stamp.getUTCDate()).padStart(2, "0")}`;
  const key = `signatures/${wt.slug}/${stampStr}-v${versionAtSign}-${randomBlobId(10)}.png`;

  let signatureImageUrl: string;
  try {
    signatureImageUrl = await uploadFile(key, bytes, PNG_MIME, MAX_SIGNATURE_BYTES);
  } catch (e) {
    if (isSizeError(e)) {
      return badRequestResponse(
        `Signature exceeds size limit of ${MAX_SIGNATURE_BYTES} bytes`
      );
    }
    return NextResponse.json(
      { error: "Failed to store signature" },
      { status: 500 }
    );
  }

  const [inserted] = await db
    .insert(schema.signedWaiver)
    .values({
      waiverTypeId: wt.id,
      waiverTypeName: wt.name,
      versionSigned: versionAtSign,
      signerName,
      signatureImageUrl,
      signedAt: stamp,
      downloaded: false,
      downloadedAt: null,
    })
    .returning({ id: schema.signedWaiver.id });

  return NextResponse.json(
    {
      status: "success",
      message: "Thank you, your waiver has been recorded.",
      id: inserted?.id ?? null,
    },
    { status: 201 }
  );
}
