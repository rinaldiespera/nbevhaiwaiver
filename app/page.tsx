import Link from "next/link";

export default function HomePage() {
  return (
    <main className="w-full px-[clamp(12px,4vw,32px)] py-[clamp(24px,6vw,48px)] mx-auto max-w-3xl">
      <header className="mb-8">
        <h1 className="text-[clamp(1.5rem,5vw,2.25rem)] font-bold tracking-tight text-slate-900 mb-2">
          NBEVHAI Waiver Signing
        </h1>
        <p className="text-slate-600 text-[clamp(0.95rem,2.5vw,1.05rem)]">
          Village homeowners association sports facility waiver portal.
        </p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-[clamp(16px,4vw,24px)] shadow-sm">
        <h2 className="text-lg font-semibold mb-3">For Players</h2>
        <p className="mb-4 text-slate-700">
          Scan the QR code posted at your facility. It will take you directly to
          the waiver for that court or field.
        </p>
        <p className="text-slate-500 text-sm">
          You can also test with the sample URLs below if the administrator has
          shared a direct link.
        </p>
      </section>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-[clamp(16px,4vw,24px)] shadow-sm">
        <h2 className="text-lg font-semibold mb-3">For Neighborly Integrators</h2>
        <ul className="list-disc pl-5 space-y-1.5 text-slate-700">
          <li>
            <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
              GET /api/signed-waivers
            </code>
            — list signed waivers.
          </li>
          <li>
            <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
              POST /api/signed-waivers/download
            </code>
            — download with signatures and mark as collected.
          </li>
          <li>
            <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
              POST /api/housekeeping
            </code>
            — purge old downloaded records.
          </li>
          <li>
            <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
              POST /api/waiver-types
            </code>
            {" / "}
            <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
              PUT /api/waiver-types/&#123;id&#125;
            </code>
            — manage waiver types and DOCX versions.
          </li>
        </ul>
        <p className="mt-4 text-sm text-slate-500">
          All API endpoints require a Bearer token via the{" "}
          <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">
            Authorization
          </code>{" "}
          header.
        </p>
        <p className="mt-4 text-sm">
          <Link
            className="text-brand-600 underline underline-offset-2 hover:text-brand-700"
            href="/waiver/example"
          >
            Open example waiver page
          </Link>
        </p>
      </section>

      <footer className="mt-10 text-center text-xs text-slate-400">
        Cloud-hosted waiver portal
      </footer>
    </main>
  );
}
