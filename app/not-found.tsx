export default function NotFound() {
  return (
    <main className="w-full min-h-screen flex items-center justify-center px-[clamp(12px,4vw,32px)]">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-[clamp(20px,5vw,32px)] text-center shadow-sm">
        <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-7 w-7 text-slate-500"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h1 className="text-[clamp(1.25rem,4vw,1.75rem)] font-semibold mb-2 text-slate-900">
          This waiver link is not valid
        </h1>
        <p className="text-slate-600 mb-6 text-[clamp(0.95rem,2.5vw,1.05rem)]">
          The QR code or URL you used does not match an active waiver. Please
          scan the printed QR code at the facility, or contact the HOA
          administrator for the correct link.
        </p>
      </div>
    </main>
  );
}
