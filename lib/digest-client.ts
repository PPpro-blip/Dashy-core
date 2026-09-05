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
 * Resolves the signed-in caller for a digest upload.
 *
 * WATERPROOF CONTRACT — returns BOTH halves or `null`, never a partial:
 *  1. `getSession()` (local cookie/storage read, auto-refreshes an expired
 *     token) — the exact pattern /chat and /agents use.
 *  2. If either half is missing, `getUser()` forces a server round-trip that
 *     also hydrates the client's session store, then the session is re-read
 *     so a freshly minted access token is picked up.
 *  3. Auth hydration race (Knowledge mounts before the browser client has
 *     restored the cookie session): retried a couple of times with a short
 *     backoff instead of failing the upload with "userId is required".
 *
 * `fallbackUserId` (e.g. the chat page's already-loaded id) is a last resort
 * and can never authenticate a signed-out visitor on its own — an access
 * token is always required alongside it.
 */
export async function resolveDigestIdentity(
  fallbackUserId?: string | null
): Promise<DigestIdentity | null> {
  const attempt = async (): Promise<DigestIdentity | null> => {
    const supabase = createClient();

    const {
      data: { session },
    } = await supabase.auth.getSession();

    let userId: string | null = session?.user?.id ?? null;
    let accessToken: string | null = session?.access_token ?? null;

    if (!userId || !accessToken) {
      // Forces a network verification AND hydrates the client session store.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      userId = user?.id ?? userId;

      // Prefer the (possibly just-refreshed) session for BOTH halves.
      const s2 = (await supabase.auth.getSession()).data.session;
      accessToken = s2?.access_token ?? accessToken;
      userId = s2?.user?.id ?? userId;
    }

    if (!userId && fallbackUserId) userId = fallbackUserId;

    // Both halves are mandatory: the worker verifies the Bearer token AND
    // requires an explicit userId. Missing either means "not signed in".
    if (!userId || !accessToken) return null;

    return { userId, accessToken };
  };

  for (let i = 0; i < 3; i += 1) {
    try {
      const identity = await attempt();
      if (identity) return identity;
    } catch {
      // Network/storage hiccup — fall through to the retry below.
    }
    // Short backoff: 0ms, 150ms, 400ms — covers the mount-before-hydration
    // race without making a genuinely signed-out visitor wait.
    if (i < 2) {
      await new Promise((resolve) => setTimeout(resolve, i === 0 ? 150 : 400));
    }
  }

  return null;
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
  // A caller-supplied identity is only trusted when BOTH halves are present
  // and non-empty; otherwise we resolve it ourselves. This is the last gate
  // before the wire — no request is ever dispatched without a real userId.
  const supplied = options.identity;
  const identity =
    supplied && supplied.userId?.trim() && supplied.accessToken?.trim()
      ? { userId: supplied.userId.trim(), accessToken: supplied.accessToken }
      : await resolveDigestIdentity(supplied?.userId ?? options.fallbackUserId);

  if (!identity?.userId?.trim() || !identity.accessToken?.trim()) {
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
