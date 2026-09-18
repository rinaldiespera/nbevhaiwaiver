import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  getCachedHtml,
  makeCacheKey,
  convertDocxToHtml,
  setCachedHtml,
} from "@/lib/docx";
import { getFileAsBase64 } from "@/lib/blob";
import { SigningForm } from "@/components/SigningForm";
import { clsx } from "clsx";
import { validateWaiverAccess, ENV } from "@/lib/access";
import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVISIONS_HTML_FALLBACK =
  '<p class="empty"><em>Waiver provisions are not currently available for this facility. Please contact the administrator.</em></p>';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function InvalidQrPage({ reason }: { reason: string }) {
  let title = "This waiver QR code is not valid";
  let body =
    "The QR or link you used does not match an active waiver. Please scan the printed QR code at the facility, or contact the HOA administrator for the correct link.";
  if (reason === "missing") {
    title = "This waiver link requires a QR security code";
    body =
      "The link you used is missing the required security code appended by the printed QR. Please scan the posted QR at the facility to open the correct sign page.";
  }
  if (reason === "mismatch") {
    title = "This waiver QR security code does not match";
    body =
      "The QR you scanned may have been tampered with, or the shared secret used to mint it has been rotated. Please use the latest printed QR at the facility.";
  }
  if (reason === "bad-format") {
    title = "This waiver QR security code is malformed";
    body =
      "The security code attached to the link is not in the expected format. Re-scan the printed QR at the facility.";
  }
  return (
    <main className="w-full min-h-screen flex items-center justify-center px-[clamp(12px,4vw,32px)] bg-slate-50">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-[clamp(20px,5vw,32px)] text-center shadow-sm">
        <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-7 w-7 text-amber-600"
            aria-hidden="true"
          >
            <path d="M12 2 2 22h20L12 2z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <h1 className="text-[clamp(1.25rem,4vw,1.75rem)] font-semibold mb-2 text-slate-900">
          {title}
        </h1>
        <p className="text-slate-600 mb-6 text-[clamp(0.95rem,2.5vw,1.05rem)]">
          {body}
        </p>
        <Link
          href="/"
          className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}

export default async function WaiverPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = (await searchParams) ?? {};
  const hRaw = sp.h;
  const h = Array.isArray(hRaw) ? hRaw[0] : hRaw;

  const matches = await db
    .select()
    .from(schema.waiverType)
    .where(eq(schema.waiverType.slug, slug))
    .limit(1);

  if (matches.length === 0) {
    notFound();
  }

  const wt = matches[0];
  const access = validateWaiverAccess(wt.slug, wt.id, h);
  if (!access.valid) {
    return <InvalidQrPage reason={access.reason} />;
  }

  const cacheKey = makeCacheKey(wt.id, wt.currentVersion);
  let html = getCachedHtml(cacheKey);
  let cacheMiss = false;
  if (!html) {
    cacheMiss = true;
    try {
      const b64 = await getFileAsBase64(wt.docxUrl);
      const buffer = Buffer.from(b64, "base64");
      const converted = await convertDocxToHtml(buffer);
      html = converted.html;
      setCachedHtml(cacheKey, html);
    } catch {
      html = PROVISIONS_HTML_FALLBACK;
    }
  }

  return (
    <main className="w-full mx-auto max-w-3xl px-[clamp(12px,4vw,32px)] py-[clamp(20px,5vw,40px)]">
      <header className="mb-5">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-2">
          NBEVHAI Liability Waiver
        </p>
        <h1 className="text-[clamp(1.4rem,5vw,2rem)] font-bold text-slate-900 leading-tight">
          {wt.name}
        </h1>
        <p className="text-slate-500 mt-1 text-[clamp(0.85rem,2.2vw,0.95rem)]">
          Version {wt.currentVersion} • last updated{" "}
          {new Date(wt.updatedAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
          {access.mode === "bypass" && !ENV.WAIVER_HASH_REQUIRED ? (
            <>
              {" • "}
              <span className="text-amber-700">
                Unsecured access enabled (transition mode)
              </span>
            </>
          ) : null}
          {cacheMiss ? (
            <> </>
          ) : null}
        </p>
      </header>

      <section
        aria-label="Waiver provisions"
        className="rounded-xl border border-slate-200 bg-white shadow-sm"
      >
        <div
          className={clsx(
            "px-[clamp(14px,4vw,24px)] py-[clamp(14px,4vw,22px)]",
            "overflow-y-auto prose-waiver text-slate-800",
            "border-b border-slate-100"
          )}
          style={{ maxHeight: "min(55vh, 600px)" }}
        >
          <div
            className="prose-contents"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </section>

      <SigningForm
        waiverTypeId={wt.id}
        currentVersion={wt.currentVersion}
        waiverTypeName={wt.name}
        accessHash={h ?? null}
      />

      <footer className="mt-10 text-center text-xs text-slate-400">
        Securely submitted • NBEVHAI
      </footer>
    </main>
  );
}
