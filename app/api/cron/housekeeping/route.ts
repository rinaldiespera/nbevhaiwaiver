import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const REQUIRED_CRON_SECRET_HEADER = "x-vercel-cron-secret";

function envStr(k: string, fallback = ""): string {
  const v = process.env[k];
  return v != null && v !== "" ? v : fallback;
}

const CRON_INTERNAL_BEARER_FALLBACK =
  envStr("WAIVER_CRON_INTERNAL_BEARER") ||
  envStr("API_BEARER_TOKEN");

/**
 * Vercel CRON route: /api/cron/housekeeping (public path, authenticated via
 * Vercel-signed x-vercel-cron-secret header). Validates that header matches
 * the server CRON_SECRET and re-dispatches to the normal housekeeping POST
 * with triggerType=CRON_VERCEL using an in-process HTTP call to localhost.
 */
export async function GET(req: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET || "";
  if (expectedSecret) {
    const actual = req.headers.get(REQUIRED_CRON_SECRET_HEADER) || "";
    if (!actual || actual.length < expectedSecret.length) {
      return NextResponse.json(
        { error: "Unauthorized cron call." },
        { status: 401 }
      );
    }
    const a = new TextEncoder().encode(actual);
    const b = new TextEncoder().encode(expectedSecret);
    if (a.length !== b.length) {
      return NextResponse.json(
        { error: "Unauthorized cron call." },
        { status: 401 }
      );
    }
    let mismatched = 0;
    for (let i = 0; i < a.length; i++) mismatched |= a[i] ^ b[i];
    if (mismatched !== 0) {
      return NextResponse.json(
        { error: "Unauthorized cron call." },
        { status: 401 }
      );
    }
  } else if (envStr("NODE_ENV") === "production") {
    // In production we strongly require a CRON_SECRET; otherwise an attacker
    // can spam this endpoint.
    return NextResponse.json(
      { error: "CRON_SECRET not configured on server." },
      { status: 500 }
    );
  }

  const selfBase =
    envStr("WAIVER_PUBLIC_BASE_URL") ||
    envStr("NEXT_PUBLIC_APP_URL") ||
    "http://localhost:3000";
  const url = `${selfBase.replace(/\/$/, "")}/api/housekeeping`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(CRON_INTERNAL_BEARER_FALLBACK
          ? { authorization: `Bearer ${CRON_INTERNAL_BEARER_FALLBACK}` }
          : {}),
      },
      body: JSON.stringify({ triggerType: "CRON_VERCEL" }),
      cache: "no-store",
    });
    const text = await res.text();
    const json = (() => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    })();
    if (res.ok) {
      return NextResponse.json(
        json ?? { status: "OK", body: text },
        { status: 200 }
      );
    }
    return NextResponse.json(
      json ?? { error: text, httpStatus: res.status },
      { status: res.status >= 400 && res.status < 600 ? res.status : 502 }
    );
  } catch (e) {
    return NextResponse.json(
      {
        error:
          "Cron dispatcher failed: " +
          ((e as any)?.message ?? String(e)),
      },
      { status: 502 }
    );
  }
}
