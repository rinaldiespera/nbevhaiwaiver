import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";

const HASH_SIG_HEX_LEN = 12;
const MIN_SECRET_LEN = 24;

function boolEnv(key: string, fallback = false): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const s = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}

export const ENV = {
  get WAIVER_HASH_REQUIRED(): boolean {
    return boolEnv("WAIVER_HASH_REQUIRED", true);
  },
  get ADMIN_API_AUTH_REQUIRED(): boolean {
    return boolEnv("ADMIN_API_AUTH_REQUIRED", false);
  },
  get WAIVER_HASH_SECRET(): string | undefined {
    const v = process.env.WAIVER_HASH_SECRET;
    return typeof v === "string" && v.length > 0 ? v : undefined;
  },
  get WAIVER_PUBLIC_BASE_URL(): string | undefined {
    const v =
      process.env.WAIVER_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
    return typeof v === "string" && v.length > 0 ? v.replace(/\/+$/, "") : undefined;
  },
  get API_BEARER_TOKEN(): string | undefined {
    const v = process.env.API_BEARER_TOKEN;
    return typeof v === "string" && v.length > 0 ? v : undefined;
  },
};

let envChecked = false;
export function assertRuntimeEnvSane(): void {
  if (envChecked) return;
  envChecked = true;
  const errs: string[] = [];

  if (!ENV.WAIVER_HASH_SECRET) {
    errs.push(
      "Env var WAIVER_HASH_SECRET must be set to a long random string (min 24 chars)."
    );
  } else if (ENV.WAIVER_HASH_SECRET.length < MIN_SECRET_LEN) {
    errs.push(
      `Env var WAIVER_HASH_SECRET must be at least ${MIN_SECRET_LEN} chars long (got ${ENV.WAIVER_HASH_SECRET.length}).`
    );
  }

  if (ENV.ADMIN_API_AUTH_REQUIRED) {
    if (!ENV.API_BEARER_TOKEN) {
      errs.push(
        "ADMIN_API_AUTH_REQUIRED=true but env var API_BEARER_TOKEN is not set."
      );
    } else if (ENV.API_BEARER_TOKEN.length < 8) {
      errs.push(
        "ADMIN_API_AUTH_REQUIRED=true but API_BEARER_TOKEN must be >=8 chars."
      );
    }
  }

  if (errs.length) {
    throw new Error(
      `[waiver-app] FATAL runtime configuration errors:\n  - ${errs.join("\n  - ")}`
    );
  }
}

try {
  assertRuntimeEnvSane();
} catch (e) {
  // eslint-disable-next-line no-console
  console.error((e as Error).message);
  throw e;
}

function hashPayload(slug: string, waiverTypeId: string): string {
  return `${slug}|${waiverTypeId}`;
}

function digest12(secret: string, payloadText: string): string {
  const full = createHmac("sha256", secret)
    .update(payloadText, "utf8")
    .digest("hex");
  return full.slice(0, HASH_SIG_HEX_LEN).toLowerCase();
}

export function signWaiverUrl(slug: string, waiverTypeId: string): string {
  assertRuntimeEnvSane();
  const secret = ENV.WAIVER_HASH_SECRET!;
  return digest12(secret, hashPayload(slug, waiverTypeId));
}

export function buildSignedWaiverQrUrl(
  slug: string,
  waiverTypeId: string,
  opts: { absolute?: boolean } = {}
): string {
  const h = signWaiverUrl(slug, waiverTypeId);
  const rel = `/waiver/${encodeURIComponent(slug)}?h=${encodeURIComponent(h)}`;
  if (opts.absolute && ENV.WAIVER_PUBLIC_BASE_URL) {
    return `${ENV.WAIVER_PUBLIC_BASE_URL}${rel}`;
  }
  return rel;
}

export function validateWaiverAccess(
  slug: string,
  waiverTypeId: string,
  hUnknown: string | null | undefined
):
  | { valid: true; mode: "hash" | "bypass" }
  | { valid: false; reason: "missing" | "bad-format" | "mismatch" } {
  assertRuntimeEnvSane();
  const secret = ENV.WAIVER_HASH_SECRET!;

  const h =
    typeof hUnknown === "string" ? hUnknown.trim().toLowerCase() : undefined;

  if (!h || h.length === 0) {
    if (!ENV.WAIVER_HASH_REQUIRED) {
      return { valid: true, mode: "bypass" };
    }
    return { valid: false, reason: "missing" };
  }

  if (h.length !== HASH_SIG_HEX_LEN || !/^[a-f0-9]+$/.test(h)) {
    return { valid: false, reason: "bad-format" };
  }

  const want = digest12(secret, hashPayload(slug, waiverTypeId));
  const a = Buffer.from(h, "hex");
  const b = Buffer.from(want, "hex");
  if (a.length !== b.length) return { valid: false, reason: "mismatch" };
  return timingSafeEqual(a, b)
    ? { valid: true, mode: "hash" }
    : { valid: false, reason: "mismatch" };
}

export function requireAdminAuth(req: NextRequest): boolean {
  assertRuntimeEnvSane();
  if (!ENV.ADMIN_API_AUTH_REQUIRED) return true;
  return defaultValidateBearerAuth(req);
}

export function adminOrUnauthorized(req: NextRequest): Response | null {
  if (requireAdminAuth(req)) return null;
  return defaultUnauthorizedResponse();
}

// ---------------------------------------------------------------------------
// Lazy imports from @/lib/auth avoid a circular-module graph during Next's
// static "collect page data" phase (which would otherwise fail while
// resolving auth.ts <-> access.ts).
// ---------------------------------------------------------------------------
let _cachedUnauth: (() => Response) | null = null;
let _cachedValidateBearer: ((req: NextRequest) => boolean) | null = null;

function defaultUnauthorizedResponse(): Response {
  if (_cachedUnauth) return _cachedUnauth();
  /* eslint-disable */
  const mod = (require as NodeRequire)("@/lib/auth") as typeof import("@/lib/auth");
  /* eslint-enable */
  _cachedUnauth = mod.unauthorizedResponse;
  return _cachedUnauth();
}

function defaultValidateBearerAuth(req: NextRequest): boolean {
  if (_cachedValidateBearer) return _cachedValidateBearer(req);
  /* eslint-disable */
  const mod = (require as NodeRequire)("@/lib/auth") as typeof import("@/lib/auth");
  /* eslint-enable */
  _cachedValidateBearer = mod.validateBearerAuth;
  return _cachedValidateBearer(req);
}
