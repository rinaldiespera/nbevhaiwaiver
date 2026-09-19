import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ClientConfig,
} from "@aws-sdk/client-s3";
import {
  put as vercelPut,
  get as vercelGet,
  head as vercelHead,
} from "@vercel/blob";

export const MAX_DOCX_BYTES = 5 * 1024 * 1024;
export const MAX_SIGNATURE_BYTES = 500 * 1024;
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PNG_MIME = "image/png";

function envStr(k: string, fallback = ""): string {
  const v = process.env[k];
  return v != null && v !== "" ? v : fallback;
}

export interface BlobPutOpts {
  key: string;
  body: Buffer;
  contentType: string;
  maxSizeBytes?: number;
}

abstract class BlobStoreBackend {
  abstract put(opts: BlobPutOpts): Promise<string>;
  abstract getAsBase64(urlOrKey: string): Promise<string>;
  abstract exists(urlOrKey: string): Promise<boolean>;
}

// ---------------- Local filesystem backend ----------------
class LocalBlobStore extends BlobStoreBackend {
  private readonly root: string;
  constructor() {
    super();
    const isVercelServerless =
      (envStr("VERCEL") || envStr("AWS_LAMBDA_FUNCTION_NAME")) !== "";
    const defaultDir = isVercelServerless ? "/tmp/.blob-store" : "./.blob-store";
    this.root = path.resolve(process.cwd(), envStr("BLOB_LOCAL_DIR", defaultDir));
    fs.mkdirSync(this.root, { recursive: true });
  }
  private safeFsPath(rawKey: string): string {
    const safe = rawKey.replace(/[^a-zA-Z0-9/_\-.]/g, "_");
    const full = path.join(this.root, safe);
    if (!full.startsWith(this.root)) {
      throw new Error("Invalid blob key: escapes storage root");
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    return full;
  }
  async put(opts: BlobPutOpts): Promise<string> {
    if (opts.maxSizeBytes != null && opts.body.length > opts.maxSizeBytes) {
      throw new SizeError(
        `Upload exceeds size limit: ${opts.body.length} > ${opts.maxSizeBytes}`
      );
    }
    const p = this.safeFsPath(opts.key);
    fs.writeFileSync(p, opts.body);
    return `local://${opts.key}`;
  }
  private extractKey(urlOrKey: string): string {
    if (urlOrKey.startsWith("local://")) {
      return urlOrKey.slice("local://".length);
    }
    return urlOrKey;
  }
  async getAsBase64(urlOrKey: string): Promise<string> {
    const p = this.safeFsPath(this.extractKey(urlOrKey));
    const buf = fs.readFileSync(p);
    return buf.toString("base64");
  }
  async exists(urlOrKey: string): Promise<boolean> {
    const p = this.safeFsPath(this.extractKey(urlOrKey));
    return fs.existsSync(p);
  }
}

// ---------------- Vercel Blob backend (OIDC-integrated on Vercel) ----------------
class VercelBlobStore extends BlobStoreBackend {
  private vercelToken(): string | undefined {
    return envStr("BLOB_READ_WRITE_TOKEN") || undefined;
  }
  async put(opts: BlobPutOpts): Promise<string> {
    if (opts.maxSizeBytes != null && opts.body.length > opts.maxSizeBytes) {
      throw new SizeError(
        `Upload exceeds size limit: ${opts.body.length} > ${opts.maxSizeBytes}`
      );
    }
    const blob = await vercelPut(opts.key, opts.body, {
      access: "private",
      contentType: opts.contentType,
      addRandomSuffix: false,
      token: this.vercelToken(),
    });
    return blob.url;
  }
  private requireAbsoluteUrl(urlOrKey: string): string {
    if (urlOrKey.startsWith("http://") || urlOrKey.startsWith("https://")) {
      return urlOrKey;
    }
    throw new Error(
      "VercelBlobStore requires absolute blob URL; got relative key: " + urlOrKey
    );
  }
  async getAsBase64(urlOrKey: string): Promise<string> {
    const url = this.requireAbsoluteUrl(urlOrKey);
    const result = await vercelGet(url, {
      token: this.vercelToken(),
    });
    if (!result || result.statusCode !== 200) {
      throw new Error(
        "VercelBlobStore getAsBase64 failed: status=" +
          (result?.statusCode ?? "null")
      );
    }
    const chunks: Uint8Array[] = [];
    const reader = result.stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    let totalLen = 0;
    for (const c of chunks) totalLen += c.length;
    const out = Buffer.alloc(totalLen);
    let offset = 0;
    for (const c of chunks) {
      out.set(c as unknown as Uint8Array, offset);
      offset += c.length;
    }
    return out.toString("base64");
  }
  async exists(urlOrKey: string): Promise<boolean> {
    try {
      const url = this.requireAbsoluteUrl(urlOrKey);
      await vercelHead(url, { token: this.vercelToken() });
      return true;
    } catch {
      return false;
    }
  }
}

// ---------------- S3-compatible backend ----------------
class S3BlobStore extends BlobStoreBackend {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrlBase?: string;

  constructor() {
    super();
    const endpoint = envStr("S3_ENDPOINT");
    const region = envStr("S3_REGION") || "auto";
    const accessKeyId = envStr("S3_ACCESS_KEY_ID");
    const secretAccessKey = envStr("S3_SECRET_ACCESS_KEY");
    this.bucket = envStr("S3_BUCKET");
    this.publicUrlBase = envStr("S3_PUBLIC_URL_BASE") || undefined;
    if (!this.bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "S3 blob driver requires S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY"
      );
    }
    const cfg: S3ClientConfig = {
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    };
    if (endpoint) cfg.endpoint = endpoint;
    this.client = new S3Client(cfg);
  }

  async put(opts: BlobPutOpts): Promise<string> {
    if (opts.maxSizeBytes != null && opts.body.length > opts.maxSizeBytes) {
      throw new SizeError(
        `Upload exceeds size limit: ${opts.body.length} > ${opts.maxSizeBytes}`
      );
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: opts.key,
        Body: opts.body,
        ContentType: opts.contentType,
      })
    );
    if (this.publicUrlBase) {
      const base = this.publicUrlBase.replace(/\/$/, "");
      return `${base}/${opts.key}`;
    }
    return `s3://${this.bucket}/${opts.key}`;
  }

  private parseUrlOrKey(urlOrKey: string): { key: string } {
    if (urlOrKey.startsWith("s3://")) {
      const rest = urlOrKey.slice("s3://".length);
      const slash = rest.indexOf("/");
      const key = slash < 0 ? "" : rest.slice(slash + 1);
      return { key };
    }
    if (urlOrKey.startsWith("http://") || urlOrKey.startsWith("https://")) {
      try {
        const u = new URL(urlOrKey);
        const parts = u.pathname.split("/").filter(Boolean);
        if (parts[0] === this.bucket) {
          return { key: parts.slice(1).join("/") };
        }
        return { key: parts.join("/") };
      } catch {
        return { key: urlOrKey };
      }
    }
    return { key: urlOrKey };
  }

  async getAsBase64(urlOrKey: string): Promise<string> {
    const { key } = this.parseUrlOrKey(urlOrKey);
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    const body = out.Body as NodeJS.ReadableStream | undefined;
    if (!body) return "";
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer | Uint8Array>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("base64");
  }

  async exists(urlOrKey: string): Promise<boolean> {
    try {
      const { key } = this.parseUrlOrKey(urlOrKey);
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key })
      );
      return true;
    } catch {
      return false;
    }
  }
}

// ---------------- Errors ----------------
export class SizeError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "SizeError";
  }
}
export function isSizeError(err: unknown): err is SizeError {
  return err instanceof SizeError;
}

// ---------------- Singleton factory ----------------
const SINGLETON_KEY = Symbol.for("cloud_waiver_blob_store_singleton");
type GlobalWithStore = typeof globalThis & {
  [SINGLETON_KEY]?: BlobStoreBackend;
};

function buildStore(): BlobStoreBackend {
  const driver = (envStr("BLOB_DRIVER", "local") || "local").toLowerCase();
  if (driver === "s3") return new S3BlobStore();
  if (driver === "vercel") return new VercelBlobStore();
  return new LocalBlobStore();
}

const store: BlobStoreBackend =
  (globalThis as GlobalWithStore)[SINGLETON_KEY] ??= buildStore();

// ---------------- Public API ----------------
export async function uploadFile(
  key: string,
  body: Buffer,
  contentType: string,
  maxSizeBytes?: number
): Promise<string> {
  return store.put({ key, body, contentType, maxSizeBytes });
}

export async function getFileAsBase64(urlOrKey: string): Promise<string> {
  return store.getAsBase64(urlOrKey);
}

export async function fileExists(urlOrKey: string): Promise<boolean> {
  return store.exists(urlOrKey);
}

export function randomBlobId(bytes = 16): string {
  return crypto.randomBytes(bytes).toString("hex");
}
