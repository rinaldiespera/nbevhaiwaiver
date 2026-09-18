"use client";

import { useRef, useState } from "react";
import { clsx } from "clsx";
import { SignaturePad, type SignaturePadHandle } from "./SignaturePad";

export interface SigningFormProps {
  waiverTypeId: string;
  currentVersion: number;
  waiverTypeName: string;
  accessHash: string | null;
}

type SubmitStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; message: string }
  | { kind: "duplicate"; message: string }
  | { kind: "error"; message: string };

const SUCCESS_MSG = "Thank you, your waiver has been recorded.";
const DUPLICATE_MSG =
  "User has already signed the same waiver before. No need to sign new one.";

export function SigningForm({
  waiverTypeId,
  currentVersion: _currentVersion,
  waiverTypeName: _waiverTypeName,
  accessHash,
}: SigningFormProps) {
  const [accepted, setAccepted] = useState(false);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [sigError, setSigError] = useState<string | null>(null);
  const [status, setStatus] = useState<SubmitStatus>({ kind: "idle" });
  const sigRef = useRef<SignaturePadHandle | null>(null);

  const canSubmit =
    accepted && name.trim().length > 0 && status.kind !== "loading";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setNameError(null);
    setSigError(null);

    if (!accepted) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("Please enter your name.");
      return;
    }
    const sigEmpty = sigRef.current?.isEmpty() ?? true;
    if (sigEmpty) {
      setSigError("Please provide your signature.");
      return;
    }
    const dataUrl = sigRef.current!.toDataURL();

    setStatus({ kind: "loading" });
    try {
      const res = await fetch("/api/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          waiverTypeId,
          signerName: trimmedName,
          signatureDataUrl: dataUrl,
          accessHash: accessHash ?? undefined,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof payload?.error === "string"
            ? payload.error
            : `Submission failed (HTTP ${res.status})`;
        setStatus({ kind: "error", message: msg });
        return;
      }
      const s: unknown = payload?.status;
      const m: unknown = payload?.message;
      if (s === "success") {
        setStatus({
          kind: "success",
          message: typeof m === "string" ? m : SUCCESS_MSG,
        });
      } else if (s === "duplicate") {
        setStatus({
          kind: "duplicate",
          message: typeof m === "string" ? m : DUPLICATE_MSG,
        });
      } else {
        setStatus({
          kind: "error",
          message: "Unexpected server response. Please try again.",
        });
      }
    } catch (err) {
      setStatus({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Network error. Please try again.",
      });
    }
  }

  if (status.kind === "success") {
    return (
      <ResultBanner
        tone="success"
        title="Submission received"
        message={status.message}
      />
    );
  }
  if (status.kind === "duplicate") {
    return (
      <ResultBanner
        tone="neutral"
        title="Already signed"
        message={status.message}
      />
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="w-full space-y-5 mt-6">
      <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-500 transition">
        <input
          type="checkbox"
          id="accept-terms"
          className="mt-1 h-5 w-5 accent-brand-600 shrink-0"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
        />
        <span className="text-[clamp(0.95rem,2.5vw,1.05rem)] leading-6 text-slate-800">
          I have read and accept the terms above.
        </span>
      </label>

      <div>
        <label
          htmlFor="signer-name"
          className="block mb-1.5 font-medium text-slate-800 text-[clamp(0.9rem,2.4vw,1rem)]"
        >
          Your Full Name
        </label>
        <input
          id="signer-name"
          type="text"
          autoComplete="name"
          inputMode="text"
          placeholder="e.g. Juan Dela Cruz"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!accepted}
          aria-invalid={!!nameError}
          className={clsx(
            "w-full min-h-[44px] rounded-lg border px-3.5 py-2.5 text-[clamp(0.95rem,2.6vw,1.05rem)] bg-white shadow-sm transition",
            "focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500",
            nameError
              ? "border-danger-500 focus:ring-danger-500 focus:border-danger-500"
              : "border-slate-300",
            !accepted ? "bg-slate-100 text-slate-400 cursor-not-allowed" : ""
          )}
        />
        {nameError ? (
          <p className="mt-1 text-sm text-danger-600">{nameError}</p>
        ) : null}
        {!accepted ? (
          <p className="mt-1 text-sm text-slate-500">
            Check &quot;I Accept&quot; above before entering your name.
          </p>
        ) : null}
      </div>

      <div>
        <div className="flex items-end justify-between mb-1.5">
          <label
            htmlFor="sig-pad"
            className="font-medium text-slate-800 text-[clamp(0.9rem,2.4vw,1rem)]"
          >
            Signature
          </label>
          {accepted ? (
            <button
              type="button"
              onClick={() => {
                sigRef.current?.clear();
                setSigError(null);
              }}
              className="min-h-[36px] px-3 py-1 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-100 border border-slate-200"
            >
              Clear
            </button>
          ) : null}
        </div>
        <div id="sig-pad">
          <SignaturePad
            ref={sigRef}
            disabled={!accepted}
            className={clsx(
              "w-full aspect-[2/1] max-h-[200px] bg-white rounded-lg border overflow-hidden touch-none select-none",
              sigError ? "border-danger-500 ring-1 ring-danger-500" : "border-slate-300",
              !accepted ? "opacity-60" : "shadow-sm"
            )}
          />
        </div>
        {sigError ? (
          <p className="mt-1 text-sm text-danger-600">{sigError}</p>
        ) : null}
        {!accepted ? (
          <p className="mt-1 text-sm text-slate-500">
            Check &quot;I Accept&quot; above to enable the signature pad.
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-500">
            Sign using your finger or mouse inside the box above.
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className={clsx(
          "w-full min-h-[48px] rounded-lg font-semibold text-white transition",
          "text-[clamp(1rem,2.8vw,1.1rem)]",
          canSubmit
            ? "bg-brand-600 hover:bg-brand-700 active:bg-brand-700 shadow-sm"
            : "bg-slate-300 text-slate-500 cursor-not-allowed"
        )}
      >
        {status.kind === "loading" ? "Submitting…" : "Submit Waiver"}
      </button>

      {status.kind === "error" ? (
        <div className="rounded-lg border border-danger-500 bg-danger-50 p-3 text-danger-700 text-sm">
          {status.message}
        </div>
      ) : null}
    </form>
  );
}

function ResultBanner({
  tone,
  title,
  message,
}: {
  tone: "success" | "neutral";
  title: string;
  message: string;
}) {
  return (
    <div
      className={clsx(
        "mt-6 rounded-2xl border p-5 text-center shadow-sm",
        tone === "success"
          ? "border-success-500 bg-success-50"
          : "border-slate-200 bg-white"
      )}
      role="status"
      aria-live="polite"
    >
      <div
        className={clsx(
          "mx-auto mb-3 inline-flex h-14 w-14 items-center justify-center rounded-full",
          tone === "success" ? "bg-white" : "bg-slate-100"
        )}
      >
        {tone === "success" ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-8 w-8 text-success-500"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
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
        )}
      </div>
      <h2
        className={clsx(
          "text-[clamp(1.1rem,3.2vw,1.35rem)] font-semibold mb-1",
          tone === "success" ? "text-success-700" : "text-slate-800"
        )}
      >
        {title}
      </h2>
      <p
        className={clsx(
          "text-[clamp(0.95rem,2.5vw,1.05rem)]",
          tone === "success" ? "text-success-700" : "text-slate-700"
        )}
      >
        {message}
      </p>
    </div>
  );
}
