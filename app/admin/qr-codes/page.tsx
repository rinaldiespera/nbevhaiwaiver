"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";

type WaiverTypeRow = {
  id: string;
  name: string;
  slug: string;
  currentVersion: number;
  docxUrl: string;
  createdAt: string;
  updatedAt: string;
  qrUrl: string;
  signedQrRelativeUrl?: string;
  signedQrFullUrl?: string;
};

function TokenForm({ onSubmit }: { onSubmit: (token: string) => void }) {
  const [val, setVal] = useState("");
  return (
    <form
      className="mx-auto mt-8 w-full max-w-xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(val.trim());
      }}
    >
      <h2 className="text-xl font-semibold text-slate-900">
        Office Admin: Printable QR Codes
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        Enter the shared API bearer token (the same one the Neighborly platform
        uses) to load the list of waiver types and their scannable QR codes.
      </p>
      <label
        htmlFor="bearerToken"
        className="mt-4 block text-sm font-medium text-slate-700"
      >
        API Bearer Token
      </label>
      <input
        id="bearerToken"
        name="bearerToken"
        type="password"
        autoComplete="off"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="paste the shared token here"
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        required
      />
      <button
        type="submit"
        className="mt-4 inline-flex h-11 items-center justify-center rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
      >
        Load QR Codes
      </button>
      <p className="mt-4 text-xs text-slate-500">
        The token is only sent to this app&apos;s own server (localhost or your
        deployed domain) — never to any third party.
      </p>
    </form>
  );
}

function QrCard({
  row,
  absoluteBase,
}: {
  row: WaiverTypeRow;
  absoluteBase: string;
}) {
  const fullUrl = useMemo(() => {
    if (typeof row.signedQrFullUrl === "string" && row.signedQrFullUrl.length > 0) {
      const serverBase = row.signedQrFullUrl.split("/waiver/")[0];
      if (serverBase && serverBase !== absoluteBase.replace(/\/+$/, "")) {
        const rel = row.signedQrFullUrl.slice(serverBase.length);
        return `${absoluteBase.replace(/\/+$/, "")}${rel}`;
      }
      return row.signedQrFullUrl;
    }
    if (typeof row.signedQrRelativeUrl === "string" && row.signedQrRelativeUrl.length > 0) {
      const base = absoluteBase.replace(/\/+$/, "");
      const rel = row.signedQrRelativeUrl.replace(/^\/+/, "");
      return `${base}/${rel}`;
    }
    const base = absoluteBase.replace(/\/+$/, "");
    const rel = row.qrUrl.replace(/^\/+/, "");
    return `${base}/${rel}`;
  }, [absoluteBase, row]);

  const [pngDataUrl, setPngDataUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(fullUrl, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 512,
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setPngDataUrl(url);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [fullUrl]);

  return (
    <article
      className="qr-card flex w-full flex-col items-center justify-start gap-3 break-inside-avoid rounded-xl border border-slate-200 bg-white p-5 shadow-sm print:break-after-page print:border-0 print:shadow-none"
      aria-label={`QR code for ${row.name}`}
    >
      <header className="w-full text-center">
        <h3 className="text-xl font-bold text-slate-900 sm:text-2xl">
          {row.name}
        </h3>
        <p className="mt-1 text-xs uppercase tracking-wider text-slate-500">
          NBEVHAI Waiver &middot; v{row.currentVersion}
        </p>
      </header>

      <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
        {err ? (
          <div className="flex h-[256px] w-[256px] items-center justify-center text-xs text-red-600">
            QR render failed: {err}
          </div>
        ) : pngDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={pngDataUrl}
            alt={`QR code linking to the ${row.name} waiver sign page`}
            className="h-[256px] w-[256px] object-contain"
            draggable={false}
          />
        ) : (
          <div className="h-[256px] w-[256px] animate-pulse rounded bg-slate-100" />
        )}
      </div>

      <div className="w-full space-y-2 text-center">
        <p className="text-sm font-medium text-slate-800">
          Scan this QR code to open the waiver form, or tap the link below:
        </p>
        <a
          href={fullUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="block break-all rounded-md bg-slate-50 px-3 py-2 font-mono text-xs text-blue-800 ring-1 ring-slate-200 hover:bg-blue-50"
        >
          {fullUrl}
        </a>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(fullUrl);
            } catch {
              /* ignore */
            }
          }}
          className="mt-2 inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        >
          Copy link to clipboard
        </button>
      </div>

      <footer className="w-full pt-2 text-center text-[11px] leading-snug text-slate-500">
        Printed for office-counter display &middot; Waiver app will show the
        full waiver text, an &quot;I Accept&quot; checkbox, and a signature
        pad.
      </footer>
    </article>
  );
}

export default function AdminQrCodesPage() {
  const DEV_TOKEN_AUTO = "__dev_noop_bearer_token__";
  const [token, setToken] = useState<string | null>(null);
  const [authDisabled, setAuthDisabled] = useState<boolean | null>(null);
  const [rows, setRows] = useState<WaiverTypeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [absoluteBase, setAbsoluteBase] = useState<string>(() =>
    typeof window !== "undefined"
      ? window.location.origin
      : ""
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/waiver-types", { cache: "no-store" });
        if (res.ok) {
          if (cancelled) return;
          setAuthDisabled(true);
          setToken(DEV_TOKEN_AUTO);
          const data = (await res.json()) as WaiverTypeRow[];
          setRows(Array.isArray(data) ? data : []);
          setError(null);
        } else if (res.status === 401) {
          if (cancelled) return;
          setAuthDisabled(false);
        } else {
          if (cancelled) return;
          setAuthDisabled(false);
          setError(`Probe failed (HTTP ${res.status}).`);
        }
      } catch (e) {
        if (cancelled) return;
        setAuthDisabled(false);
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    const sendToken = token === DEV_TOKEN_AUTO ? null : token;
    let cancelled = false;
    (async () => {
      try {
        const init: RequestInit = { cache: "no-store" };
        if (sendToken) {
          init.headers = { Authorization: `Bearer ${sendToken}` };
        }
        const res = await fetch("/api/waiver-types", init);
        if (!res.ok) {
          if (res.status === 401) throw new Error("Token not accepted (HTTP 401 Unauthorized).");
          throw new Error(`Server returned HTTP ${res.status}.`);
        }
        const data = (await res.json()) as WaiverTypeRow[];
        if (!cancelled) {
          setRows(Array.isArray(data) ? data : []);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setRows(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (authDisabled === null) {
    return (
      <div className="mx-auto mt-10 max-w-xl rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-600 shadow-sm">
        Checking admin access mode…
      </div>
    );
  }

  if (!token) {
    return <TokenForm onSubmit={setToken} />;
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
            Office QR Codes
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Print this page and post it at the office counter. Players scan the
            code for the facility they are using and are taken directly to that
            waiver&apos;s accept + sign page.
            {authDisabled ? (
              <span className="block mt-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800">
                Dev-only: Admin API auth is currently disabled in this
                environment. Token form skipped. Re-enable by setting
                ADMIN_API_AUTH_REQUIRED=true in production.
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label
            htmlFor="baseUrl"
            className="text-xs font-medium text-slate-600"
          >
            Base URL printed on QR codes:
          </label>
          <input
            id="baseUrl"
            type="url"
            value={absoluteBase}
            onChange={(e) => setAbsoluteBase(e.target.value)}
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 font-mono text-xs text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 sm:w-80"
          />
          {!authDisabled ? (
            <button
              type="button"
              onClick={() => {
                if (typeof window === "undefined") return;
                setToken(null);
                setRows(null);
                setError(null);
              }}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              Sign out token
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => window.print()}
            className="h-10 rounded-md bg-blue-700 px-4 text-xs font-semibold text-white shadow-sm hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            Print this page
          </button>
        </div>
      </header>

      {error ? (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {rows === null && !error ? (
        <div className="mt-8 rounded-md border border-slate-200 bg-white p-8 text-center text-sm text-slate-600 shadow-sm">
          Loading waiver types…
        </div>
      ) : null}

      {Array.isArray(rows) && rows.length === 0 ? (
        <div className="mt-8 rounded-md border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-900">
          No waiver types exist yet. Use the Neighborly-integration API
          (&nbsp;<code className="rounded bg-amber-100 px-1 py-0.5 text-[11px]">POST /api/waiver-types</code>&nbsp;)
          to create at least one, then come back here to print QR codes.
        </div>
      ) : null}

      {Array.isArray(rows) && rows.length > 0 ? (
        <section className="mt-8 grid w-full grid-cols-1 items-start gap-6 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-2 print:gap-10">
          {rows.map((r) => (
            <QrCard key={r.id} row={r} absoluteBase={absoluteBase} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
