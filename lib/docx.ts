import mammoth from "mammoth";

type CacheKey = string;
const htmlCache = new Map<CacheKey, string>();

let parseCount = 0;
let cacheHitCount = 0;

export function makeCacheKey(
  waiverTypeId: string | number | null | undefined,
  version: number | null | undefined
): CacheKey {
  return `${String(waiverTypeId ?? "u")}:${String(version ?? 0)}`;
}

export function getCachedHtml(key: CacheKey): string | undefined {
  const v = htmlCache.get(key);
  if (v !== undefined) cacheHitCount++;
  return v;
}

export function setCachedHtml(key: CacheKey, html: string): void {
  htmlCache.set(key, html);
}

export function clearHtmlCache(): void {
  htmlCache.clear();
}

const SCRIPT_RE = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
const STYLE_ON_RE = /\son[a-z]+\s*=\s*"[^"]*"/gi;
const STYLE_ON_RE_SQ = /\son[a-z]+\s*=\s*'[^']*'/gi;

export async function convertDocxToHtml(
  buffer: ArrayBuffer | Uint8Array | Buffer
): Promise<{ html: string; parseCount: number }> {
  parseCount++;
  const bytes =
    buffer instanceof Buffer
      ? buffer
      : Buffer.from(buffer as ArrayBufferLike);
  const result = await mammoth.convertToHtml({ buffer: bytes });
  let html = result.value;
  html = html.replace(SCRIPT_RE, "");
  html = html.replace(STYLE_ON_RE, "");
  html = html.replace(STYLE_ON_RE_SQ, "");
  return { html, parseCount };
}

export function __debugStats() {
  return { parseCount, cacheHitCount, cacheSize: htmlCache.size };
}
