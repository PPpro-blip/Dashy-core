"use client";

/**
 * DashyCore v7 — client boundary for document uploads.
 *
 * THE BROWSER NO LONGER TALKS TO `dashy-digest` DIRECTLY.
 *
 * Every upload goes to the same-origin Next.js route handler:
 *
 *     POST /api/digest/upload        (credentials: "include")
 *     multipart/form-data: { file, filename, sourceType, origin? }
 *
 * The route handler (`app/api/digest/upload/route.ts`) resolves the caller
 * with `supabase.auth.getUser()` from the httpOnly Supabase cookies and
 * injects `userId` on the server→worker hop. The browser deliberately sends
 * NO `userId`: a client-supplied identity is what produced the production
 * "Upload failed: userId is required" failures, and the proxy ignores it
 * anyway.
 *
 * Consequences of the same-origin hop:
 *   - no CORS preflight against workers.dev (which could strip headers)
 *   - no dependency on the browser client having hydrated its session
 *   - the access token never has to be readable by client JS
 */

/** Same-origin upload proxy — see `app/api/digest/upload/route.ts`. */
export const DIGEST_UPLOAD_ENDPOINT = "/api/digest/upload";

/** Message shown when the visitor has no usable Supabase session. */
export const DIGEST_LOGIN_REQUIRED_MESSAGE = "Please log in to upload files.";

export interface DigestUploadResult {
  documentId?: string;
  chunkCount?: number;
  /** Raw proxy/worker payload, for callers that need extra fields. */
  raw: Record<string, unknown>;
}

/** Which surface started the upload — forwarded to the worker as metadata. */
export type DigestOrigin = "knowledge" | "chat" | (string & {});

export interface UploadDigestOptions {
  file: File;
  /** RAG ingest type; derived from the file when omitted. */
  sourceType?: string;
  /** Surface that initiated the upload ("knowledge" | "chat"). */
  origin?: DigestOrigin;
  signal?: AbortSignal;
}

/**
 * Error thrown for every failed upload. `kind` distinguishes:
 *  - `unauthenticated`: no server-side session (401/403 from the proxy)
 *  - `network`: the proxy itself was unreachable / the request was aborted
 *  - `worker`: any other non-2xx, carrying the worker's own message
 */
export class DigestUploadError extends Error {
  constructor(
    message: string,
    public readonly kind: "unauthenticated" | "network" | "worker",
    public readonly status?: number
  ) {
    super(message);
    this.name = "DigestUploadError";
  }
}

/** Maps a file to the `sourceType` the digest worker / RAG pipeline expects. */
export function digestSourceTypeFor(file: File): string {
  if (file.type === "application/pdf") return "pdf";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.includes("markdown") || /\.(md|markdown)$/i.test(file.name)) {
    return "markdown";
  }
  return "text";
}

/**
 * Client-side precheck ONLY (the server route is the source of truth).
 *
 * Used to disable the attach control and show a login toast for signed-out
 * visitors without making them wait for a round trip. A `true` here proves
 * nothing to the server — `app/api/digest/upload` re-verifies the session
 * from cookies and returns 401 when it is missing.
 */
export async function hasDigestSession(): Promise<boolean> {
  try {
    // Imported lazily so a server-render pass never pulls in the browser
    // Supabase client.
    const { createClient } = await import("@/lib/supabase/client");
    const {
      data: { session },
    } = await createClient().auth.getSession();
    return Boolean(session?.user?.id);
  } catch {
    // Unknown — let the server decide on the actual upload.
    return true;
  }
}

/** Best-effort JSON parse of a proxy response body. */
function parsePayload(rawText: string): Record<string, unknown> {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Plain-text body — surfaced verbatim below.
  }
  return {};
}

/** Extracts a human-readable error from a proxy JSON/text body. */
function proxyErrorMessage(
  payload: Record<string, unknown>,
  rawText: string,
  status: number,
  statusText: string
): string {
  const asText = (value: unknown): string => {
    if (typeof value === "string") return value.trim();
    if (value && typeof value === "object") {
      const nested = value as Record<string, unknown>;
      return (
        asText(nested.error) ||
        asText(nested.message) ||
        asText(nested.details) ||
        asText(nested.error_description)
      );
    }
    return "";
  };
  return (
    asText(payload.error) ||
    asText(payload.message) ||
    asText(payload.details) ||
    rawText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) ||
    statusText ||
    `Upload failed (HTTP ${status})`
  );
}

/**
 * Uploads one file through the server-side proxy.
 *
 * Accepts either `uploadToDigest({ file, … })` or `uploadToDigest(file, …)`
 * so existing call sites keep working.
 *
 * @throws {DigestUploadError} `unauthenticated` when the server has no
 * verified session, `network` when the proxy is unreachable or the request is
 * aborted, `worker` for any other failure (carrying the worker's message).
 */
export async function uploadToDigest(
  fileOrOptions: File | UploadDigestOptions,
  maybeOptions?: Omit<UploadDigestOptions, "file">
): Promise<DigestUploadResult> {
  const options: UploadDigestOptions =
    fileOrOptions instanceof File
      ? { file: fileOrOptions, ...maybeOptions }
      : fileOrOptions;

  const { file, signal } = options;
  const sourceType = options.sourceType ?? digestSourceTypeFor(file);

  // ── Same-origin request: file + metadata ONLY. No userId, no token. ──────
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("filename", file.name);
  form.append("sourceType", sourceType);
  if (options.origin) form.append("origin", options.origin);

  let response: Response;
  try {
    response = await fetch(DIGEST_UPLOAD_ENDPOINT, {
      method: "POST",
      body: form,
      // Ship the Supabase auth cookies so the server can resolve the user.
      credentials: "include",
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new DigestUploadError("Upload cancelled.", "network");
    }
    throw new DigestUploadError(
      "Could not reach the upload service. Check your connection and try again.",
      "network"
    );
  }

  const rawText = await response.text();
  const payload = parsePayload(rawText);

  if (response.status === 401 || response.status === 403) {
    throw new DigestUploadError(
      // The proxy answers 401 with exactly this message when the cookies hold
      // no verified user; prefer its wording, fall back to our own.
      proxyErrorMessage(payload, rawText, response.status, response.statusText) ||
        DIGEST_LOGIN_REQUIRED_MESSAGE,
      "unauthenticated",
      response.status
    );
  }

  if (!response.ok || payload.success === false) {
    throw new DigestUploadError(
      proxyErrorMessage(payload, rawText, response.status, response.statusText),
      "worker",
      response.status
    );
  }

  return {
    documentId:
      typeof payload.documentId === "string"
        ? payload.documentId
        : typeof payload.memoryId === "string"
          ? payload.memoryId
          : undefined,
    chunkCount:
      typeof payload.chunkCount === "number" ? payload.chunkCount : undefined,
    raw: payload,
  };
}

/** Alias kept for existing call sites. */
export const uploadFileToDigest = uploadToDigest;
