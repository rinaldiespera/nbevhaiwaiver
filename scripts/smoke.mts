#!/usr/bin/env tsx
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
} from "docx";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { setTimeout as sleep } from "node:timers/promises";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const TOKEN = process.env.API_BEARER_TOKEN || "test-secret-token-12345";
const POSTGRES_URL =
  process.env.POSTGRES_URL ||
  "postgresql://waiver_test:waiver_test_pass@localhost:5433/waiver_test?sslmode=disable";

const AUTH_HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
};

// ---------------------------------------------------------------------------
// Logger + assertion helpers
// ---------------------------------------------------------------------------
type StepResult = {
  name: string;
  passed: boolean;
  detail?: string;
};
const STEP_RESULTS: StepResult[] = [];
let stepCounter = 0;

function log(msg: string) {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  process.stdout.write(`[${now}] ${msg}\n`);
}

function step(name: string, fn: () => Promise<void> | void) {
  stepCounter++;
  const idx = String(stepCounter).padStart(2, "0");
  log(`STEP ${idx} START: ${name}`);
  return Promise.resolve()
    .then(fn)
    .then(() => {
      log(`STEP ${idx} PASS : ${name}`);
      STEP_RESULTS.push({ name, passed: true });
    })
    .catch((err) => {
      const detail = err instanceof Error ? err.message : String(err);
      log(`STEP ${idx} FAIL : ${name} -- ${detail}`);
      STEP_RESULTS.push({ name, passed: false, detail });
    });
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(
        actual
      )}`
    );
  }
}

// ---------------------------------------------------------------------------
// Node Buffer → ArrayBuffer helper (Node 24 BlobPart typing compat)
// ---------------------------------------------------------------------------
function nodeBufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  // BlobPart accepts ArrayBuffer directly (it's a union member).  Copying into
  // a fresh, unparameterized ArrayBuffer avoids Node 24's generic
  // Uint8Array<ArrayBufferLike> being rejected by BlobPart's stricter
  // ArrayBufferView<ArrayBuffer> .buffer requirement.
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf as unknown as Uint8Array);
  return ab;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function authHeaders(extra: Record<string, string> = {}) {
  return { ...AUTH_HEADERS, ...extra };
}

async function http(
  method: string,
  path: string,
  opts: {
    headers?: Record<string, string>;
    body?: unknown; // object -> JSON, FormData -> multipart
    expectStatus?: number;
  } = {}
) {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) {
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, { method, headers, body });
  const ct = res.headers.get("content-type") || "";
  let data: unknown;
  if (ct.includes("application/json")) {
    data = await res.json();
  } else {
    data = await res.text();
  }
  if (opts.expectStatus != null && res.status !== opts.expectStatus) {
    const preview =
      typeof data === "string"
        ? data.slice(0, 200)
        : JSON.stringify(data).slice(0, 200);
    throw new Error(
      `${method} ${path} expected status ${opts.expectStatus}, got ${res.status}. Body: ${preview}`
    );
  }
  return { status: res.status, data, headers: res.headers };
}

async function waitForServer(timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/`, { method: "HEAD" });
      if (res.status < 500) return;
    } catch {
      // ignore
    }
    await sleep(1500);
  }
  throw new Error(
    `Server ${BASE_URL} did not respond within ${timeoutMs}ms`
  );
}

// ---------------------------------------------------------------------------
// DOCX fixtures
// ---------------------------------------------------------------------------
async function buildDocxBuffer(version: 1 | 2): Promise<Buffer> {
  if (version === 1) {
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              heading: HeadingLevel.TITLE,
              children: [
                new TextRun("NBEVHAI Basketball Court Liability Waiver"),
              ],
            }),
            new Paragraph({
              children: [new TextRun("Version 1 — effective immediately.")],
            }),
            new Paragraph({ children: [] }),
            new Paragraph({
              children: [
                new TextRun(
                  "By signing below, I, the undersigned, acknowledge that I am voluntarily participating in basketball activities at the NBEVHAI village sports facility."
                ),
              ],
            }),
            new Paragraph({
              children: [
                new TextRun(
                  "I agree to release, indemnify, and hold harmless NBEVHAI, its officers, directors, employees, and agents from any and all claims, injuries, or damages arising from my participation."
                ),
              ],
            }),
            new Paragraph({
              children: [
                new TextRun(
                  "I confirm that I am in good physical health and have no medical conditions that would prevent safe participation."
                ),
              ],
            }),
            new Paragraph({
              children: [
                new TextRun(
                  "I have read and understood the foregoing terms before signing."
                ),
              ],
            }),
          ],
        },
      ],
    });
    return Buffer.from(await Packer.toBuffer(doc));
  }
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            children: [
              new TextRun("NBEVHAI Basketball Court Liability Waiver"),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun(
                "Version 2 — UPDATED: includes mandatory equipment clause."
              ),
            ],
          }),
          new Paragraph({ children: [] }),
          new Paragraph({
            children: [
              new TextRun(
                "By signing below, I, the undersigned, acknowledge that I am voluntarily participating in basketball activities at the NBEVHAI village sports facility."
              ),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun(
                "NEW in v2: I agree to wear closed-toe athletic shoes at all times while on the court. Failure to comply may result in immediate ejection."
              ),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun(
                "I agree to release, indemnify, and hold harmless NBEVHAI, its officers, directors, employees, and agents from any and all claims, injuries, or damages arising from my participation."
              ),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun(
                "I confirm that I am in good physical health and have no medical conditions that would prevent safe participation."
              ),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun(
                "I have read and understood the foregoing terms before signing, including the new Version 2 equipment requirements."
              ),
            ],
          }),
        ],
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

// ---------------------------------------------------------------------------
// Signature PNG fixture (80 x 30 8-bit RGB, with a drawn "signature" line)
// Must pass server-side: PNG magic + length >= 120 bytes + non-empty IDAT chunk
// ---------------------------------------------------------------------------
function buildSignaturePng(): Buffer {
  const W = 80;
  const H = 30;
  // Per-scanline filter byte (0 = None) + W * 3 RGB bytes
  const stride = 1 + W * 3;
  const raw = Buffer.alloc(stride * H);
  // Draw a diagonal zig-zag line (non-white pixels = a "signature")
  for (let y = 0; y < H; y++) {
    raw[y * stride] = 0; // filter byte = None
    for (let x = 0; x < W; x++) {
      const base = y * stride + 1 + x * 3;
      // Background: white
      raw[base] = 255;
      raw[base + 1] = 255;
      raw[base + 2] = 255;
      // A thick diagonal-ish stroke (ink = dark blue)
      const onStroke =
        Math.abs(y - Math.round(15 + 10 * Math.sin(x * 0.25))) <= 2;
      if (onStroke) {
        raw[base] = 20;
        raw[base + 1] = 30;
        raw[base + 2] = 120;
      }
      // Add a second loop-de-loop squiggle for extra non-blank bytes
      const onSquiggle =
        Math.abs(
          y -
            Math.round(
              5 + 8 * Math.sin(x * 0.45 + 1.5) + 3 * Math.cos(x * 0.2)
            )
        ) <= 1;
      if (onSquiggle) {
        raw[base] = 80;
        raw[base + 1] = 10;
        raw[base + 2] = 10;
      }
    }
  }
  const compressed = deflateSync(raw, { level: 9 });

  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crcBuf = Buffer.alloc(4);
    const crcSource = Buffer.concat([typeBuf, data]);
    const crcVal = crc32(crcSource);
    crcBuf.writeUInt32BE(crcVal >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type = RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// CRC32 (zlib-like, PNG standard polynomial)
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return ~crc;
}

function pngToDataUrl(pngBuf: Buffer): string {
  return `data:image/png;base64,${pngBuf.toString("base64")}`;
}

// ---------------------------------------------------------------------------
// Direct Postgres access helper (for backdating rows to exercise housekeeping
// deletion path without waiting 24h)
// ---------------------------------------------------------------------------
async function backdateDownloadedAtForAll(daysAgo: number): Promise<number> {
  const pool = new Pool({ connectionString: POSTGRES_URL });
  try {
    const then = new Date();
    then.setUTCDate(then.getUTCDate() - daysAgo);
    const result = await pool.query(
      `UPDATE signed_waiver SET downloaded_at = $1 WHERE downloaded_at IS NOT NULL`,
      [then]
    );
    return result.rowCount ?? 0;
  } finally {
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// Main test flow
// ---------------------------------------------------------------------------
async function main() {
  log(`Cloud Waiver App — end-to-end smoke run`);
  log(`Target: ${BASE_URL}`);
  log(`Postgres: ${POSTGRES_URL.replace(/:([^:@]+)@/, ":***@")}`);
  log(`Bearer token length: ${TOKEN.length}`);

  // Build fixtures
  log("Building DOCX v1 fixture...");
  const docxV1 = await buildDocxBuffer(1);
  log(`DOCX v1: ${docxV1.length} bytes (sha1=${sha1(docxV1).slice(0, 12)})`);
  log("Building DOCX v2 fixture...");
  const docxV2 = await buildDocxBuffer(2);
  log(`DOCX v2: ${docxV2.length} bytes (sha1=${sha1(docxV2).slice(0, 12)})`);
  log("Building signature PNG fixture...");
  const sigPng = buildSignaturePng();
  log(
    `Signature PNG: ${sigPng.length} bytes (sha1=${sha1(sigPng).slice(0, 12)})`
  );
  assert(
    sigPng.length >= 120,
    `PNG fixture too small: ${sigPng.length} < 120`
  );
  const sigDataUrl = pngToDataUrl(sigPng);
  log(`PNG data URL length: ${sigDataUrl.length}`);

  // Wait for Next server
  log("Waiting for Next.js server...");
  await waitForServer();
  log("Server is up.");

  // -------------------------------------------------------------------------
  // STEP 1: Unauthorized access -> 401 on protected endpoints
  // -------------------------------------------------------------------------
  await step("Unauth GET /api/signed-waivers -> 401", async () => {
    await http("GET", "/api/signed-waivers", { expectStatus: 401 });
  });
  await step("Unauth POST /api/signed-waivers/download -> 401", async () => {
    await http("POST", "/api/signed-waivers/download", {
      body: {},
      expectStatus: 401,
    });
  });
  await step("Unauth POST /api/waiver-types -> 401", async () => {
    const fd = new FormData();
    fd.set("name", "nope");
    await http("POST", "/api/waiver-types", {
      body: fd,
      expectStatus: 401,
    });
  });

  // -------------------------------------------------------------------------
  // STEP 2: Create waiver type via multipart upload
  // -------------------------------------------------------------------------
  let createdId = "";
  let createdSlug = "";
  let createdQrUrl = "";
  await step("POST /api/waiver-types -> 201 create Basketball Court v1", async () => {
    const fd = new FormData();
    fd.set("name", "Basketball Court");
    fd.set(
      "docx",
      new Blob([nodeBufferToArrayBuffer(docxV1)], {
        type:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
      "basketball-court-v1.docx"
    );
    const { status, data } = await http("POST", "/api/waiver-types", {
      headers: authHeaders(),
      body: fd,
      expectStatus: 201,
    });
    const d = data as Record<string, unknown>;
    assertEq(typeof d.id, "string", "response.id type");
    assertEq(typeof d.slug, "string", "response.slug type");
    assertEq(d.currentVersion, 1, "response.currentVersion");
    assertEq(d.name, "Basketball Court", "response.name");
    assertEq(d.slug, "basketball-court", "response.slug");
    assertEq(d.qrUrl, "/waiver/basketball-court", "response.qrUrl");
    assertEq(typeof d.docxUrl, "string", "response.docxUrl type");
    assert((d.docxUrl as string).length > 0, "docxUrl not empty");
    createdId = d.id as string;
    createdSlug = d.slug as string;
    createdQrUrl = d.qrUrl as string;
  });

  // -------------------------------------------------------------------------
  // STEP 3: GET /waiver/{slug} landing page renders provisions
  // -------------------------------------------------------------------------
  await step("GET /waiver/basketball-court renders provisions HTML", async () => {
    const { status, data } = await http("GET", createdQrUrl, {
      expectStatus: 200,
    });
    const html = data as string;
    assert(
      html.includes("Basketball Court Liability Waiver"),
      "Page HTML does not contain rendered waiver title from DOCX"
    );
    assert(
      html.includes("I Accept"),
      'Page HTML does not contain "I Accept" checkbox label'
    );
    assert(
      html.includes('name="signerName"') ||
        html.includes("signerName") ||
        html.includes("Name"),
      "Page HTML does not contain name field"
    );
  });

  await step("GET /waiver/does-not-exist -> 404 friendly message", async () => {
    const { status, data } = await http("GET", "/waiver/does-not-exist-xyz", {
      expectStatus: 404,
    });
    const html = data as string;
    assert(
      html.includes("This waiver link is not valid"),
      "404 page missing exact copy: 'This waiver link is not valid'"
    );
  });

  // -------------------------------------------------------------------------
  // STEP 4: First sign -> success
  // -------------------------------------------------------------------------
  let firstSignedId = "";
  await step(
    "POST /api/sign (Juan Dela Cruz, v1) -> 201 success with exact message",
    async () => {
      const { status, data } = await http("POST", "/api/sign", {
        body: {
          waiverTypeId: createdId,
          signerName: "Juan Dela Cruz",
          signatureDataUrl: sigDataUrl,
        },
        expectStatus: 201,
      });
      const d = data as Record<string, unknown>;
      assertEq(d.status, "success", "sign response status");
      assertEq(
        d.message,
        "Thank you, your waiver has been recorded.",
        "sign response message (exact)"
      );
      assertEq(typeof d.id, "string", "sign response id type");
      firstSignedId = d.id as string;
    }
  );

  // -------------------------------------------------------------------------
  // STEP 5: Duplicate sign (same name, same version, case-insensitive)
  // -------------------------------------------------------------------------
  await step(
    "POST /api/sign (Juan DELA CRUZ, v1) -> duplicate notice exact message",
    async () => {
      const { status, data } = await http("POST", "/api/sign", {
        body: {
          waiverTypeId: createdId,
          signerName: "Juan DELA CRUZ",
          signatureDataUrl: sigDataUrl,
        },
        expectStatus: 200,
      });
      const d = data as Record<string, unknown>;
      assertEq(d.status, "duplicate", "dup response status");
      assertEq(
        d.message,
        "User has already signed the same waiver before. No need to sign new one.",
        "dup response message (exact)"
      );
    }
  );

  // -------------------------------------------------------------------------
  // STEP 6: PUT new DOCX version bumps current_version to 2
  // -------------------------------------------------------------------------
  await step(
    `PUT /api/waiver-types/${createdId} uploads v2 DOCX -> currentVersion=2`,
    async () => {
      const fd = new FormData();
      fd.set(
        "docx",
        new Blob([nodeBufferToArrayBuffer(docxV2)], {
          type:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
        "basketball-court-v2.docx"
      );
      const { status, data } = await http(
        "PUT",
        `/api/waiver-types/${createdId}`,
        { headers: authHeaders(), body: fd, expectStatus: 200 }
      );
      const d = data as Record<string, unknown>;
      assertEq(d.currentVersion, 2, "version bumped to 2");
      assertEq(d.slug, createdSlug, "slug unchanged");
      assertEq(typeof d.docxUrl, "string", "docxUrl set");
    }
  );

  // -------------------------------------------------------------------------
  // STEP 7: Same signer after version bump -> new record (NOT duplicate)
  // -------------------------------------------------------------------------
  let secondSignedId = "";
  await step(
    "POST /api/sign (Juan Dela Cruz, v2) -> 201 NEW record (version bump resets duplicate scope)",
    async () => {
      const { status, data } = await http("POST", "/api/sign", {
        body: {
          waiverTypeId: createdId,
          signerName: "Juan Dela Cruz",
          signatureDataUrl: sigDataUrl,
        },
        expectStatus: 201,
      });
      const d = data as Record<string, unknown>;
      assertEq(d.status, "success", "v2 sign status");
      assertEq(
        d.message,
        "Thank you, your waiver has been recorded.",
        "v2 sign success message exact"
      );
      secondSignedId = d.id as string;
      assert(
        secondSignedId !== firstSignedId,
        "v2 sign must return a NEW id (different from v1 sign id)"
      );
    }
  );

  // -------------------------------------------------------------------------
  // STEP 8: GET /api/signed-waivers lists both rows (v1 + v2, same name)
  // -------------------------------------------------------------------------
  let listCount = 0;
  await step("GET /api/signed-waivers returns 2 rows with correct JSON shape", async () => {
    const { status, data } = await http("GET", "/api/signed-waivers", {
      headers: authHeaders(),
      expectStatus: 200,
    });
    const arr = data as Array<Record<string, unknown>>;
    assertEq(arr.length, 2, "list count = 2");
    for (const row of arr) {
      assertEq(typeof row.id, "string", "row.id");
      assertEq(row.waiverType, "Basketball Court", "row.waiverType");
      assertEq(row.signerName, "Juan Dela Cruz", "row.signerName");
      assert(
        row.version === 1 || row.version === 2,
        `row.version in {1,2}, got ${row.version}`
      );
      assertEq(typeof row.signedAt, "string", "row.signedAt type");
      // signedAt must parse as valid ISO
      const t = new Date(row.signedAt as string).getTime();
      assert(Number.isFinite(t), `row.signedAt parseable (got ${row.signedAt})`);
    }
    listCount = arr.length;
  });

  // -------------------------------------------------------------------------
  // STEP 9: GET date filter (today) returns 2; date filter (1999-01-01) returns 0
  // -------------------------------------------------------------------------
  await step("GET /api/signed-waivers?date=1999-01-01 returns 0 rows", async () => {
    const { data } = await http(
      "GET",
      "/api/signed-waivers?date=1999-01-01",
      { headers: authHeaders(), expectStatus: 200 }
    );
    assertEq((data as unknown[]).length, 0, "ancient date filter empty");
  });

  await step("GET /api/signed-waivers with date+from -> 400 (disallowed combo)", async () => {
    await http("GET", "/api/signed-waivers?date=2026-01-01&from=2026-01-02", {
      headers: authHeaders(),
      expectStatus: 400,
    });
  });

  // -------------------------------------------------------------------------
  // STEP 10: POST /api/signed-waivers/download (no filters) -> 2 rows with base64 sigs + marks downloaded
  // -------------------------------------------------------------------------
  let downloadSigs: string[] = [];
  await step(
    "POST /api/signed-waivers/download (no filters) -> 2 rows with non-empty signatureImageBase64, idempotency: first download only",
    async () => {
      const { data } = await http(
        "POST",
        "/api/signed-waivers/download",
        {
          headers: authHeaders({ "content-type": "application/json" }),
          body: {},
          expectStatus: 200,
        }
      );
      const arr = data as Array<Record<string, unknown>>;
      assertEq(arr.length, 2, "first download count = 2");
      for (const row of arr) {
        assertEq(typeof row.id, "string", "download row.id");
        assertEq(row.waiverType, "Basketball Court", "download row.waiverType");
        assertEq(row.signerName, "Juan Dela Cruz", "download row.signerName");
        const b64 = row.signatureImageBase64 as string;
        assertEq(typeof b64, "string", "signatureImageBase64 type");
        assert(b64.length > 120, "signatureImageBase64 > 120 chars");
        // Round-trip: base64 -> bytes -> PNG magic
        const bytes = Buffer.from(b64, "base64");
        assert(
          bytes[0] === 0x89 &&
            bytes[1] === 0x50 &&
            bytes[2] === 0x4e &&
            bytes[3] === 0x47,
          "downloaded signature bytes are a valid PNG (magic match)"
        );
        downloadSigs.push(b64);
      }
    }
  );

  // STEP 11: Second download with same filters returns 0 (already downloaded)
  await step(
    "POST /api/signed-waivers/download second time (no filters, no includeDownloaded) -> 0 rows",
    async () => {
      const { data } = await http(
        "POST",
        "/api/signed-waivers/download",
        {
          headers: authHeaders({ "content-type": "application/json" }),
          body: {},
          expectStatus: 200,
        }
      );
      assertEq((data as unknown[]).length, 0, "second download count = 0");
    }
  );

  // STEP 12: Explicit ids override — download the same ids again
  await step(
    "POST /api/signed-waivers/download with explicit ids=[id1,id2] -> 2 rows (explicit ids override downloaded=true)",
    async () => {
      const { data } = await http(
        "POST",
        "/api/signed-waivers/download",
        {
          headers: authHeaders({ "content-type": "application/json" }),
          body: { ids: [firstSignedId, secondSignedId] },
          expectStatus: 200,
        }
      );
      const arr = data as Array<Record<string, unknown>>;
      assertEq(arr.length, 2, "explicit-ids download count = 2");
      const returnedIds = arr.map((r) => r.id).sort();
      const expectedIds = [firstSignedId, secondSignedId].sort();
      assertEq(
        JSON.stringify(returnedIds),
        JSON.stringify(expectedIds),
        "explicit ids matched exactly"
      );
    }
  );

  // -------------------------------------------------------------------------
  // STEP 13: Housekeeping
  // -------------------------------------------------------------------------
  await step(
    "POST /api/housekeeping retentionDays=0 -> 0 deletes (downloaded_at is not before today 00:00 UTC)",
    async () => {
      const { data } = await http("POST", "/api/housekeeping", {
        headers: authHeaders({ "content-type": "application/json" }),
        body: { retentionDays: 0 },
        expectStatus: 200,
      });
      const d = data as Record<string, unknown>;
      assertEq(typeof d.deletedCount, "number", "deletedCount type");
      assertEq(d.deletedCount, 0, "retentionDays=0 deletedCount = 0");
    }
  );

  await step(
    "POST /api/housekeeping retentionDays=36500 (100 years) -> 0 deletes (downloaded_at still not older)",
    async () => {
      const { data } = await http("POST", "/api/housekeeping", {
        headers: authHeaders({ "content-type": "application/json" }),
        body: { retentionDays: 36500 },
        expectStatus: 200,
      });
      const d = data as Record<string, unknown>;
      assertEq(d.deletedCount, 0, "retentionDays=36500 deletedCount = 0");
    }
  );

  // Backdate downloaded_at 5 days for all rows, then retentionDays=2 should delete all
  await step(
    "Backdate downloaded_at 5 days via direct SQL -> housekeeping retentionDays=2 deletes 2 rows",
    async () => {
      const updated = await backdateDownloadedAtForAll(5);
      log(`Backdated ${updated} row(s) downloaded_at -> 5 days ago.`);
      assertEq(updated, 2, "backdated rows = 2");
      const { data } = await http("POST", "/api/housekeeping", {
        headers: authHeaders({ "content-type": "application/json" }),
        body: { retentionDays: 2 },
        expectStatus: 200,
      });
      const d = data as Record<string, unknown>;
      assertEq(d.deletedCount, 2, "retentionDays=2 deletedCount = 2");
      // Confirm GET now shows 0 rows
      const { data: listAfter } = await http(
        "GET",
        "/api/signed-waivers",
        { headers: authHeaders(), expectStatus: 200 }
      );
      assertEq(
        (listAfter as unknown[]).length,
        0,
        "housekeeping ran; signed-waivers list now empty"
      );
    }
  );

  await step("POST /api/housekeeping retentionDays='abc' -> 400", async () => {
    await http("POST", "/api/housekeeping", {
      headers: authHeaders({ "content-type": "application/json" }),
      body: { retentionDays: "abc" as unknown as number },
      expectStatus: 400,
    });
  });

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  const passed = STEP_RESULTS.filter((r) => r.passed).length;
  const total = STEP_RESULTS.length;
  const failed = STEP_RESULTS.filter((r) => !r.passed);
  log("================================================================");
  log(`SMOKE SUMMARY: ${passed}/${total} passed`);
  if (failed.length) {
    log("FAILURES:");
    for (const f of failed) {
      log(`  - ${f.name}` + (f.detail ? ` :: ${f.detail}` : ""));
    }
  }
  log("================================================================");
  process.exitCode = failed.length === 0 ? 0 : 1;
}

function sha1(buf: Buffer): string {
  return createHash("sha1").update(buf).digest("hex");
}

main().catch((e) => {
  log(`FATAL: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exitCode = 2;
});
