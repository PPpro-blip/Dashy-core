"use client";

/**
 * DashyCore v7 — client boundary to the live `dashy-digest` Cloudflare Worker.
 *
 * This is the single source of truth for the document-ingest wire contract,
 * shared by every upload surface (chat composer attachment, Knowledge page,
 * and any future memory upload button) so they can never drift apart.
 *
 *   POST {DASHY_DIGEST_URL}?userId=…&user_id=…
 *   Auth:     Authorization: Bearer <supabase access token>
 *   Body:     multipart/form-data
 *   Fields:   file, filename, sourceType, userId, user_id
 *   Headers:  X-User-Id / X-UserId
 *
 * `userId` is the Supabase auth UUID (`session.user.id`) and is REQUIRED by
 * the worker — omitting it is what produced the production
 * "Upload failed: userId is required" toast.
 *
 * SHOTGUN CONTRACT: the live worker's deployed script is not in this repo,
 * so we cannot know which channel it reads the id from (query, form field,
 * header, camelCase vs snake_case). Until a probe pins that down
 * (`node scripts/probe-digest-worker.mjs` from a machine with egress to
 * workers.dev), the id is attached to EVERY channel simultaneously. Whichever
 * the worker consults, it finds the identical UUID, so extra carriers are
 * inert duplicates — never a mismatch.
 *
 * The identity is resolved from the Supabase session BEFORE the request is
 * made, and the request is never dispatched without it.
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
function workerErrorMessage(
  payload: Record<string, unknown>,
  fallbackText: string,
  status: number,
  statusText: string
): string {
  const stringValue = (value: unknown): string => {
    if (typeof value === "string") return value.trim();
    if (value && typeof value === "object") {
      const nested = value as Record<string, unknown>;
      return stringValue(nested.message) || stringValue(nested.error);
    }
    return "";
  };
  const candidate =
    stringValue(payload.error) ||
    stringValue(payload.message) ||
    stringValue(payload.details) ||
    cleanBodyText(fallbackText).slice(0, 300) ||
    statusText ||
    "";
  return (
    candidate ||
    `Upload failed (HTTP ${status}${statusText ? ` ${statusText}` : ""})`
  );
}

/**
 * Uploads one file to `dashy-digest`.
 *
 * @throws {DigestUploadError} `unauthenticated` when no session could be
 * resolved (the request is NOT sent), `network` when the worker is
 * unreachable, `worker` for any non-2xx response — carrying the worker's own
 * error message when it provides one.
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

  // ── SHOTGUN userId CARRIERS ────────────────────────────────────────────
  // The deployed dashy-digest script is not in this repo, so `userId` is
  // delivered on every channel a Worker can plausibly read. All carriers
  // hold the identical, verified Supabase UUID (`identity.userId`), so no
  // matter which one the script consults it sees the same value.
  const userIdQS = new URLSearchParams({
    userId: identity.userId,
    user_id: identity.userId,
  });
  // Do not add a trailing slash: the production Worker is mounted at the
  // configured URL itself, and redirects can alter multipart POST handling.
  const digestUrl = `${DASHY_DIGEST_URL.replace(/\/+$/, "")}?${userIdQS.toString()}`;

  // Carrier 1 + 2: multipart form fields (camelCase AND snake_case).
  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("filename", file.name);
  formData.append("sourceType", sourceType);
  formData.append("userId", identity.userId);
  formData.append("user_id", identity.userId);

  let response: Response;
  try {
    response = await fetch(digestUrl, {
      method: "POST",
      headers: {
        // NOTE: no Content-Type here — the browser sets the multipart
        // boundary itself.
        Authorization: `Bearer ${identity.accessToken}`,
        // Carrier 3 + 4: headers (kebab-case AND case-folded).
        "X-User-Id": identity.userId,
        "X-UserId": identity.userId,
      },
      body: formData,
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new DigestUploadError("Upload cancelled.", "network");
    }
    throw new DigestUploadError(
      "Could not reach the dashy-digest worker. Check your connection and try again.",
      "network"
    );
  }

  const rawText = await response.text();
  let payload: Record<string, unknown> = {};
  if (rawText.trim().startsWith("{")) {
    try {
      payload = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      // Non-JSON body — the status code and raw text still tell the story.
    }
  }

  if (response.status === 401 || response.status === 403) {
    const reported =
      (typeof payload.error === "string" && payload.error) ||
      (typeof payload.message === "string" && payload.message) ||
      "";
    throw new DigestUploadError(
      reported || "Your session has expired. Please sign in again.",
      "unauthenticated",
      response.status
    );
  }

  if (!response.ok || payload.success === false) {
    throw new DigestUploadError(
      workerErrorMessage(
        payload,
        rawText,
        response.status,
        response.statusText
      ),
      "worker",
      response.status
    );
  }

  return {
    documentId:
      typeof payload.documentId === "string" ? payload.documentId : undefined,
    chunkCount:
      typeof payload.chunkCount === "number" ? payload.chunkCount : undefined,
    raw: payload,
  };
}
