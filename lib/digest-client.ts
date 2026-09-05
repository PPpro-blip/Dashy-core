"use client";

/**
 * DashyCore v7 — the shared client boundary for the live `dashy-digest`
 * upload worker.
 *
 * The multipart request below is the canonical production upload path:
 * the browser handles the multipart boundary, the worker receives the
 * verified Supabase user id in BOTH the FormData body AND the URL query string
 * (`?userId=...&user_id=...`), and the Bearer token is provided in headers.
 */

import { createClient } from "@/lib/supabase/client";

/**
 * Keep the production endpoint usable when a deployment omitted the public
 * environment variable. `||` also treats an accidentally empty value as
 * missing.
 */
export const DASHY_DIGEST_URL =
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

export interface UploadDigestOptions {
  file: File;
  identity?: DigestIdentity | null;
  fallbackUserId?: string | null;
  sourceType?: string;
  signal?: AbortSignal;
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
 * Resolves the user ID and session access token reliably for digest uploads.
 *
 * Retrieves the session via getSession(), falls back to getUser() if session
 * has no user, or to fallbackUserId. Throws a clean DigestUploadError if
 * no user identity could be resolved.
 */
export async function resolveDigestIdentity(
  fallbackUserId?: string | null
): Promise<DigestIdentity> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  let userId = session?.user?.id;
  let accessToken = session?.access_token;

  if (!userId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id;
  }

  if (!userId && fallbackUserId) {
    userId = fallbackUserId;
  }

  if (userId && !accessToken) {
    const {
      data: { session: s2 },
    } = await supabase.auth.getSession();
    accessToken = s2?.access_token;
  }

  if (!userId) {
    throw new DigestUploadError(
      DIGEST_LOGIN_REQUIRED_MESSAGE,
      "unauthenticated"
    );
  }

  return {
    userId,
    accessToken: accessToken || "",
  };
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
 * Builds the digest URL with EVERY userId key in the query string:
 * `?userId=...&user_id=...&userid=...`
 */
function buildDigestUrl(identity: DigestIdentity): string {
  const url = new URL(DASHY_DIGEST_URL);
  url.searchParams.set("userId", identity.userId);
  url.searchParams.set("user_id", identity.userId);
  url.searchParams.set("userid", identity.userId);
  return url.toString();
}

/** The Authorization header is supplied when an access token is available. */
function authHeaders(identity: DigestIdentity): Record<string, string> {
  const headers: Record<string, string> = {};
  if (identity.accessToken) {
    headers["Authorization"] = `Bearer ${identity.accessToken}`;
  }
  return headers;
}

/** Sends the multipart/form-data upload payload with userId in body and query. */
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
  formData.append("userid", identity.userId);

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
    return new DigestUploadError(error.message, "network");
  }
  return new DigestUploadError(
    "Could not reach the dashy-digest worker. Check your connection and try again.",
    "network"
  );
}

/**
 * Uploads one file to dashy-digest using the shared digest client.
 *
 * Appends userId and user_id to BOTH FormData and the query string.
 * Supports passing either `{ file, ... }` or `(file, options)`.
 */
export async function uploadToDigest(
  fileOrOptions: File | UploadDigestOptions,
  maybeOptions?: Omit<UploadDigestOptions, "file">
): Promise<DigestUploadResult> {
  const options: UploadDigestOptions =
    fileOrOptions instanceof File
      ? { file: fileOrOptions, ...maybeOptions }
      : fileOrOptions;

  const supplied = options.identity;
  let identity: DigestIdentity;

  if (supplied && supplied.userId?.trim()) {
    identity = {
      userId: supplied.userId.trim(),
      accessToken: supplied.accessToken || "",
    };
  } else {
    identity = await resolveDigestIdentity(options.fallbackUserId);
  }

  if (!identity.userId?.trim()) {
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

/** Alias for uploadToDigest. */
export const uploadFileToDigest = uploadToDigest;
