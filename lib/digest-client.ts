"use client";

/**
 * DashyCore v7 — the shared client boundary for the live `dashy-digest`
 * upload worker.
 *
 * The multipart request below is deliberately boring. It is the production
 * contract: the browser owns the multipart boundary, the worker receives the
 * verified Supabase user id in the query string and form body, and the only
 * manually supplied header is the Bearer token.
 */

import { createClient } from "@/lib/supabase/client";

/**
 * Keep the production endpoint usable when a deployment omitted the public
 * environment variable. `||` also treats an accidentally empty value as
 * missing.
 */
const BASE_URL =
  process.env.NEXT_PUBLIC_DASHY_DIGEST_URL ||
  "https://dashy-digest.kamleshprathampandey.workers.dev";

/** Message shown when the visitor has no usable Supabase session. */
export const DIGEST_LOGIN_REQUIRED_MESSAGE = "Please log in to upload files.";

/** Resolved Supabase identity used by the worker request. */
export interface DigestIdentity {
  userId: string;
  accessToken: string;
}

export interface DigestUploadResult {
  documentId?: string;
  chunkCount?: number;
  raw: Record<string, unknown>;
}

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

/**
 * Resolve a signed-in Supabase session before a request is made. A caller's
 * already-loaded user id is only a fallback while a session and access token
 * are present; it can never authenticate a signed-out visitor by itself.
 */
export async function resolveDigestIdentity(
  fallbackUserId?: string | null
): Promise<DigestIdentity | null> {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) return null;

    const userId = session.user?.id || fallbackUserId || "";
    if (!userId) return null;

    return {
      userId,
      accessToken: session.access_token,
    };
  } catch {
    // Treat session/storage failures like a signed-out visitor. In
    // particular, do not dispatch a worker request without an identity.
    return null;
  }
}

/** Maps a file to the source type expected by the digest pipeline. */
export function digestSourceTypeFor(file: File): string {
  if (file.type === "application/pdf") return "pdf";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.includes("markdown") || /\.(md|markdown)$/i.test(file.name)) {
    return "markdown";
  }
  return "text";
}

interface WorkerResponse {
  status: number;
  statusText: string;
  rawText: string;
  payload: Record<string, unknown>;
}

/** Read the response once and retain both its text and useful JSON fields. */
async function readWorkerResponse(response: Response): Promise<WorkerResponse> {
  const rawText = await response.text();
  let payload: Record<string, unknown> = {};

  if (rawText.trim()) {
    try {
      const parsed: unknown = JSON.parse(rawText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      // The plain response text is still surfaced below.
    }
  }

  return {
    status: response.status,
    statusText: response.statusText,
    rawText,
    payload,
  };
}

function workerErrorMessage(response: WorkerResponse): string {
  const candidates = [
    response.payload.error,
    response.payload.message,
    response.payload.details,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  if (response.rawText.trim()) return response.rawText.trim().slice(0, 300);
  return `Upload failed (HTTP ${response.status}${
    response.statusText ? ` ${response.statusText}` : ""
  })`;
}

/**
 * Build the worker URL with the two user id spellings required by production.
 * Using URL rather than string concatenation preserves any configured base
 * path and correctly escapes a UUID/query value.
 */
function buildDigestUrl(identity: DigestIdentity): string {
  const url = new URL(BASE_URL);
  url.searchParams.append("userId", identity.userId);
  url.searchParams.append("user_id", identity.userId);
  return url.toString();
}

/** The Authorization header is intentionally the only custom request header. */
function authHeaders(identity: DigestIdentity): Record<string, string> {
  return { Authorization: `Bearer ${identity.accessToken}` };
}

/** Send the one supported upload wire: CORS-safe multipart/form-data. */
async function postMultipart(
  identity: DigestIdentity,
  file: File,
  filename: string,
  sourceType: string,
  signal?: AbortSignal
): Promise<WorkerResponse> {
  const formData = new FormData();
  formData.append("file", file, filename);
  formData.append("filename", filename);
  formData.append("sourceType", sourceType);
  formData.append("userId", identity.userId);
  formData.append("user_id", identity.userId);

  const response = await fetch(buildDigestUrl(identity), {
    method: "POST",
    mode: "cors",
    headers: authHeaders(identity),
    body: formData,
    signal,
  });

  return readWorkerResponse(response);
}

function responseToResult(response: WorkerResponse): DigestUploadResult {
  if (response.status === 401 || response.status === 403) {
    throw new DigestUploadError(
      "Your session has expired. Please sign in again.",
      "unauthenticated",
      response.status
    );
  }

  if (
    response.status < 200 ||
    response.status >= 300 ||
    response.payload.success === false
  ) {
    throw new DigestUploadError(
      workerErrorMessage(response),
      "worker",
      response.status
    );
  }

  return {
    documentId:
      typeof response.payload.documentId === "string"
        ? response.payload.documentId
        : typeof response.payload.memoryId === "string"
          ? response.payload.memoryId
          : undefined,
    chunkCount:
      typeof response.payload.chunkCount === "number"
        ? response.payload.chunkCount
        : undefined,
    raw: response.payload,
  };
}

function networkUploadError(error: unknown): DigestUploadError {
  if (error instanceof DigestUploadError) return error;
  if (error instanceof Error && error.message) {
    // Keep the browser's real error (for example, a CORS TypeError) visible
    // in the toast instead of replacing it with an unhelpful generic string.
    return new DigestUploadError(error.message, "network");
  }
  return new DigestUploadError(
    "Could not reach the dashy-digest worker. Check your connection and try again.",
    "network"
  );
}

/**
 * Upload one file after the identity gate. No request is dispatched when the
 * visitor is signed out or the supplied identity is incomplete.
 */
export async function uploadFileToDigest(options: {
  file: File;
  identity?: DigestIdentity | null;
  fallbackUserId?: string | null;
  sourceType?: string;
  signal?: AbortSignal;
}): Promise<DigestUploadResult> {
  const identity =
    options.identity ?? (await resolveDigestIdentity(options.fallbackUserId));

  if (!identity?.userId || !identity.accessToken) {
    throw new DigestUploadError(
      DIGEST_LOGIN_REQUIRED_MESSAGE,
      "unauthenticated"
    );
  }

  try {
    const response = await postMultipart(
      identity,
      options.file,
      options.file.name,
      options.sourceType ?? digestSourceTypeFor(options.file),
      options.signal
    );
    return responseToResult(response);
  } catch (err) {
    console.error("CRITICAL UPLOAD ERROR:", err);
    throw networkUploadError(err);
  }
}
