import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@/lib/supabase/server";

/**
 * DashyCore v7 — SERVER-SIDE document upload proxy for the `dashy-digest` worker.
 *
 * WHY THIS EXISTS (P0: "Upload failed: userId is required")
 * ---------------------------------------------------------
 * Every previous attempt injected `userId` in the BROWSER (FormData field,
 * query string, JSON body, headers — PRs #27/#28/#29 and the local "shotgun"
 * branch). The live worker kept rejecting the upload, which means the browser
 * hop could not be trusted to carry the identity: the Supabase session lives
 * in httpOnly cookies, the browser client can race cookie hydration, and the
 * cross-origin request needs a CORS preflight that strips what it wants.
 *
 * This route removes the browser from the identity path entirely:
 *
 *   browser  ──POST /api/digest/upload (same-origin, cookies, file ONLY)──▶  this route
 *   this route ── auth.getUser() from the Supabase COOKIES ──▶ verified user.id
 *   this route ──POST {DIGEST_URL}?userId=<user.id> (multipart, Bearer)──▶  worker
 *
 * `userId` is ALWAYS `user.id` from the verified server-side session. A
 * `userId` supplied by the browser is IGNORED — it is never read, never
 * forwarded, and can never overwrite the authenticated identity.
 */

/** Node runtime: FormData/Blob + long multipart uploads (no edge 4 MB cap). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Indexing a 15 MB PDF (fetch + embed) can outlast the default budget. */
export const maxDuration = 60;

/**
 * Server-side digest worker URL. Deliberately NOT `NEXT_PUBLIC_*`-first: the
 * proxy should be able to point at an internal/staging worker without
 * republishing the browser bundle.
 */
const DIGEST_URL =
  process.env.DASHY_DIGEST_URL ||
  process.env.NEXT_PUBLIC_DASHY_DIGEST_URL ||
  "https://dashy-digest.kamleshprathampandey.workers.dev";

/** Shown to signed-out visitors (matches the client-side copy exactly). */
const LOGIN_REQUIRED_MESSAGE = "Please log in to upload files.";

/** Mirrors the browser-side 15 MB guard so the limits cannot drift. */
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** Field names accepted for the incoming file part (`file` is the canonical one). */
const FILE_FIELD_CANDIDATES = ["file", "document", "attachment", "upload"];

/** Client-supplied identity fields that are stripped, never forwarded. */
const CLIENT_IDENTITY_FIELDS = ["userId", "user_id", "userid", "uid"];

/** `sourceType` values the RAG pipeline understands. */
const KNOWN_SOURCE_TYPES = new Set(["pdf", "image", "markdown", "text"]);

/** Above this size the JSON fallback wire is skipped (it base64-inflates ~33%). */
const JSON_FALLBACK_MAX_BYTES = 5 * 1024 * 1024;

/** Maps an uploaded file to the `sourceType` the ingest pipeline expects. */
function sourceTypeFor(file: File): string {
  const type = file.type || "";
  const name = file.name || "";
  if (type === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (type.startsWith("image/")) return "image";
  if (type.includes("markdown") || /\.(md|markdown)$/i.test(name)) {
    return "markdown";
  }
  return "text";
}

/** True when a worker error is the "userId is required" family of failures. */
function isUserIdError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("user") &&
    m.includes("id") &&
    /required|missing|not provided|cannot be empty|invalid|unauthor/.test(m)
  );
}

/** Best-effort JSON parse of an upstream body (returns `{}` when not JSON). */
function parseJsonBody(rawText: string): Record<string, unknown> {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Not JSON — the raw text is forwarded untouched.
  }
  return {};
}

/** Pulls a human-readable error out of an upstream JSON/text body. */
function upstreamErrorMessage(
  payload: Record<string, unknown>,
  rawText: string,
  status: number
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
    rawText.trim().slice(0, 300) ||
    `Upload failed (HTTP ${status})`
  );
}

/** Finds the uploaded file part, tolerating alternate field names. */
function pickIncomingFile(form: FormData): File | null {
  for (const field of FILE_FIELD_CANDIDATES) {
    const value = form.get(field);
    if (value instanceof File) return value;
  }
  // Last resort: the first file part under any key.
  for (const value of form.values()) {
    if (value instanceof File) return value;
  }
  return null;
}

/** Builds the outbound worker URL with the authenticated id in the query. */
function buildWorkerUrl(userId: string): URL {
  const url = new URL(DIGEST_URL);
  url.searchParams.set("userId", userId);
  url.searchParams.set("user_id", userId);
  url.searchParams.set("userid", userId);
  return url;
}

/** Headers for the server→worker hop. NO Content-Type (multipart boundary). */
function workerHeaders(userId: string, accessToken: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-User-Id": userId,
  };
  // Only attach Authorization when a real access token exists — an empty
  // Bearer would make a token-authenticating worker report a missing user.
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

interface UpstreamResult {
  status: number;
  rawText: string;
  contentType: string;
  payload: Record<string, unknown>;
}

/** Reads an upstream response once into text + parsed JSON. */
async function readUpstream(response: Response): Promise<UpstreamResult> {
  const rawText = await response.text();
  return {
    status: response.status,
    rawText,
    contentType:
      response.headers.get("content-type") ??
      (rawText.trim().startsWith("{") || rawText.trim().startsWith("[")
        ? "application/json"
        : "text/plain; charset=utf-8"),
    payload: parseJsonBody(rawText),
  };
}

/** True when the worker accepted the upload. */
function upstreamSucceeded(result: UpstreamResult): boolean {
  return (
    result.status >= 200 &&
    result.status < 300 &&
    result.payload.success !== false
  );
}

/** Forwards an upstream body/status verbatim to the browser. */
function forwardUpstream(result: UpstreamResult): NextResponse {
  return new NextResponse(result.rawText, {
    status: result.status,
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Reads a text-ish file so it can travel over the JSON fallback wire; binary
 * files travel as a base64 data URL in `file`.
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

  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  // Chunked to avoid blowing the call stack on multi-MB files.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const base64 = Buffer.from(binary, "binary").toString("base64");

  return {
    text:
      bytes.length > 0
        ? `[binary file: ${file.name} (${sourceType})]`
        : file.name,
    file: `data:${file.type || "application/octet-stream"};base64,${base64}`,
  };
}

export async function POST(request: NextRequest) {
  // ── 1. Identity from the Supabase cookies — the only trusted source ──────
  let supabase: Awaited<ReturnType<typeof createRouteHandlerClient>>;
  try {
    supabase = await createRouteHandlerClient();
  } catch (error) {
    console.error("[digest-upload] Supabase server client could not be created", error);
    return NextResponse.json(
      {
        error:
          "Upload service is not configured: Supabase environment variables are missing.",
      },
      { status: 500 }
    );
  }

  let userId: string;
  let accessToken: string | null = null;
  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (!user?.id) {
      // Missing / expired / rejected session. supabase-js reports this as an
      // error object rather than a throw, so it lands here — never upstream.
      if (userError) {
        console.warn("[digest-upload] no verified user:", userError.message);
      }
      return NextResponse.json(
        { error: LOGIN_REQUIRED_MESSAGE },
        { status: 401 }
      );
    }

    userId = user.id;

    // The worker authenticates with the session's access token; fetch it so
    // the outbound hop carries a real Bearer (never an empty one).
    const {
      data: { session },
    } = await supabase.auth.getSession();
    accessToken = session?.access_token ?? null;
  } catch (error) {
    console.error("[digest-upload] session verification failed", error);
    return NextResponse.json(
      { error: "Could not verify your session. Please reload and try again." },
      { status: 503 }
    );
  }

  // ── 2. Parse the browser's multipart body (file only — no identity) ──────
  let form: FormData;
  try {
    form = await request.formData();
  } catch (error) {
    console.warn("[digest-upload] request is not multipart/form-data", error);
    return NextResponse.json(
      { error: "Expected a multipart/form-data upload with a `file` field." },
      { status: 400 }
    );
  }

  const file = pickIncomingFile(form);
  if (!file) {
    return NextResponse.json(
      { error: "No file was uploaded. Attach a PDF, TXT, MD, PNG or JPG." },
      { status: 400 }
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "File too large. Maximum upload size is 15 MB." },
      { status: 413 }
    );
  }

  const filename =
    (typeof form.get("filename") === "string" &&
      (form.get("filename") as string).trim()) ||
    file.name ||
    "upload";

  // `sourceType` is the RAG ingest type (pdf|image|markdown|text), exactly as
  // the previous client computed it. Anything unrecognised is re-derived from
  // the file itself so the worker never receives a bogus type.
  const requestedSourceType = form.get("sourceType");
  const sourceType =
    typeof requestedSourceType === "string" &&
    KNOWN_SOURCE_TYPES.has(requestedSourceType)
      ? requestedSourceType
      : sourceTypeFor(file);

  // Surface that started the upload ("knowledge" | "chat") — metadata only.
  const origin =
    typeof form.get("origin") === "string"
      ? (form.get("origin") as string).slice(0, 32)
      : undefined;

  // Belt and braces: make sure no browser-supplied identity can survive into
  // the outbound body, even if a future caller adds one.
  for (const field of CLIENT_IDENTITY_FIELDS) form.delete(field);

  const workerUrl = buildWorkerUrl(userId);
  const headers = workerHeaders(userId, accessToken);

  console.log("[digest-upload] proxying upload", {
    userId,
    filename,
    bytes: file.size,
    sourceType,
    origin: origin ?? null,
    bearer: accessToken ? "attached" : "absent",
    worker: workerUrl.origin + workerUrl.pathname,
  });

  // ── 3. Wire 1 — multipart/form-data (carries the real binary) ────────────
  const outbound = new FormData();
  outbound.append("file", file, filename);
  outbound.append("filename", filename);
  outbound.append("sourceType", sourceType);
  if (origin) outbound.append("origin", origin);
  // REQUIRED by the worker — always the verified Supabase UUID, three spellings.
  outbound.append("userId", userId);
  outbound.append("user_id", userId);
  outbound.append("userid", userId);

  let multipart: UpstreamResult;
  try {
    multipart = await readUpstream(
      await fetch(workerUrl, {
        method: "POST",
        headers,
        body: outbound,
        cache: "no-store",
      })
    );
  } catch (error) {
    console.error("[digest-upload] worker unreachable (multipart)", error);
    return NextResponse.json(
      {
        error:
          "Could not reach the dashy-digest worker. Check your connection and try again.",
      },
      { status: 502 }
    );
  }

  if (upstreamSucceeded(multipart)) {
    console.log("[digest-upload] indexed via multipart", { userId, status: multipart.status });
    return forwardUpstream(multipart);
  }

  const multipartError = upstreamErrorMessage(
    multipart.payload,
    multipart.rawText,
    multipart.status
  );

  // ── 4. Wire 2 — JSON body, ONLY if the worker still claims userId is ─────
  // missing. Some deployed digest scripts do `await request.json()`, for which
  // a multipart body parses to `{}` and every form/query carrier is invisible.
  // The identity here is already server-verified, so the retry is safe and
  // bounded (skipped for large files, which base64 would inflate ~33%).
  if (isUserIdError(multipartError) && file.size <= JSON_FALLBACK_MAX_BYTES) {
    console.warn("[digest-upload] worker reported a userId problem on multipart; retrying as JSON", {
      userId,
      status: multipart.status,
      error: multipartError,
    });

    try {
      const { text, file: fileData } = await fileToJsonPayload(file, sourceType);
      const body: Record<string, unknown> = {
        userId,
        user_id: userId,
        userid: userId,
        text,
        sourceType,
        filename,
        fileName: filename,
        name: filename,
        title: filename,
        sourceId: filename,
      };
      if (origin) body.origin = origin;
      if (fileData) body.file = fileData;

      const jsonResult = await readUpstream(
        await fetch(workerUrl, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
        })
      );

      // Prefer the JSON wire's answer unless it is the same userId complaint.
      const jsonError = upstreamErrorMessage(
        jsonResult.payload,
        jsonResult.rawText,
        jsonResult.status
      );
      if (upstreamSucceeded(jsonResult) || !isUserIdError(jsonError)) {
        console.log("[digest-upload] JSON wire result", {
          userId,
          status: jsonResult.status,
        });
        return forwardUpstream(jsonResult);
      }
    } catch (error) {
      console.error("[digest-upload] worker unreachable (json fallback)", error);
      return NextResponse.json(
        {
          error:
            "Could not reach the dashy-digest worker. Check your connection and try again.",
        },
        { status: 502 }
      );
    }
  }

  console.warn("[digest-upload] worker rejected upload", {
    userId,
    status: multipart.status,
    error: multipartError,
  });

  // Forward the worker's own status + body so the browser toast can surface it.
  return forwardUpstream(multipart);
}
