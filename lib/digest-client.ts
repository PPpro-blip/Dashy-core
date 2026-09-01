"use client";

/**
 * DashyCore v7 — client boundary to the live `dashy-digest` Cloudflare Worker.
 *
 * This is the single source of truth for the document-ingest wire contract,
 * shared by every upload surface (chat composer attachment, Knowledge page,
 * and any future memory upload button) so they can never drift apart.
 *
 * WIRES (proven contract family — both are sent; the worker answers one):
 *
 *  1. MULTIPART (file upload):
 *       POST {DASHY_DIGEST_URL}?userId=…&user_id=…&userid=…
 *       Auth:     Authorization: Bearer <supabase access token>
 *       Headers:  X-User-Id / X-UserId / x-userid
 *       Body:     multipart/form-data — file, filename, sourceType,
 *                 userId, user_id, userid
 *
 *  2. JSON (text ingest / the worker/ingest.ts body contract used by the
 *     deployed `dashy-digest` script — this is the family BOTH workers in
 *     the `PPpro-blip/dashy` repo use: `await request.json()`):
 *       POST {DASHY_DIGEST_URL}?userId=…&user_id=…&userid=…
 *       Headers:  Content-Type: application/json + the same X-User-* headers
 *       Body:     { text, sourceType, filename/sourceId/title, userId,
 *                  user_id, userid, file? }
 *
 * WHY TWO WIRES — the production failure (`Upload failed: userId is required`):
 *   PR #10 sent multipart; PR #11/#12 "shotgunned" userId onto query string,
 *   form fields AND headers — still multipart. If the deployed worker parses
 *   the body as JSON first (`await request.json()`), a multipart body parses
 *   to `{}` and NO amount of form fields/query/header carriers ever produces
 *   a `userId` property — the request dies at the very first guard:
 *       `if (!body.userId) return … { error: "userId is required" }`.
 *   The only channel that cannot be ignored by such a worker is a JSON body.
 *   So we (a) keep the full multipart shotgun for the file-upload worker,
 *   and (b) when the worker rejects with ANY userId-related error, retry ONCE
 *   as JSON with every plausible userId key populated. Whatever channel the
 *   deployed script consults, the identical verified Supabase UUID is there.
 *
 * `userId` is the Supabase auth UUID (`session.user.id`) and is REQUIRED by
 * the worker. The identity is resolved from the Supabase session BEFORE any
 * request is made, and no request is ever dispatched without it.
 */

import { DASHY_DIGEST_URL } from "@/lib/chat-client";
import { createClient } from "@/lib/supabase/client";

/** Message shown when the visitor has no usable Supabase session. */
export const DIGEST_LOGIN_REQUIRED_MESSAGE = "Please log in to upload files.";

/** Resolved, verified caller identity for a digest upload. */
export interface DigestIdentity {
  /** Supabase auth user UUID — sent to the worker as `userId`. */
  userId: string;
  /** Supabase access token — sent as `Authorization: Bearer …`. */
  accessToken: string;
}

export interface DigestUploadResult {
  documentId?: string;
  chunkCount?: number;
  /** Raw worker payload, for callers that need extra fields. */
  raw: Record<string, unknown>;
}

/**
 * Error thrown for every failed digest upload. `kind` distinguishes:
 *  - `unauthenticated`: no local session (request NOT sent) or the worker
 *    rejected the Bearer token (401/403)
 *  - `network`: worker unreachable / aborted
 *  - `worker`: any non-2xx response, carrying the worker's own message
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

/**
 * True when a worker error message is complaining about a missing/invalid
 * user id (the exact wording varies across deployed script versions):
 * "userId is required", "user_id required", "user id is required",
 * "userId missing", "userid is required", etc.
 */
function isUserIdError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("user") &&
    m.includes("id") &&
    /required|missing|not provided|cannot be empty|invalid/.test(m)
  );
}

/**
 * Resolves the logged-in Supabase user the same way the rest of the app does
 * (`createClient()` + `auth.getSession()`), which is a local/cookie read that
 * also auto-refreshes an expired token.
 *
 * `getSession()` already carries `session.user.id`, so no second network call
 * is needed; `getUser()` is only used as a fallback when the session object
 * somehow lacks a user. A caller-supplied `fallbackUserId` (e.g. the chat
 * page's already-loaded user id) is used only as a last resort.
 *
 * @returns the identity, or `null` when the visitor is not signed in.
 */
export async function resolveDigestIdentity(
  fallbackUserId?: string | null
): Promise<DigestIdentity | null> {
  let accessToken: string | undefined;
  let userId: string | undefined;

  try {
    const supabase = createClient();

    const {
      data: { session },
    } = await supabase.auth.getSession();

    accessToken = session?.access_token;
    userId = session?.user?.id;

    // Fallback: session present but no embedded user (or no session cached).
    if (!userId) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      userId = user?.id;
    }
  } catch {
    // Network/storage hiccup — fall through to the caller-supplied id below.
  }

  if (!userId && fallbackUserId) userId = fallbackUserId;

  // Both halves are mandatory: the worker authenticates the Bearer token AND
  // requires the userId field. Missing either means "not signed in".
  if (!userId || !accessToken) return null;

  return { userId, accessToken };
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

/** Strips HTML tags/entities and collapses whitespace from a raw body. */
function cleanBodyText(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pulls the worker's own error text out of a JSON or plain-text body. */
function extractErrorText(
  payload: Record<string, unknown>,
  rawText: string,
  status: number,
  statusText: string
): string {
  const stringValue = (value: unknown): string => {
    if (typeof value === "string") return value.trim();
    if (value && typeof value === "object") {
      const nested = value as Record<string, unknown>;
      return (
        stringValue(nested.error) ||
        stringValue(nested.message) ||
        stringValue(nested.details) ||
        stringValue(nested.error_description)
      );
    }
    return "";
  };
  const candidate =
    stringValue(payload.error) ||
    stringValue(payload.message) ||
    stringValue(payload.details) ||
    stringValue(payload.error_description) ||
    cleanBodyText(rawText).slice(0, 300) ||
    statusText ||
    "";
  return (
    candidate ||
    `Upload failed (HTTP ${status}${statusText ? ` ${statusText}` : ""})`
  );
}

interface WorkerResponse {
  status: number;
  statusText: string;
  rawText: string;
  payload: Record<string, unknown>;
}

/** Reads a fetch Response into text + best-effort JSON, once. */
async function readWorkerResponse(response: Response): Promise<WorkerResponse> {
  const rawText = await response.text();
  let payload: Record<string, unknown> = {};
  if (rawText.trim().startsWith("{") || rawText.trim().startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(rawText);
      if (parsed && typeof parsed === "object") {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      // Non-JSON body — the status code and raw text still tell the story.
    }
  }
  return {
    status: response.status,
    statusText: response.statusText,
    rawText,
    payload,
  };
}

/**
 * Builds the digest URL with EVERY userId spelling in the query string.
 * No trailing slash: the production Worker is mounted at the configured URL
 * itself, and a redirect can alter multipart POST handling.
 */
function buildDigestUrl(identity: DigestIdentity): string {
  const qs = new URLSearchParams({
    userId: identity.userId,
    user_id: identity.userId,
    userid: identity.userId,
  });
  return `${DASHY_DIGEST_URL.replace(/\/+$/, "")}?${qs.toString()}`;
}

/** Request headers shared by BOTH wires: Bearer auth + every userId header. */
function authHeaders(identity: DigestIdentity): Record<string, string> {
  return {
    Authorization: `Bearer ${identity.accessToken}`,
    // Carrier headers — the worker may read the id from a header. Include
    // every common casing/spelling; identical UUID in all of them.
    "X-User-Id": identity.userId,
    "X-UserId": identity.userId,
    "X-Userid": identity.userId,
    "x-user-id": identity.userId,
  };
}

/** All plausible userId body keys, each holding the identical UUID. */
function userIdBodyFields(identity: DigestIdentity): Record<string, string> {
  return {
    userId: identity.userId,
    user_id: identity.userId,
    userid: identity.userId,
  };
}

/**
 * Wire 1 — multipart/form-data file upload. The browser sets the multipart
 * boundary itself (we must NOT pass Content-Type here). userId rides in the
 * query string, in THREE form fields, and in the headers.
 */
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
  // Three form-field spellings — whichever key the worker reads, it's set.
  formData.append("userId", identity.userId);
  formData.append("user_id", identity.userId);
  formData.append("userid", identity.userId);

  const response = await fetch(buildDigestUrl(identity), {
    method: "POST",
    headers: authHeaders(identity),
    body: formData,
    signal,
  });
  return readWorkerResponse(response);
}

/**
 * Reads a text-ish file (txt/md) client-side so it can travel over the JSON
 * wire. Binary files (pdf/image) are sent as base64 data in the `file`
 * field — the JSON worker either stores the raw document or ignores it, but
 * the text/id contract fields are always present and valid.
 */
async function fileToJsonPayload(
  file: File,
  sourceType: string
): Promise<{ text: string; file: string | null }> {
  const isTextLike =
    sourceType === "text" ||
    sourceType === "markdown" ||
    file.type.startsWith("text/") ||
    /\.(txt|md|markdown|csv|json|log)$/i.test(file.name);

  if (isTextLike) {
    const text = await file.text();
    if (text.trim().length > 0) return { text, file: null };
  }

  // Binary (or empty text): base64 of the whole file.
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Chunk to avoid call-stack overflows on large (~15 MB) files.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const base64 =
    typeof btoa === "function"
      ? btoa(binary)
      : // Non-browser fallback (manual base64) — never reaches a Node server
        // bundle, but keeps the module self-contained.
        (() => {
          const alphabet =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
          let out = "";
          for (let i = 0; i < binary.length; i += 3) {
            const n =
              (binary.charCodeAt(i) << 16) |
              (binary.charCodeAt(i + 1) << 8) |
              binary.charCodeAt(i + 2);
            out +=
              alphabet[(n >> 18) & 63] +
              alphabet[(n >> 12) & 63] +
              (i + 1 < binary.length ? alphabet[(n >> 6) & 63] : "=") +
              (i + 2 < binary.length ? alphabet[n & 63] : "=");
          }
          return out;
        })();
  return {
    text:
      binary.length > 0
        ? `[binary file: ${file.name} (${sourceType})]`
        : file.name,
    file: `data:${file.type || "application/octet-stream"};base64,${base64}`,
  };
}

/**
 * Wire 2 — JSON body (the `request.json()` contract used by the deployed
 * worker family). userId appears in the query string, the JSON body under
 * three keys, and the headers. The file content travels as `text` (text
 * files) or base64 `file` (pdf/image).
 */
async function postJson(
  identity: DigestIdentity,
  file: File,
  filename: string,
  sourceType: string,
  signal?: AbortSignal
): Promise<WorkerResponse> {
  const { text, file: fileData } = await fileToJsonPayload(file, sourceType);

  const body: Record<string, unknown> = {
    ...userIdBodyFields(identity),
    // Ingestion request contract (worker/ingest.ts): text + sourceType.
    text,
    sourceType,
    // Common metadata spellings a deployed script may look for.
    filename,
    fileName: filename,
    name: filename,
    title: filename,
    sourceId: filename,
  };
  if (fileData) body.file = fileData;

  const response = await fetch(buildDigestUrl(identity), {
    method: "POST",
    headers: { ...authHeaders(identity), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  return readWorkerResponse(response);
}

/** Maps a parsed worker response onto a result or a typed DigestUploadError. */
function responseToResult(
  res: WorkerResponse
): DigestUploadResult {
  const { status, statusText, rawText, payload } = res;

  if (status === 401 || status === 403) {
    const reported = extractErrorText(payload, rawText, status, statusText);
    throw new DigestUploadError(
      // Surface the worker's exact text when it is meaningful, else a clean
      // session message — never a raw "403" blob.
      reported && reported !== `Upload failed (HTTP ${status} ${statusText})`
        ? reported
        : "Your session has expired. Please sign in again.",
      "unauthenticated",
      status
    );
  }

  if (status < 200 || status >= 300 || payload.success === false) {
    throw new DigestUploadError(
      extractErrorText(payload, rawText, status, statusText),
      "worker",
      status
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

/**
 * Uploads one file to `dashy-digest`.
 *
 * Strategy: the multipart wire is sent first (it is the only wire that can
 * carry a real binary file). If the worker rejects it with a userId-related
 * error, the JSON wire is retried once — that is the one channel a
 * `request.json()`-based worker cannot miss. Every wire carries the same
 * verified Supabase UUID on the query string, in the body (three spellings),
 * and in the headers.
 *
 * @throws {DigestUploadError} `unauthenticated` when no session could be
 * resolved (the request is NOT sent) or the token is rejected, `network`
 * when the worker is unreachable, `worker` for any non-2xx response —
 * carrying the worker's own error message when it provides one.
 */
export async function uploadFileToDigest(options: {
  file: File;
  /** Pre-resolved identity; resolved from the Supabase session when omitted. */
  identity?: DigestIdentity | null;
  /** Last-resort user id (e.g. one the page already loaded). */
  fallbackUserId?: string | null;
  sourceType?: string;
  signal?: AbortSignal;
}): Promise<DigestUploadResult> {
  const { file, fallbackUserId, signal } = options;

  const identity =
    options.identity ?? (await resolveDigestIdentity(fallbackUserId));

  if (!identity) {
    throw new DigestUploadError(
      DIGEST_LOGIN_REQUIRED_MESSAGE,
      "unauthenticated"
    );
  }

  const sourceType = options.sourceType ?? digestSourceTypeFor(file);
  const filename = file.name;

  const isAbort = (error: unknown): boolean =>
    error instanceof Error && error.name === "AbortError";
  const networkError = (
    error: unknown
  ): DigestUploadError => {
    if (isAbort(error)) {
      return new DigestUploadError("Upload cancelled.", "network");
    }
    return new DigestUploadError(
      "Could not reach the dashy-digest worker. Check your connection and try again.",
      "network"
    );
  };

  // ── Attempt 1: multipart/form-data (file-upload worker) ────────────────
  let multipart: WorkerResponse;
  try {
    multipart = await postMultipart(
      identity,
      file,
      filename,
      sourceType,
      signal
    );
  } catch (error) {
    throw networkError(error);
  }

  // Success on the multipart wire.
  if (
    multipart.status >= 200 &&
    multipart.status < 300 &&
    multipart.payload.success !== false
  ) {
    return responseToResult(multipart);
  }

  // Auth failures are final on BOTH wires (same Bearer token) — don't
  // disguise a 401/403 as a "userId is required" retry.
  if (multipart.status === 401 || multipart.status === 403) {
    return responseToResult(multipart);
  }

  const multipartErrorText = extractErrorText(
    multipart.payload,
    multipart.rawText,
    multipart.status,
    multipart.statusText
  );

  // ── Attempt 2: JSON wire — ONLY when the worker complained about userId.
  // A `request.json()` worker rejects multipart with exactly this class of
  // error before it ever looks at the file; JSON is the wire it cannot miss.
  if (isUserIdError(multipartErrorText)) {
    let json: WorkerResponse;
    try {
      json = await postJson(identity, file, filename, sourceType, signal);
    } catch (error) {
      throw networkError(error);
    }

    if (json.status >= 200 && json.status < 300 && json.payload.success !== false) {
      return responseToResult(json);
    }
    // Prefer the JSON wire's error message (it reflects the retry), except
    // for auth errors which are authoritative.
    if (json.status === 401 || json.status === 403 || !isUserIdError(
      extractErrorText(json.payload, json.rawText, json.status, json.statusText)
    )) {
      return responseToResult(json);
    }
  }

  // Not a userId problem (or JSON also failed on userId) — surface the
  // multipart worker's clean error message.
  return responseToResult(multipart);
}
